"""JSON-lines bot host for the sandbox (devloop adapter type = "process").

Shows the contract for wrapping an existing bot written in any language:
read one JSON request per line, answer with the same id. Each request runs on
its own thread so parallel scenario branches reach the server concurrently.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading

from adapter import SandboxAdapter


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--log", required=True)
    a = ap.parse_args()
    adapter = SandboxAdapter({"db_path": a.db, "log_path": a.log})
    sessions: dict = {}
    out_lock = threading.Lock()

    def reply(rid, **body) -> None:
        with out_lock:
            sys.stdout.write(json.dumps({"id": rid, **body}, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    def handle(req: dict) -> None:
        rid = req.get("id")
        try:
            cmd = req["cmd"]
            if cmd == "open":
                sessions[req["actor"]] = adapter.open(req["actor"], req.get("spec", {}))
                reply(rid, result={"ok": True})
            elif cmd == "call":
                reply(rid, result=sessions[req["actor"]].call(req["op"], req.get("args", {}), req.get("timeout", 10)))
            elif cmd == "probe":
                reply(rid, result=adapter.probe(req["kind"], req.get("args", {})))
            elif cmd == "events":
                reply(rid, result=[])
            elif cmd == "close":
                reply(rid, result={"ok": True})
            else:
                reply(rid, error=f"unknown cmd {cmd}")
        except Exception as exc:  # noqa: BLE001 - reported to the runner
            reply(rid, error=f"{type(exc).__name__}: {exc}")

    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        if req.get("cmd") == "close":
            handle(req)
            break
        threading.Thread(target=handle, args=(req,), daemon=True).start()
    adapter.close()


if __name__ == "__main__":
    main()
