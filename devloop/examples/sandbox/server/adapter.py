"""devloop bot adapter for the sandbox server (in-process, type = "python").

A team adapter has the same shape: open() returns a session per actor, and
session.call(op, args, timeout) returns the server response as a dict. Here the
"protocol" is a direct method call; a real adapter would drive the team's bot
client or wrap it with the JSON-lines process adapter.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from game import GameServer  # noqa: E402

OPS = {"login", "missions", "progress", "claim", "gm"}


class SandboxSession:
    def __init__(self, server: GameServer, spec: dict):
        self.server = server
        self.account = spec.get("account", "bot")
        self.uid = None

    def call(self, op: str, args: dict, timeout: float) -> dict:
        s = self.server
        if op not in OPS:
            return {"ok": False, "error": f"unknown op {op}"}
        if op == "login":
            r = s.login(self.account)
            self.uid = r["user_id"]
            return r
        if self.uid is None:
            return {"ok": False, "error": "not_logged_in"}
        if op == "missions":
            return s.missions(self.uid)
        if op == "progress":
            return s.add_progress(self.uid, int(args["mission"]), int(args.get("amount", 1)))
        if op == "claim":
            return s.claim(self.uid, int(args["mission"]))
        return s.gm(args["cmd"], **{"uid": self.uid, **{k: v for k, v in args.items() if k != "cmd"}})

    def events(self, timeout: float) -> list:
        return []

    def close(self) -> None:
        pass


class SandboxAdapter:
    def __init__(self, options: dict):
        os.makedirs(os.path.dirname(options["db_path"]) or ".", exist_ok=True)
        self.server = GameServer(options["db_path"], options["log_path"],
                                 reward_latency=float(options.get("reward_latency", 0.03)))

    def open(self, actor: str, spec: dict) -> SandboxSession:
        return SandboxSession(self.server, spec)

    def probe(self, kind: str, args: dict) -> dict:
        if kind == "state":
            return self.server.gm("state", uid=args["uid"])
        raise ValueError(f"unknown probe {kind}")

    def close(self) -> None:
        self.server.close()
