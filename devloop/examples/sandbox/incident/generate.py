"""Generate the sandbox "live incident" fixtures (deterministic).

Story (do not read before investigating if you want the exercise):
patch 1.4.3 lands at 2026-10-20 06:00 UTC and slows the reward service; clients
time out and retry claims, and the non-atomic claim grants twice. Separately,
missions roll over at 00:00 KST (15:00 UTC) although the spec says 00:00 UTC.

Outputs under run/incident/: game-01.log (UTF-8), game-02.log (CP949, the old
logging module), game-02.log.1.gz (rotated, CP949), incident.db (SQLite
snapshot) and cs_tickets.md. Usage: python incident/generate.py [--out DIR]
"""

from __future__ import annotations

import argparse
import gzip
import os
import random
import sqlite3
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
START = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
END = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)
DEPLOY = datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)
ROTATE = datetime(2026, 10, 20, 0, 0, tzinfo=timezone.utc)
MISSIONS = {101: 100, 102: 500, 103: 800}
CS_DUP_UID, CS_RESET_UID = 1042, 1107


def kst_cycle(t: datetime) -> str:
    return t.astimezone(KST).strftime("%Y-%m-%d")


class Out:
    def __init__(self):
        self.lines: dict[str, list[tuple[datetime, str]]] = {"game-01": [], "game-02": []}
        self.thread = 0

    def log(self, server: str, t: datetime, level: str, msg: str, thread: int | None = None) -> None:
        th = thread if thread is not None else random.randint(1, 48)
        ts = t.astimezone(KST).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        self.lines[server].append((t, f"{ts} [{level}] [{server}] [t-{th:03d}] {msg}"))


def build(out_dir: str) -> dict:
    rnd = random.Random(20261020)
    random.seed(20261020)
    o = Out()
    os.makedirs(out_dir, exist_ok=True)
    db_path = os.path.join(out_dir, "incident.db")
    if os.path.exists(db_path):
        os.remove(db_path)
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE users (uid INTEGER PRIMARY KEY, account TEXT UNIQUE NOT NULL, region TEXT, gold INTEGER NOT NULL);
        CREATE TABLE reward_log (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, mission_id INTEGER NOT NULL,
                                 cycle TEXT NOT NULL, amount INTEGER NOT NULL, req TEXT, server TEXT, ts TEXT NOT NULL);
        CREATE TABLE deploy_history (build TEXT, server TEXT, completed_at TEXT);
    """)
    users = list(range(1001, 1201))
    region = {u: rnd.choice(["KR", "KR", "EU", "NA", "SEA"]) for u in users}
    region[CS_RESET_UID] = "EU"
    region[CS_DUP_UID] = "NA"
    gold = {u: rnd.randint(0, 5000) for u in users}
    server_of = {u: "game-01" if u % 2 else "game-02" for u in users}
    claimed: set[tuple[int, int, str]] = set()
    seq = 0

    for s in ("game-01", "game-02"):
        o.log(s, DEPLOY + timedelta(seconds=rnd.randint(5, 40)), "INFO", "deploy.complete build=1.4.3 prev=1.4.2")
        con.execute("INSERT INTO deploy_history VALUES ('1.4.3', ?, ?)", (s, DEPLOY.isoformat()))
    # Missions roll over at 00:00 KST = 15:00 UTC (defect).
    for s in ("game-01", "game-02"):
        o.log(s, datetime(2026, 10, 19, 15, 0, 0, 120000, tzinfo=timezone.utc), "INFO",
              "mission.cycle_rollover cycle=2026-10-20 reason=daily_reset", thread=1)

    t = START
    while t < END:
        for s in ("game-01", "game-02"):
            o.log(s, t + timedelta(milliseconds=rnd.randint(0, 900)), "INFO",
                  f"server.heartbeat ccu={rnd.randint(800, 1400)} tick_ms={rnd.randint(14, 18)}", thread=1)
            if rnd.random() < 0.3:
                o.log(s, t + timedelta(seconds=rnd.randint(1, 59)), "INFO",
                      f"match.start match={rnd.randint(500000, 599999)} map=third_supply players={rnd.choice([8, 10, 12, 16])}")
        t += timedelta(minutes=1)

    events = []
    for u in users:
        sessions = rnd.randint(2, 5)
        for _ in range(sessions):
            at = START + timedelta(seconds=rnd.randint(0, int((END - START).total_seconds()) - 1800))
            events.append((at, u))
    events.append((datetime(2026, 10, 20, 9, 41, 2, tzinfo=timezone.utc), CS_DUP_UID))
    events.append((datetime(2026, 10, 19, 14, 40, 0, tzinfo=timezone.utc), CS_RESET_UID))
    events.append((datetime(2026, 10, 19, 15, 20, 0, tzinfo=timezone.utc), CS_RESET_UID))
    events.sort()

    for at, u in events:
        s = server_of[u]
        o.log(s, at, "INFO", f"session.login uid={u} region={region[u]}")
        cur = at + timedelta(seconds=rnd.randint(30, 600))
        if s == "game-02" and rnd.random() < 0.25:
            o.log(s, cur, "WARN", f"채팅 필터: 금칙어 감지 uid={u} 채널=로비 조치=마스킹")
        for mid, reward in MISSIONS.items():
            if rnd.random() < 0.55 and not (u == CS_DUP_UID and mid != 102):
                continue
            cur += timedelta(seconds=rnd.randint(20, 300))
            cycle = kst_cycle(cur)
            if (u, mid, cycle) in claimed:
                seq += 1
                o.log(s, cur, "INFO", f"claim.request uid={u} mission={mid} cycle={cycle} req=r{seq:06d} retry=0")
                o.log(s, cur + timedelta(milliseconds=3), "WARN",
                      f"claim.rejected uid={u} mission={mid} reason=already_claimed req=r{seq:06d}")
                continue
            claimed.add((u, mid, cycle))
            seq += 1
            req = f"r{seq:06d}"
            th = rnd.randint(2, 48)
            o.log(s, cur, "INFO", f"claim.request uid={u} mission={mid} cycle={cycle} req={req} retry=0", thread=th)
            slow = cur >= DEPLOY
            latency = rnd.randint(900, 2600) if slow and rnd.random() < 0.35 else rnd.randint(18, 45)
            if u == CS_DUP_UID and mid == 102 and slow:
                latency = 2140
            o.log(s, cur + timedelta(milliseconds=latency), "INFO" if latency < 500 else "WARN",
                  f"reward.svc.call uid={u} mission={mid} latency_ms={latency} req={req}", thread=th)
            grants = [(cur + timedelta(milliseconds=latency + 2), req, th)]
            if latency > 1500:
                # Client gave up at 1500 ms and retried; the first request was still in flight.
                seq += 1
                rreq = f"r{seq:06d}"
                rth = rnd.randint(2, 48)
                rt = cur + timedelta(milliseconds=1500 + rnd.randint(5, 60))
                o.log(s, rt, "INFO", f"claim.request uid={u} mission={mid} cycle={cycle} req={rreq} retry=1", thread=rth)
                rlat = rnd.randint(20, 60)
                o.log(s, rt + timedelta(milliseconds=rlat), "INFO",
                      f"reward.svc.call uid={u} mission={mid} latency_ms={rlat} req={rreq}", thread=rth)
                grants.append((rt + timedelta(milliseconds=rlat + 2), rreq, rth))
            for gt, greq, gth in grants:
                gold[u] += reward
                o.log(s, gt, "INFO", f"reward.granted uid={u} mission={mid} cycle={cycle} amount={reward} req={greq}",
                      thread=gth)
                con.execute("INSERT INTO reward_log(uid, mission_id, cycle, amount, req, server, ts) VALUES (?,?,?,?,?,?,?)",
                            (u, mid, cycle, reward, greq, s, gt.isoformat()))
            if slow and latency > 1200 and rnd.random() < 0.2:
                o.log(s, cur + timedelta(milliseconds=latency + 5), "WARN",
                      f"db.slow_query ms={latency - rnd.randint(100, 400)} sql=UPDATE_users_gold")

    # One crash with a multi-line trace on game-01 after the deploy.
    crash = datetime(2026, 10, 20, 11, 17, 33, tzinfo=timezone.utc)
    o.log("game-01", crash, "ERROR", "unhandled exception in RewardWorker: TimeoutError: reward service did not respond")
    o.lines["game-01"].append((crash + timedelta(microseconds=1), "  at RewardWorker.Notify(RewardWorker.cs:212)"))
    o.lines["game-01"].append((crash + timedelta(microseconds=2), "  at MissionService.Claim(MissionService.cs:88)"))

    for u, g in gold.items():
        con.execute("INSERT INTO users(uid, account, region, gold) VALUES (?, ?, ?, ?)",
                    (u, f"steam_7656119{u:010d}", region[u], g))
    con.commit()
    con.close()

    counts = {}
    for s, lines in o.lines.items():
        lines.sort(key=lambda x: x[0])
        if s == "game-01":
            with open(os.path.join(out_dir, "game-01.log"), "w", encoding="utf-8", newline="\n") as f:
                f.writelines(text + "\n" for _, text in lines)
        else:
            older = [text for at, text in lines if at < ROTATE]
            newer = [text for at, text in lines if at >= ROTATE]
            with gzip.open(os.path.join(out_dir, "game-02.log.1.gz"), "wb") as f:
                f.write(("\n".join(older) + "\n").encode("cp949"))
            with open(os.path.join(out_dir, "game-02.log"), "wb") as f:
                f.write(("\n".join(newer) + "\n").encode("cp949"))
        counts[s] = len(lines)

    with open(os.path.join(out_dir, "cs_tickets.md"), "w", encoding="utf-8") as f:
        f.write(f"""# CS 티켓 (요약 발췌)

| 티켓 | 접수(UTC) | 플레이어 | 내용 |
| --- | --- | --- | --- |
| CS-88120 | 2026-10-20 10:05 | uid {CS_DUP_UID} (NA) | "오늘 새벽(현지 PDT 2:41 AM 무렵) 미션 '매치 5회 완료' 보상 골드가 두 번 들어왔어요. 문제 될까요?" |
| CS-88131 | 2026-10-20 12:30 | 다수 (커뮤니티) | "패치 후 보상 받기 누르면 한참 멈췄다가 실패 뜨고, 다시 누르면 받아짐" |
| CS-88140 | 2026-10-19 15:45 | uid {CS_RESET_UID} (EU) | "일일 미션이 오후 5시(CEST)에 초기화돼요. 공지에는 매일 00:00 UTC라고 되어 있는데요?" |
""")
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="output directory (default: <sandbox>/run/incident)")
    a = ap.parse_args()
    out = a.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "run", "incident")
    counts = build(os.path.normpath(out))
    print(f"incident fixtures written to {os.path.normpath(out)}: " +
          ", ".join(f"{k} {v} lines" for k, v in counts.items()))


if __name__ == "__main__":
    main()
