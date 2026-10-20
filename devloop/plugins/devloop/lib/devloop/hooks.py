"""Claude Code hook entry points.

PreToolUse is a nudge toward the sanctioned paths (``devloop db query`` and
human-run changes), not a parser of arbitrary shell. It only restricts: it
emits ``deny`` or ``ask`` and never ``allow``, so it cannot widen what the
user's permission settings permit. Markers are matched only in commands that
reach a data plane (database, cache, HTTP, remote shell), which keeps routine
commands such as ``grep live-01 game.log`` silent.
"""

from __future__ import annotations

import json
import os
import re
import shlex
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import sqlguard
from .config import TIER_RANK, Config, load

_RANK = {"none": 0, "ask": 1, "deny": 2}
_SQL_FLAGS = {"-q", "-Q", "-e", "--execute", "-c", "--command", "-Query", "-query", "--query"}
_FILE_FLAGS = {"-i", "-InputFile", "--file", "-f"}
_HTTP_WRITE_FLAGS = {"-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-F", "--form", "-T",
                     "--upload-file", "--json", "--post-data", "--post-file", "-Body", "-body", "-InFile"}
_MONGO_WRITE = re.compile(r"\.(insert\w*|update\w*|delete\w*|remove|drop\w*|replace\w*|bulkWrite|findAndModify|"
                          r"findOneAnd\w+|createIndex\w*|rename\w*)\s*\(", re.I)


@dataclass
class Verdict:
    decision: str = "none"
    reasons: list[str] = field(default_factory=list)

    def add(self, decision: str, reason: str) -> None:
        if decision == "none":
            return
        self.reasons.append(f"[{decision}] {reason}")
        if _RANK[decision] > _RANK[self.decision]:
            self.decision = decision


def split_segments(command: str) -> list[str]:
    """Split on shell control operators outside quotes."""
    segs, buf = [], []
    quote = None
    i = 0
    while i < len(command):
        ch = command[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            elif ch == "\\" and quote == '"' and i + 1 < len(command):
                buf.append(command[i + 1])
                i += 1
        elif ch in "'\"":
            quote = ch
            buf.append(ch)
        elif ch in ";|\n" or command.startswith("&&", i):
            segs.append("".join(buf))
            buf = []
            if command.startswith(("&&", "||"), i):
                i += 1
        elif ch == "&":
            segs.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    segs.append("".join(buf))
    return [s.strip() for s in segs if s.strip()]


def tokens(segment: str) -> list[str]:
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return segment.split()


def _base(tok: str) -> str:
    name = re.split(r"[\\/]", tok)[-1]
    return re.sub(r"\.(exe|cmd|bat|ps1)$", "", name, flags=re.I).lower()


def segment_tier(cfg: Config, segment: str) -> tuple[str, list[str]]:
    low = segment.lower()
    hits = [(tier, env) for marker, tier, env in cfg.tier_markers() if marker in low]
    if not hits:
        return "unknown", []
    tier = max((t for t, _ in hits), key=lambda t: TIER_RANK.get(t, -1))
    return tier, sorted({e for t, e in hits if t == tier})


def _flag_value(toks: list[str], flags: set[str]) -> str | None:
    for i, t in enumerate(toks):
        if t in flags and i + 1 < len(toks):
            return toks[i + 1]
        for f in flags:
            if f.startswith("--") and t.startswith(f + "="):
                return t.split("=", 1)[1]
    return None


def _redis_args(toks: list[str], start: int) -> list[str]:
    i = start + 1
    with_value = {"-h", "-p", "-a", "-n", "-u", "--user", "--pass", "-s", "--tls-cert", "--tls-key", "--cacert"}
    while i < len(toks):
        t = toks[i]
        if t in with_value:
            i += 2
        elif t.startswith("-"):
            i += 1
        else:
            break
    return toks[i:]


def classify_db(toks: list[str], idx: int, cfg: Config) -> tuple[str, str]:
    """(classification, description) for the database client at toks[idx]."""
    name = _base(toks[idx])
    rest = toks[idx:]
    if name == "redis-cli":
        a = sqlguard.analyze_redis(_redis_args(toks, idx))
        return a.classification, "; ".join(f.message for f in a.findings)
    if name in {"mongosh", "mongo"}:
        script = _flag_value(rest, {"--eval"})
        if script is None:
            return sqlguard.RISKY, "mongo shell without --eval cannot be classified"
        return (sqlguard.WRITE, "mongo script modifies data") if _MONGO_WRITE.search(script) else \
            (sqlguard.READ, "mongo script reads")
    if name == "sqlite3":
        positional = [t for t in rest[1:] if not t.startswith("-")]
        sql = positional[1] if len(positional) > 1 else None
        if sql is None:
            return sqlguard.RISKY, "sqlite3 without an inline statement (interactive or piped)"
    else:
        sql = _flag_value(rest, _SQL_FLAGS)
    if sql is None:
        if _flag_value(rest, _FILE_FLAGS) is not None or "<" in toks:
            return sqlguard.RISKY, f"{name} reads SQL from a file the guard cannot see"
        if name == "bcp":
            direction = next((t.lower() for t in rest[1:3] if t.lower() in {"in", "out", "queryout", "format"}), "")
            return (sqlguard.WRITE, "bcp in loads data") if direction == "in" else (sqlguard.READ, f"bcp {direction}")
        return sqlguard.RISKY, f"{name} without an inline statement (interactive or piped)"
    a = sqlguard.analyze_sql(sql, "auto", cfg.exec_allowlist or sqlguard.DEFAULT_EXEC_ALLOWLIST)
    detail = "; ".join(f.message for f in a.findings if f.level != sqlguard.READ) or "read-only statement"
    if a.classification == sqlguard.READ and not a.bounded:
        return "read-unbounded", detail + " (no row bound)"
    return a.classification, detail


def _http_writes(toks: list[str], idx: int) -> bool:
    rest = toks[idx + 1:]
    method = _flag_value(rest, {"-X", "--request", "--method", "-Method", "-method"})
    if method and method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        return True
    return any(t in _HTTP_WRITE_FLAGS or any(t.startswith(f + "=") for f in _HTTP_WRITE_FLAGS if f.startswith("--"))
               for t in rest)


def _devloop_db(toks: list[str], cfg: Config, v: Verdict) -> bool:
    for i, t in enumerate(toks):
        if (_base(t) in {"devloop", "devloop.py"}) and toks[i + 1:i + 3] == ["db", "query"]:
            env_name = _flag_value(toks[i:], {"--env"})
            tier = cfg.envs.get(env_name, {}).get("tier", "unknown") if env_name else "unknown"
            pol = cfg.policy(tier)
            v.add(pol.get("devloop_db", "none"), f"devloop db query on {env_name or '?'} (tier {tier})")
            if tier in {"stage", "live"} and {"--allow-risky", "--allow-unbounded"} & set(toks):
                v.add("ask", f"risky/unbounded read override on tier {tier}")
            return True
    return False


def analyze_command(command: str, cfg: Config, v: Verdict | None = None, inherited: str | None = None,
                    depth: int = 0) -> Verdict:
    """Analyze each shell segment. Quoted arguments that hold a command line
    (``ssh host "mysql -e ..."``, ``bash -c "..."``) are analyzed recursively
    and inherit the outer tier when they carry no marker of their own."""
    v = v if v is not None else Verdict()
    g = cfg.guard
    db_clients = {c.lower() for c in g["db_clients"]}
    local_db = {c.lower() for c in g["local_db_clients"]}
    http = {c.lower() for c in g["http_clients"]}
    remote = {c.lower() for c in g["remote_clients"]}
    for seg in split_segments(command):
        toks = tokens(seg)
        if not toks:
            continue
        tier, envs = segment_tier(cfg, seg)
        if tier == "unknown" and inherited:
            tier = inherited
        pol = cfg.policy(tier)
        where = f"tier {tier}" + (f" ({', '.join(envs)})" if envs else "")
        for pat in pol.get("deny_patterns", []) + g.get("deny_patterns", []):
            if re.search(pat, seg):
                v.add("deny", f"matches deny pattern {pat!r} on {where}")
        for pat in pol.get("ask_patterns", []) + g.get("ask_patterns", []):
            if re.search(pat, seg):
                v.add("ask", f"matches ask pattern {pat!r} on {where}")
        if _devloop_db(toks, cfg, v):
            continue
        for i, t in enumerate(toks):
            b = _base(t)
            # Local database tools matter only when a marker ties them to a shared tier.
            if b in db_clients or (b in local_db and tier != "unknown"):
                cls, detail = classify_db(toks, i, cfg)
                if cls == sqlguard.WRITE:
                    v.add(pol["db_write"], f"{b} write on {where}: {detail}. Writes are human-run; "
                                           "draft a reviewed script and a dry-run SELECT instead")
                elif cls == sqlguard.RISKY:
                    risky = pol["db_write"] if pol["db_write"] != "deny" else "ask"
                    v.add(max(risky, pol["db_read"], key=_RANK.__getitem__), f"{b} on {where}: {detail}")
                else:
                    v.add(pol["db_read"], f"{b} read on {where}" + (": prefer `devloop db query`" if tier != "unknown" else ""))
                    if cls == "read-unbounded" and pol.get("require_bounded"):
                        v.add("ask", f"{b} unbounded read on {where}: add TOP/LIMIT")
            elif b in http and _http_writes(toks, i):
                v.add(pol["http_write"], f"{b} sends a write request on {where}")
            elif b in remote:
                v.add(pol["remote"], f"{b} remote execution on {where}")
        if depth < 2:
            for t in toks[1:]:
                if " " in t.strip():
                    analyze_command(t, cfg, v, tier if tier != "unknown" else None, depth + 1)
    return v


def _ledger_path(path: str) -> bool:
    p = path.replace("\\", "/")
    return p.endswith("/ledger.jsonl") and "/.devloop/cases/" in p


def pretooluse(payload: dict) -> dict | None:
    cwd = Path(payload.get("cwd") or os.getcwd())
    cfg = load(cwd)
    tool = payload.get("tool_name", "")
    inp = payload.get("tool_input") or {}
    v = Verdict()
    if tool in {"Bash", "PowerShell"}:
        v = analyze_command(str(inp.get("command", "")), cfg)
    elif tool in {"Edit", "Write", "MultiEdit", "NotebookEdit"} and cfg.guard.get("protect_ledger", True):
        if _ledger_path(str(inp.get("file_path", ""))):
            v.add("deny", "ledger.jsonl is append-only and CLI-owned; use `devloop ev ...` / `devloop case ...`")
    else:
        for spec in cfg.guard.get("mcp_sql_tools", []):
            if spec.get("tool") == tool:
                sql = str(inp.get(spec.get("field", "sql"), ""))
                tier = spec.get("tier", "unknown")
                pol = cfg.policy(tier)
                a = sqlguard.analyze_sql(sql, spec.get("dialect", "auto"),
                                         cfg.exec_allowlist or sqlguard.DEFAULT_EXEC_ALLOWLIST)
                key = {"write": "db_write", "risky": "db_write", "read": "db_read"}[a.classification]
                decision = pol[key] if not (a.classification == "risky" and pol[key] == "deny") else "ask"
                v.add(decision, f"{tool} {a.classification} SQL on tier {tier}")
    if v.decision == "none":
        return None
    return {"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": v.decision,
        "permissionDecisionReason": "devloop guard: " + " | ".join(v.reasons)[:1500],
    }}


def sessionstart(payload: dict, max_cases: int = 8, recent_days: int = 14) -> dict | None:
    from .case import summaries

    cwd = Path(payload.get("cwd") or os.getcwd())
    try:
        cfg = load(cwd)
    except Exception as exc:  # noqa: BLE001 - surface config problems at session start
        return _context(f"devloop: configuration error: {exc}")
    if not cfg.cases_dir:
        return None
    cutoff = datetime.now(timezone.utc) - timedelta(days=recent_days)
    items = [s for s in summaries(cfg.cases_dir) if s.get("updated", "") >= cutoff.isoformat(timespec="seconds")]
    lines = []
    if items:
        lines.append(f"devloop: {len(items)} open case(s) touched in {recent_days}d "
                     "(details: devloop case show <id>):")
        for s in items[:max_cases]:
            q = f", {s['open_questions']} open question(s)" if s.get("open_questions") else ""
            lines.append(f"- {s['id']} [{s.get('type')}/{s.get('status')}] {s.get('title')} "
                         f"(E{s.get('evidence', 0)}{q})")
        if len(items) > max_cases:
            lines.append(f"- … {len(items) - max_cases} more")
    for w in cfg.warnings[:2]:
        lines.append(f"devloop config warning: {w}")
    return _context("\n".join(lines)) if lines else None


def _context(text: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}


def run(event: str, stdin_text: str) -> tuple[str, int]:
    """Return (stdout, exit code). Failures in the guard degrade to ``ask``."""
    try:
        payload = json.loads(stdin_text or "{}")
    except ValueError:
        payload = {}
    if event == "pretooluse":
        try:
            out = pretooluse(payload)
        except Exception as exc:  # noqa: BLE001 - never fail open silently
            out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                          "permissionDecisionReason": f"devloop guard error ({type(exc).__name__}: "
                                                                      f"{exc}); confirm this command manually"}}
        return (json.dumps(out, ensure_ascii=False) if out else ""), 0
    if event == "sessionstart":
        try:
            out = sessionstart(payload)
        except Exception as exc:  # noqa: BLE001
            out = _context(f"devloop: session summary failed: {type(exc).__name__}: {exc}")
        return (json.dumps(out, ensure_ascii=False) if out else ""), 0
    return f"unknown hook event {event}", 2
