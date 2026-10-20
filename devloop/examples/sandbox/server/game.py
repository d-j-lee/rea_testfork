"""Sandbox game server: daily missions and rewards (SQLite).

A deliberately small stand-in for a live content server. It carries two
realistic defects for practising the devloop loops:

* claim race: the claim handler checks ``claimed`` and grants the reward in
  separate steps around a slow reward-service call, so concurrent or retried
  claims can both pass the check (duplicate rewards).
* reset time zone: the mission cycle is the server's local (KST) date, while
  the spec says missions reset at 00:00 UTC for the global service.

``SANDBOX_FIX`` (comma list: ``claim``, ``reset``) switches on the corrected
behaviour so demos can show a red-to-green regression without editing code.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
SERVER_TZ = KST
MISSIONS = {
    101: {"name": "일일 접속", "goal": 1, "gold": 100},
    102: {"name": "매치 5회 완료", "goal": 5, "gold": 500},
    103: {"name": "헤드샷 20회", "goal": 20, "gold": 800},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (uid INTEGER PRIMARY KEY, account TEXT UNIQUE NOT NULL, gold INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mission_progress (
    uid INTEGER NOT NULL, mission_id INTEGER NOT NULL, cycle TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (uid, mission_id, cycle));
CREATE TABLE IF NOT EXISTS reward_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, mission_id INTEGER NOT NULL,
    cycle TEXT NOT NULL, amount INTEGER NOT NULL, req TEXT, server TEXT, ts TEXT NOT NULL);
"""


def fixes() -> set[str]:
    return {f.strip() for f in os.environ.get("SANDBOX_FIX", "").split(",") if f.strip()}


class GameServer:
    def __init__(self, db_path: str, log_path: str, server_id: str = "game-01", reward_latency: float = 0.03):
        self.db_path = db_path
        self.server_id = server_id
        self.reward_latency = reward_latency
        self.clock_offset = timedelta(0)
        self._log_lock = threading.Lock()
        self._log = open(log_path, "a", encoding="utf-8")
        self._seq = 0
        with self._db() as con:
            con.executescript(SCHEMA)

    # --- infrastructure ----------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA busy_timeout=10000")
        return con

    @contextmanager
    def _db(self):
        con = self._connect()
        try:
            yield con
        finally:
            con.close()

    def now(self) -> datetime:
        return datetime.now(timezone.utc) + self.clock_offset

    def log(self, level: str, msg: str) -> None:
        ts = self.now().astimezone(SERVER_TZ).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        line = f"{ts} [{level}] [{self.server_id}] [t-{threading.get_ident() % 1000:03d}] {msg}\n"
        with self._log_lock:
            self._log.write(line)
            self._log.flush()

    def _req(self) -> str:
        with self._log_lock:
            self._seq += 1
            return f"r{self._seq:06d}"

    def current_cycle(self) -> str:
        if "reset" in fixes():
            return self.now().astimezone(timezone.utc).strftime("%Y-%m-%d")
        # Defect: the cycle follows the server's local date (KST), not UTC.
        return self.now().astimezone(SERVER_TZ).strftime("%Y-%m-%d")

    # --- handlers ---------------------------------------------------------------------------
    def login(self, account: str) -> dict:
        with self._db() as con:
            con.execute("INSERT OR IGNORE INTO users(account, gold) VALUES (?, 0)", (account,))
            uid, gold = con.execute("SELECT uid, gold FROM users WHERE account = ?", (account,)).fetchone()
        self.log("INFO", f"session.login uid={uid} account={account}")
        return {"ok": True, "user_id": uid, "gold": gold}

    def missions(self, uid: int) -> dict:
        cycle = self.current_cycle()
        with self._db() as con:
            rows = {m: (p, c) for m, p, c in con.execute(
                "SELECT mission_id, progress, claimed FROM mission_progress WHERE uid = ? AND cycle = ?", (uid, cycle))}
        return {"ok": True, "cycle": cycle, "missions": [
            {"id": mid, "name": m["name"], "goal": m["goal"], "progress": rows.get(mid, (0, 0))[0],
             "claimed": bool(rows.get(mid, (0, 0))[1])} for mid, m in MISSIONS.items()]}

    def add_progress(self, uid: int, mission_id: int, amount: int) -> dict:
        cycle = self.current_cycle()
        with self._db() as con:
            con.execute("INSERT INTO mission_progress(uid, mission_id, cycle, progress) VALUES (?, ?, ?, ?) "
                        "ON CONFLICT(uid, mission_id, cycle) DO UPDATE SET progress = progress + excluded.progress",
                        (uid, mission_id, cycle, amount))
            (progress,) = con.execute("SELECT progress FROM mission_progress WHERE uid=? AND mission_id=? AND cycle=?",
                                      (uid, mission_id, cycle)).fetchone()
        self.log("INFO", f"mission.progress uid={uid} mission={mission_id} cycle={cycle} progress={progress}")
        return {"ok": True, "progress": progress, "cycle": cycle}

    def claim(self, uid: int, mission_id: int) -> dict:
        req = self._req()
        mission = MISSIONS.get(mission_id)
        if mission is None:
            return {"ok": False, "error": "unknown_mission"}
        cycle = self.current_cycle()
        self.log("INFO", f"claim.request uid={uid} mission={mission_id} cycle={cycle} req={req}")
        if "claim" in fixes():
            return self._claim_atomic(uid, mission_id, mission, cycle, req)
        con = self._connect()
        try:
            row = con.execute("SELECT progress, claimed FROM mission_progress WHERE uid=? AND mission_id=? AND cycle=?",
                              (uid, mission_id, cycle)).fetchone()
            if row is None or row[0] < mission["goal"]:
                self.log("WARN", f"claim.rejected uid={uid} mission={mission_id} reason=not_completed req={req}")
                return {"ok": False, "error": "not_completed"}
            if row[1]:
                self.log("WARN", f"claim.rejected uid={uid} mission={mission_id} reason=already_claimed req={req}")
                return {"ok": False, "error": "already_claimed"}
            # Defect: the reward service call sits between the check and the update.
            time.sleep(self.reward_latency)
            self._grant(con, uid, mission_id, cycle, mission["gold"], req)
            con.execute("UPDATE mission_progress SET claimed = 1 WHERE uid=? AND mission_id=? AND cycle=?",
                        (uid, mission_id, cycle))
        finally:
            con.close()
        return {"ok": True, "reward": {"gold": mission["gold"]}, "cycle": cycle}

    def _claim_atomic(self, uid: int, mission_id: int, mission: dict, cycle: str, req: str) -> dict:
        con = self._connect()
        try:
            con.execute("BEGIN IMMEDIATE")
            cur = con.execute("UPDATE mission_progress SET claimed = 1 WHERE uid=? AND mission_id=? AND cycle=? "
                              "AND claimed = 0 AND progress >= ?", (uid, mission_id, cycle, mission["goal"]))
            if cur.rowcount != 1:
                con.execute("ROLLBACK")
                row = con.execute("SELECT claimed FROM mission_progress WHERE uid=? AND mission_id=? AND cycle=?",
                                  (uid, mission_id, cycle)).fetchone()
                reason = "already_claimed" if row and row[0] else "not_completed"
                self.log("WARN", f"claim.rejected uid={uid} mission={mission_id} reason={reason} req={req}")
                return {"ok": False, "error": reason}
            self._grant(con, uid, mission_id, cycle, mission["gold"], req)
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
        finally:
            con.close()
        time.sleep(self.reward_latency)  # reward service notified after commit
        return {"ok": True, "reward": {"gold": mission["gold"]}, "cycle": cycle}

    def _grant(self, con: sqlite3.Connection, uid: int, mission_id: int, cycle: str, gold: int, req: str) -> None:
        con.execute("UPDATE users SET gold = gold + ? WHERE uid = ?", (gold, uid))
        con.execute("INSERT INTO reward_log(uid, mission_id, cycle, amount, req, server, ts) VALUES (?,?,?,?,?,?,?)",
                    (uid, mission_id, cycle, gold, req, self.server_id, self.now().isoformat()))
        self.log("INFO", f"reward.granted uid={uid} mission={mission_id} cycle={cycle} amount={gold} req={req}")

    def gm(self, cmd: str, **args) -> dict:
        """Operator commands (sandbox only)."""
        if cmd == "set_progress":
            cycle = self.current_cycle()
            with self._db() as con:
                con.execute("INSERT INTO mission_progress(uid, mission_id, cycle, progress, claimed) VALUES (?,?,?,?,0) "
                            "ON CONFLICT(uid, mission_id, cycle) DO UPDATE SET progress = excluded.progress, claimed = 0",
                            (int(args["uid"]), int(args["mission"]), cycle, int(args["value"])))
            self.log("INFO", f"gm.set_progress uid={args['uid']} mission={args['mission']} value={args['value']}")
            return {"ok": True, "cycle": cycle}
        if cmd == "set_time":
            target = datetime.fromisoformat(str(args["utc"]).replace("Z", "+00:00"))
            self.clock_offset = target - datetime.now(timezone.utc)
            self.log("INFO", f"gm.set_time utc={args['utc']}")
            return {"ok": True, "now": self.now().isoformat(), "cycle": self.current_cycle()}
        if cmd == "state":
            with self._db() as con:
                gold = con.execute("SELECT gold FROM users WHERE uid = ?", (int(args["uid"]),)).fetchone()
                grants = con.execute("SELECT COUNT(*) FROM reward_log WHERE uid = ?", (int(args["uid"]),)).fetchone()
            return {"ok": True, "gold": gold[0] if gold else None, "grants": grants[0]}
        return {"ok": False, "error": f"unknown gm command {cmd}"}

    def close(self) -> None:
        with self._log_lock:
            self._log.close()
