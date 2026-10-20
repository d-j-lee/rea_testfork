"""Append-only case ledger: evidence, questions, decisions and status events.

The CLI is the only writer. Appends are serialized with a file lock and each
entry carries the hash of the previous line, so edits made outside the CLI
(including through a shell) are detectable by ``case check``.

Evidence grades are capped by provenance: what the tool can resolve or hash may
be ``확인``; a statement nobody can re-check is at most ``추론``. Reports from
people, tickets and agents are confirmed only as "this was stated", so they
count as ``추론`` when cited for a conclusion.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
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
    "review": ("확인", "추론"),  # independent review output (attached)
    "manual": ("추론", None),    # no resolvable source
    "unknown": ("미확인", None), # recorded unknown with how to check
}
EXECUTION_KINDS = {"run", "bot", "tool"}
REPRO_KINDS = {"run", "bot"}
GENESIS = "0" * 16


class LedgerError(ValueError):
    pass


def norm_grade(text: str) -> str:
    g = _ALIASES.get(text.strip().lower(), text.strip())
    if g not in GRADE_RANK:
        raise LedgerError(f"unknown grade {text!r}; use one of {', '.join(GRADES)}")
    return g


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _line_hash(line: str) -> str:
    return hashlib.sha256(line.rstrip("\n").encode("utf-8")).hexdigest()[:16]


@contextmanager
def _locked(path: Path):
    """Exclusive inter-process lock (released by the OS if the process dies)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "a+b")
    try:
        if os.name == "nt":
            import msvcrt

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(f, fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(f, fcntl.LOCK_UN)
        finally:
            f.close()


@dataclass
class Ledger:
    case_dir: Path
    secrets: dict[str, str] = field(default_factory=dict)  # value -> env var name, redacted on write

    @property
    def path(self) -> Path:
        return self.case_dir / "ledger.jsonl"

    @property
    def artifacts(self) -> Path:
        return self.case_dir / "artifacts"

    # --- reading -----------------------------------------------------------------
    def _lines(self) -> list[str]:
        if not self.path.exists():
            return []
        with open(self.path, encoding="utf-8") as f:
            return [ln for ln in f if ln.strip()]

    def entries(self) -> list[dict]:
        out = []
        for n, line in enumerate(self._lines(), 1):
            try:
                out.append(json.loads(line))
            except ValueError as exc:
                raise LedgerError(f"{self.path}:{n}: corrupt ledger line ({exc}); the ledger is CLI-owned") from exc
        return out

    def verify_chain(self) -> list[str]:
        """Return problems with the hash chain (edits, insertions, deletions)."""
        problems = []
        prev = GENESIS
        for n, line in enumerate(self._lines(), 1):
            try:
                e = json.loads(line)
            except ValueError:
                problems.append(f"line {n} is not JSON")
                prev = _line_hash(line)
                continue
            if e.get("prev") != prev:
                problems.append(f"line {n} ({e.get('id') or e.get('type')}) does not follow line {n - 1}")
            prev = _line_hash(line)
        return problems

    def evidence(self) -> dict[str, dict]:
        return {e["id"]: e for e in self.entries() if e.get("type") == "evidence"}

    # --- writing -----------------------------------------------------------------
    def redact(self, value):
        if not self.secrets:
            return value
        if isinstance(value, str):
            for secret, name in self.secrets.items():
                value = value.replace(secret, "${" + name + "}")
            return value
        if isinstance(value, list):
            return [self.redact(v) for v in value]
        if isinstance(value, dict):
            return {k: self.redact(v) for k, v in value.items()}
        return value

    def append(self, entry: dict, id_prefix: str | None = None) -> dict:
        """Append under the lock; assigns ``id`` (E1, Q1, D1...) when asked."""
        with _locked(self.case_dir / ".ledger.lock"):
            lines = self._lines()
            prev = _line_hash(lines[-1]) if lines else GENESIS
            entry = {"ts": now_iso(), **self.redact(entry)}
            if id_prefix:
                n = 0
                for line in lines:
                    m = re.search(rf'"id": "{id_prefix}(\d+)"', line)
                    if m:
                        n = max(n, int(m.group(1)))
                entry = {"id": f"{id_prefix}{n + 1}", **entry}
            entry["prev"] = prev
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry

    # --- evidence ------------------------------------------------------------------
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
        if kind in {"artifact", "review"} and attach is None:
            raise LedgerError(f"kind {kind} needs --attach PATH (the file is copied and hashed)")
        if attach is not None:
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
        entry = {k: v for k, v in entry.items() if v is not None}
        if extra:
            entry.update(extra)  # extra keeps explicit None values (e.g. exit_code of a timeout)
        return self.append(entry, id_prefix="E")

    def _store(self, src: Path, name: str | None = None) -> dict:
        if not src.is_file():
            raise LedgerError(f"no such file to attach: {src}")
        self.artifacts.mkdir(parents=True, exist_ok=True)
        dest = self.artifacts / (name or f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{src.name}")
        shutil.copyfile(src, dest)
        return {"path": str(dest.relative_to(self.case_dir)).replace(os.sep, "/"), "sha256": sha256_file(dest),
                "bytes": dest.stat().st_size, "original": str(src)}

    def write_artifact(self, name: str, data: bytes) -> dict:
        self.artifacts.mkdir(parents=True, exist_ok=True)
        dest = self.artifacts / name
        if self.secrets:
            text = data.decode("utf-8", errors="surrogateescape")
            data = self.redact(text).encode("utf-8", errors="surrogateescape")
        dest.write_bytes(data)
        return {"path": str(dest.relative_to(self.case_dir)).replace(os.sep, "/"),
                "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}

    def save_tool_result(self, *, tool: str, argv: list[str], payload: dict, claim: str, kind: str = "tool",
                         outcome: str | None = None, scope: str | None = None, repro_key: str | None = None) -> dict:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        art = self.write_artifact(f"{stamp}-{tool}.json",
                                  json.dumps(payload, ensure_ascii=False, indent=1, default=str).encode("utf-8"))
        extra = {"artifact": art, "tool": {"name": tool, "argv": argv, "cwd": os.getcwd()}}
        if outcome:
            extra["outcome"] = outcome
        if repro_key:
            extra["repro_key"] = repro_key
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
        body = self.redact(f"$ {subprocess.list2cmdline(argv)}\n# started {t0}, elapsed {elapsed}s, exit {code}"
                           f"{' (timeout)' if timed_out else ''}\n# stdout ({out_stats.label()})\n{out_text}\n"
                           f"# stderr\n{err_text}\n")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        art = self.write_artifact(f"{stamp}-run.txt", body.encode("utf-8"))
        outcome = "pass" if code == 0 else "fail"
        entry = self.add_evidence(kind="run", claim=claim, ref=f"artifact:{art['path']}", scope=scope, extra={
            "artifact": art, "outcome": outcome, "exit_code": code, "timed_out": timed_out,
            "elapsed_s": elapsed, "command": argv, "cwd": os.getcwd(),
            "repro_key": "run:" + json.dumps(self.redact(argv), ensure_ascii=False)})
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


def evidence_number(eid: str) -> int:
    m = re.fullmatch(r"E(\d+)", eid or "")
    return int(m.group(1)) if m else -1


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
