"""Append-only case ledger: evidence, questions, decisions and status events.

The CLI is the only writer. Evidence grades are capped by provenance: what the
tool can resolve or hash may be ``확인``; a statement nobody can re-check is at
most ``추론``. Reports from people, tickets and agents are confirmed only as
"this was stated", so they count as ``추론`` when cited for a conclusion.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import textio

GRADES = ("미확인", "추론", "도출", "확인")
GRADE_RANK = {g: i for i, g in enumerate(GRADES)}
_ALIASES = {"confirmed": "확인", "observed": "확인", "derived": "도출", "inferred": "추론", "unknown": "미확인"}

KINDS = {
    # kind: (ceiling grade, citation grade or None=same as stored)
    "tool": ("확인", None),      # devloop command output saved with --save
    "run": ("확인", None),       # command executed by `ev run`
    "bot": ("확인", None),       # bot scenario run
    "file": ("확인", None),      # resolvable file[:line] snapshot
    "artifact": ("확인", None),  # attached file, hashed
    "derived": ("도출", None),   # computed from cited evidence (--from)
    "report": ("확인", "추론"),  # someone/something stated it (ticket, doc, person, agent)
    "review": ("확인", "추론"),  # independent review output
    "manual": ("추론", None),    # no resolvable source
    "unknown": ("미확인", None), # recorded unknown with how to check
}
EXECUTION_KINDS = {"run", "bot", "tool"}
REPRO_KINDS = {"run", "bot"}


class LedgerError(ValueError):
    pass


def norm_grade(text: str) -> str:
    g = _ALIASES.get(text.strip().lower(), text.strip())
    if g not in GRADE_RANK:
        raise LedgerError(f"unknown grade {text!r}; use one of {', '.join(GRADES)}")
    return g


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class Ledger:
    case_dir: Path

    @property
    def path(self) -> Path:
        return self.case_dir / "ledger.jsonl"

    @property
    def artifacts(self) -> Path:
        return self.case_dir / "artifacts"

    def entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        with open(self.path, encoding="utf-8") as f:
            for n, line in enumerate(f, 1):
                if not line.strip():
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError as exc:
                    raise LedgerError(f"{self.path}:{n}: corrupt ledger line ({exc}); the ledger is CLI-owned") from exc
        return out

    def append(self, entry: dict) -> dict:
        entry = {"ts": now_iso(), **entry}
        self.case_dir.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, sort_keys=False) + "\n")
        return entry

    def next_id(self, prefix: str) -> str:
        n = 0
        for e in self.entries():
            m = re.fullmatch(rf"{prefix}(\d+)", str(e.get("id", "")))
            if m:
                n = max(n, int(m.group(1)))
        return f"{prefix}{n + 1}"

    def evidence(self) -> dict[str, dict]:
        return {e["id"]: e for e in self.entries() if e.get("type") == "evidence"}

    # --- evidence -------------------------------------------------------------------
    def add_evidence(self, *, kind: str, claim: str, grade: str | None = None, ref: str | None = None,
                     scope: str | None = None, premises: list[str] | None = None, supersedes: str | None = None,
                     how_to_check: str | None = None, extra: dict | None = None, workspace: Path | None = None,
                     attach: Path | None = None) -> dict:
        if kind not in KINDS:
            raise LedgerError(f"unknown evidence kind {kind!r}; use one of {', '.join(KINDS)}")
        ceiling = KINDS[kind][0]
        entry: dict = {"type": "evidence", "kind": kind, "claim": claim}
        existing = self.evidence()
        if kind == "file":
            entry["file"] = _resolve_file_ref(ref, workspace)
        if kind == "artifact":
            if attach is None:
                raise LedgerError("kind artifact needs --attach PATH")
            entry["artifact"] = self._store(attach)
        if kind == "derived":
            if not premises:
                raise LedgerError("kind derived needs --from E1,E2 (the premises it was computed from)")
            missing = [p for p in premises if p not in existing]
            if missing:
                raise LedgerError(f"unknown premise evidence: {', '.join(missing)}")
            weakest = min((citation_grade(existing[p]) for p in premises), key=GRADE_RANK.__getitem__)
            ceiling = min(ceiling, weakest, key=GRADE_RANK.__getitem__)
            entry["from"] = premises
        if kind == "unknown" and not how_to_check:
            raise LedgerError("kind unknown needs --how (how it could be checked)")
        if kind in {"report", "manual"} and not ref:
            raise LedgerError(f"kind {kind} needs --ref (who/what stated it, e.g. JIRA-123, 기획서 v3 §2)")
        g = norm_grade(grade) if grade else ceiling
        if GRADE_RANK[g] > GRADE_RANK[ceiling]:
            raise LedgerError(f"grade {g} exceeds the ceiling {ceiling} for kind {kind}: "
                              f"{_CEILING_HINT.get(kind, 'attach a resolvable source')}")
        if supersedes and supersedes not in existing:
            raise LedgerError(f"cannot supersede unknown evidence {supersedes}")
        entry.update({"grade": g, "ref": ref, "scope": scope, "supersedes": supersedes,
                      "how_to_check": how_to_check})
        if extra:
            entry.update(extra)
        entry = {k: v for k, v in entry.items() if v is not None}
        entry["id"] = self.next_id("E")
        return self.append(entry)

    def _store(self, src: Path, name: str | None = None) -> dict:
        if not src.is_file():
            raise LedgerError(f"no such file to attach: {src}")
        self.artifacts.mkdir(parents=True, exist_ok=True)
        dest = self.artifacts / (name or f"{int(time.time() * 1000)}-{src.name}")
        shutil.copyfile(src, dest)
        return {"path": str(dest.relative_to(self.case_dir)).replace(os.sep, "/"), "sha256": sha256_file(dest),
                "bytes": dest.stat().st_size, "original": str(src)}

    def write_artifact(self, name: str, data: bytes) -> dict:
        self.artifacts.mkdir(parents=True, exist_ok=True)
        dest = self.artifacts / name
        dest.write_bytes(data)
        return {"path": str(dest.relative_to(self.case_dir)).replace(os.sep, "/"),
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}

    def save_tool_result(self, *, tool: str, argv: list[str], payload: dict, claim: str, kind: str = "tool",
                         outcome: str | None = None, scope: str | None = None) -> dict:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        art = self.write_artifact(f"{stamp}-{tool}.json",
                                  json.dumps(payload, ensure_ascii=False, indent=1, default=str).encode("utf-8"))
        extra = {"artifact": art, "tool": {"name": tool, "argv": argv, "cwd": os.getcwd()}}
        if outcome:
            extra["outcome"] = outcome
        return self.add_evidence(kind=kind, claim=claim, ref=f"artifact:{art['path']}", scope=scope, extra=extra)

    def run_command(self, *, argv: list[str], claim: str, timeout: float | None, scope: str | None,
                    max_echo: int = 4000) -> tuple[dict, str]:
        if not argv:
            raise LedgerError("ev run needs a command after --")
        started = time.monotonic()
        t0 = now_iso()
        try:
            proc = subprocess.run(argv, capture_output=True, timeout=timeout)
            code, out, err = proc.returncode, proc.stdout, proc.stderr
            timed_out = False
        except subprocess.TimeoutExpired as exc:
            code, out, err, timed_out = None, exc.stdout or b"", exc.stderr or b"", True
        except FileNotFoundError as exc:
            raise LedgerError(f"command not found: {argv[0]}") from exc
        elapsed = round(time.monotonic() - started, 3)
        out_text, out_stats = textio.decode_output(out)
        err_text, _ = textio.decode_output(err)
        body = (f"$ {subprocess.list2cmdline(argv)}\n# started {t0}, elapsed {elapsed}s, exit {code}"
                f"{' (timeout)' if timed_out else ''}\n# stdout ({out_stats.label()})\n{out_text}\n# stderr\n{err_text}\n")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        art = self.write_artifact(f"{stamp}-run.txt", body.encode("utf-8"))
        outcome = "pass" if code == 0 else "fail"
        entry = self.add_evidence(kind="run", claim=claim, ref=f"artifact:{art['path']}", scope=scope, extra={
            "artifact": art, "outcome": outcome, "exit_code": code, "timed_out": timed_out,
            "elapsed_s": elapsed, "command": argv, "cwd": os.getcwd()})
        tail = body if len(body) <= max_echo else "...\n" + body[-max_echo:]
        return entry, tail


_CEILING_HINT = {
    "manual": "use --kind file with a resolvable --ref path:line, or --kind artifact --attach",
    "report": "a statement is confirmed only as 'it was stated'; verify it and record the check",
    "derived": "a derivation cannot be stronger than its weakest premise",
}


def citation_grade(entry: dict) -> str:
    """Grade an entry contributes when cited for a conclusion."""
    override = KINDS.get(entry.get("kind", "manual"), ("추론", None))[1]
    g = entry.get("grade", "추론")
    if override and GRADE_RANK[override] < GRADE_RANK.get(g, 0):
        return override
    return g


def _resolve_file_ref(ref: str | None, workspace: Path | None) -> dict:
    if not ref:
        raise LedgerError("kind file needs --ref PATH[:LINE[-LINE]]")
    m = re.fullmatch(r"(.+?)(?::(\d+)(?:-(\d+))?)?", ref)
    assert m
    raw, a, b = m.group(1), m.group(2), m.group(3)
    p = Path(raw)
    if not p.is_absolute() and not p.exists() and workspace:
        p = workspace / raw
    if not p.is_file():
        raise LedgerError(f"cannot resolve file reference {ref!r}; kind file must point at an existing file")
    info = {"path": str(p), "sha256": sha256_file(p), "bytes": p.stat().st_size}
    if a:
        start, end = int(a), int(b or a)
        if end < start or end - start > 200:
            raise LedgerError("line range must be ascending and at most 200 lines")
        src = textio.open_text(str(p))
        lines = []
        try:
            for n, text in src:
                if n > end:
                    break
                if n >= start:
                    lines.append(text)
        finally:
            src.close()
        if len(lines) < end - start + 1:
            raise LedgerError(f"{p} has fewer than {end} lines")
        info.update({"lines": [start, end], "snapshot": "\n".join(lines)[:4000]})
    return info
