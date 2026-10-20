"""Case dossiers: creation, parsing, lint, status and close gates.

``case.md`` owns the narrative; ``ledger.jsonl`` owns evidence, questions,
decisions and status events. The parser reads only the documented conventions
and reports claim-like lines it could not read instead of ignoring them.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .ledger import (EXECUTION_KINDS, GRADE_RANK, REPRO_KINDS, Ledger, LedgerError, citation_grade,
                     evidence_number, now_iso, norm_grade, sha256_file)

TYPES = ("review", "verify", "bug", "issue")
STATUSES = ("open", "active", "waiting", "closed")
CLOSE_REASONS = {
    "review": ("done", "dropped"),
    "verify": ("done", "blocked", "dropped"),
    "bug": ("fixed", "data-fix", "external", "not-reproducible", "duplicate", "wont-fix", "dropped"),
    "issue": ("fixed", "data-fix", "external", "not-reproducible", "duplicate", "wont-fix", "dropped"),
}
RESULTS = {"PASS": "PASS", "통과": "PASS", "FAIL": "FAIL", "실패": "FAIL", "SKIP": "SKIP", "제외": "SKIP",
           "보류": "SKIP", "BLOCKED": "BLOCKED", "차단": "BLOCKED", "TODO": "TODO", "미실행": "TODO", "": "TODO"}
_TEMPLATES = Path(__file__).parent / "templates"

_CLAIM = re.compile(r"^\s*[-*]\s*\((확인|도출|추론|미확인|confirmed|observed|derived|inferred|unknown)\)\s*"
                    r"(?:\[(원인|효과|영향|cause|effect|impact)\])?\s*(.*)$", re.I)
_STRAY = re.compile(r"\((확인|도출|추론|미확인)\)")
_REQ_DEF = re.compile(r"^\s*[-*]\s*\[(REQ-[\w.\-]+)\]\s*(.*)$")
_EREF = re.compile(r"\bE\d+\b")
_REQREF = re.compile(r"\bREQ-[\w.\-]*[\w]")
_LABELS = {"cause": "원인", "effect": "효과", "impact": "영향"}


class CaseError(ValueError):
    pass


class GateError(CaseError):
    """Closing was refused because gates failed (a check result, not a usage error)."""


@dataclass
class Claim:
    line: int
    grade: str
    label: str | None
    text: str
    refs: list[str]


@dataclass
class Check:
    line: int
    id: str
    reqs: list[str]
    aspect: str
    result: str
    refs: list[str]


@dataclass
class CaseDoc:
    meta: dict
    claims: list[Claim] = field(default_factory=list)
    reqs: dict[str, int] = field(default_factory=dict)
    checks: list[Check] = field(default_factory=list)
    stray: list[int] = field(default_factory=list)
    stray_checks: list[int] = field(default_factory=list)
    refs: dict[str, list[int]] = field(default_factory=dict)


@dataclass
class Issue:
    level: str  # error | warning
    code: str
    message: str
    line: int | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


# --- locating ----------------------------------------------------------------------

def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:40].strip("-")


def case_dir(cases: Path, case_id: str) -> Path:
    d = cases / case_id
    if not (d / "case.md").is_file():
        matches = [p for p in cases.iterdir() if p.is_dir() and p.name.lower().startswith(case_id.lower())] \
            if cases.is_dir() else []
        if len(matches) == 1:
            return matches[0]
        hint = f" (ambiguous: {', '.join(p.name for p in matches)})" if matches else ""
        raise CaseError(f"no case {case_id!r}{hint}")
    return d


def new_case(cases: Path, ctype: str, title: str, slug: str | None, refs: str | None, spec: Path | None,
             workspace: Path | None) -> Path:
    if ctype not in TYPES:
        raise CaseError(f"case type must be one of {', '.join(TYPES)}")
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    base = f"{ctype.upper()}-{day}"
    s = slugify(slug or title)
    if s:
        cid = f"{base}-{s}"
    else:
        n = 1
        while (cases / f"{base}-{n:02d}").exists():
            n += 1
        cid = f"{base}-{n:02d}"
    d = cases / cid
    if d.exists():
        raise CaseError(f"case {cid} already exists; pass --slug to disambiguate")
    spec_rev = "-"
    if spec is not None:
        if not spec.is_file():
            raise CaseError(f"no such spec file: {spec}")
        spec_rev = f"{spec.name}@sha256:{sha256_file(spec)[:16]}"
    text = (_TEMPLATES / "_front.md").read_text(encoding="utf-8") + (_TEMPLATES / f"{ctype}.md").read_text(encoding="utf-8")
    text = text.format(id=cid, type=ctype, title=title.replace("\n", " "), created=now_iso(), refs=refs or "-",
                       spec_rev=spec_rev)
    d.mkdir(parents=True)
    (d / "case.md").write_text(text, encoding="utf-8", newline="\n")
    led = Ledger(d)
    led.append({"type": "created", "case_type": ctype, "title": title})
    led.append({"type": "status", "from": None, "to": "open"})
    if spec is not None:
        led.add_evidence(kind="file", claim=f"기준 문서 {spec.name}", ref=str(spec), workspace=workspace)
    return d


# --- parsing -----------------------------------------------------------------------

def _split_row(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", body)]


_COLS = {
    "chk": ("chk", "check", "검증"),
    "req": ("req", "요구사항", "requirement"),
    "aspect": ("관점", "aspect", "유형", "type"),
    "result": ("결과", "result", "status"),
    "evidence": ("근거", "evidence", "refs"),
}


def parse_case(text: str) -> CaseDoc:
    lines = text.split("\n")
    meta: dict = {}
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break
            if ":" in lines[i]:
                k, v = lines[i].split(":", 1)
                meta[k.strip()] = v.strip()
    doc = CaseDoc(meta)
    in_comment = False
    i = start
    while i < len(lines):
        raw = lines[i]
        n = i + 1
        stripped = raw.strip()
        # HTML comments hold guidance and examples; they are not content.
        if in_comment or stripped.startswith("<!--"):
            in_comment = "-->" not in stripped
            i += 1
            continue
        for ref in _EREF.findall(raw):
            doc.refs.setdefault(ref, []).append(n)
        m = _CLAIM.match(raw)
        if m:
            label = m.group(2)
            label = _LABELS.get(label.lower(), label) if label else None
            doc.claims.append(Claim(n, norm_grade(m.group(1)), label, m.group(3).strip(),
                                    _EREF.findall(m.group(3))))
            i += 1
            continue
        if _STRAY.search(raw) and not stripped.startswith("|"):
            doc.stray.append(n)
        m = _REQ_DEF.match(raw)
        if m:
            doc.reqs.setdefault(m.group(1), n)
            i += 1
            continue
        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{3,}", lines[i + 1]):
            header = [h.lower() for h in _split_row(raw)]
            cols = {}
            for key, names in _COLS.items():
                for idx, h in enumerate(header):
                    if h in names:
                        cols[key] = idx
                        break
            j = i + 2
            if cols.get("chk") != 0:
                while j < len(lines) and lines[j].strip().startswith("|"):
                    if re.match(r"^\s*\|\s*CHK-", lines[j]):
                        doc.stray_checks.append(j + 1)
                    j += 1
                j = i + 2
            if cols.get("chk") == 0:
                while j < len(lines) and lines[j].strip().startswith("|"):
                    cells = _split_row(lines[j])
                    cid = cells[0] if cells else ""
                    if re.fullmatch(r"CHK-[\w.\-]+", cid):
                        def cell(key: str) -> str:
                            k = cols.get(key)
                            return cells[k] if k is not None and k < len(cells) else ""
                        for ref in _EREF.findall(lines[j]):
                            doc.refs.setdefault(ref, []).append(j + 1)
                        result = RESULTS.get(cell("result").upper().strip("* "), cell("result").upper())
                        doc.checks.append(Check(j + 1, cid, _REQREF.findall(cell("req")), cell("aspect"),
                                                result, _EREF.findall(cell("evidence"))))
                    j += 1
            i = max(j, i + 1)
            continue
        i += 1
    return doc


# --- state from the ledger -----------------------------------------------------------

def current_status(entries: list[dict]) -> str | None:
    st = None
    for e in entries:
        if e.get("type") == "status":
            st = e.get("to")
        elif e.get("type") == "close":
            st = "closed"
    return st


def open_questions(entries: list[dict]) -> list[dict]:
    asked = {e["id"]: e for e in entries if e.get("type") == "question"}
    for e in entries:
        if e.get("type") == "answer":
            asked.pop(e.get("question"), None)
    return list(asked.values())


# --- lint --------------------------------------------------------------------------------

def check(d: Path) -> tuple[CaseDoc, list[Issue]]:
    text = (d / "case.md").read_text(encoding="utf-8")
    doc = parse_case(text)
    led = Ledger(d)
    entries = led.entries()
    ev = {e["id"]: e for e in entries if e.get("type") == "evidence"}
    issues: list[Issue] = []

    for key in ("id", "type", "title", "status"):
        if not doc.meta.get(key):
            issues.append(Issue("error", "front-matter", f"front matter is missing {key!r}"))
    for problem in led.verify_chain():
        issues.append(Issue("error", "ledger-chain",
                            f"ledger.jsonl was changed outside the CLI: {problem}"))
    purged = any(e.get("type") == "purge" for e in entries)
    for e in ev.values():
        art = e.get("artifact")
        if not art or not isinstance(art, dict) or not art.get("sha256"):
            continue
        path = d / art["path"]
        if not path.is_file():
            if not purged:
                issues.append(Issue("error", "artifact-missing", f"{e['id']}: {art['path']} is missing"))
        elif sha256_file(path) != art["sha256"]:
            issues.append(Issue("error", "artifact-modified", f"{e['id']}: {art['path']} no longer matches its hash"))
    ledger_status = current_status(entries)
    if doc.meta.get("status") and ledger_status and doc.meta["status"] != ledger_status:
        issues.append(Issue("error", "status-mismatch",
                            f"front matter status {doc.meta['status']!r} differs from the ledger ({ledger_status!r}); "
                            "status is CLI-owned (devloop case status|close)"))

    for ref, lines_ in sorted(doc.refs.items()):
        if ref not in ev:
            issues.append(Issue("error", "dangling-ref", f"{ref} is cited but not in the ledger", lines_[0]))
        elif any(e.get("supersedes") == ref for e in ev.values()):
            issues.append(Issue("warning", "superseded-ref", f"{ref} has been superseded", lines_[0]))

    for c in doc.claims:
        cited = [ev[r] for r in c.refs if r in ev]
        if not c.refs:
            if c.grade in {"확인", "도출"}:
                issues.append(Issue("error", "unsupported-claim", f"({c.grade}) claim cites no evidence", c.line))
            elif c.grade == "추론":
                issues.append(Issue("warning", "uncited-inference", "(추론) claim cites no evidence", c.line))
            continue
        if not cited:
            continue
        weakest = min((citation_grade(e) for e in cited), key=GRADE_RANK.__getitem__)
        if GRADE_RANK[c.grade] > GRADE_RANK[weakest]:
            issues.append(Issue("error", "grade-inflation",
                                f"({c.grade}) exceeds the weakest cited evidence ({weakest}: "
                                f"{', '.join(e['id'] for e in cited if citation_grade(e) == weakest)})", c.line))
        if c.label in {"원인", "효과"}:
            if c.grade == "확인":
                issues.append(Issue("error", "causal-observed",
                                    f"[{c.label}] is a judgement, not an observation; grade it 도출 or 추론", c.line))
            elif c.grade == "도출" and not any(e.get("kind") in REPRO_KINDS for e in cited):
                issues.append(Issue("error", "causal-without-repro",
                                    f"[{c.label}] graded 도출 needs a cited reproduction or before/after run "
                                    "(kind run/bot); otherwise grade it 추론", c.line))

    for n in doc.stray:
        issues.append(Issue("warning", "unparsed-grade",
                            "grade tag outside a claim list item is not checked; start the item with `- (등급)`", n))

    for n in doc.stray_checks:
        issues.append(Issue("warning", "unparsed-check",
                            "CHK row outside a table whose first header is CHK is not checked", n))

    for chk in doc.checks:
        cited = [ev[r] for r in chk.refs if r in ev]
        if chk.result in {"PASS", "FAIL"} and not any(e.get("kind") in EXECUTION_KINDS for e in cited):
            issues.append(Issue("error", "check-without-run",
                                f"{chk.id} is {chk.result} but cites no execution evidence (run/bot/tool)", chk.line))
        if chk.result not in {"PASS", "FAIL", "SKIP", "BLOCKED", "TODO"}:
            issues.append(Issue("error", "check-result", f"{chk.id}: unknown result {chk.result!r}", chk.line))
        for r in chk.reqs:
            if doc.reqs and r not in doc.reqs:
                issues.append(Issue("warning", "unknown-req", f"{chk.id} references undefined {r}", chk.line))
        if chk.result == "TODO":
            issues.append(Issue("warning", "check-todo", f"{chk.id} has not been executed", chk.line))

    if doc.meta.get("type") == "verify":
        covered = {r for c in doc.checks for r in c.reqs}
        for r, n in doc.reqs.items():
            if r not in covered:
                issues.append(Issue("warning", "uncovered-req", f"{r} has no check", n))
    return doc, issues


# --- status and close ------------------------------------------------------------------------

def _set_front_status(d: Path, status: str) -> None:
    p = d / "case.md"
    text = p.read_text(encoding="utf-8")
    new, n = re.subn(r"(?m)^status:.*$", f"status: {status}", text, count=1)
    if not n:
        raise CaseError("case.md front matter has no status line")
    p.write_text(new, encoding="utf-8", newline="\n")


def set_status(d: Path, status: str, note: str | None) -> dict:
    if status not in STATUSES or status == "closed":
        raise CaseError(f"status must be one of {', '.join(s for s in STATUSES if s != 'closed')} "
                        "(use `case close` to close)")
    led = Ledger(d)
    prev = current_status(led.entries())
    entry = led.append({"type": "status", "from": prev, "to": status, "note": note,
                        "reopened": prev == "closed" or None})
    _set_front_status(d, status)
    return entry


def close_gates(d: Path, reason: str, of: str | None, cases: Path) -> tuple[list[str], list[str]]:
    """Return (failed gates, notes) for closing with ``reason``."""
    doc, issues = check(d)
    ctype = doc.meta.get("type", "")
    if reason not in CLOSE_REASONS.get(ctype, ()):
        raise CaseError(f"close reason for {ctype} must be one of {', '.join(CLOSE_REASONS.get(ctype, ()))}")
    entries = Ledger(d).entries()
    ev = {e["id"]: e for e in entries if e.get("type") == "evidence"}
    kinds = [e.get("kind") for e in ev.values()]
    failed: list[str] = []
    notes: list[str] = []
    errors = [i for i in issues if i.level == "error"]
    if errors:
        failed.append(f"case check has {len(errors)} error(s)")
    qs = open_questions(entries)
    if qs and reason not in {"duplicate", "dropped"}:
        failed.append(f"unanswered questions: {', '.join(q['id'] for q in qs)} (answer or --defer them)")
    has_decision = any(e.get("type") == "decision" for e in entries)
    has_review = "review" in kinds

    if reason in {"done", "fixed", "data-fix"} and not has_review:
        failed.append("no independent review recorded (ev add --kind review --attach <adversary output>)")
    if reason == "done" and ctype == "verify":
        if not doc.reqs or not doc.checks:
            failed.append("a verification needs at least one [REQ-n] and one CHK row")
        covered: dict[str, set[str]] = {}
        for c in doc.checks:
            for r in c.reqs:
                covered.setdefault(r, set()).add(c.result)
        for r in doc.reqs:
            results = covered.get(r, set())
            if not results or results <= {"TODO"}:
                failed.append(f"{r} has no executed or explicitly skipped check")
        if any(c.result == "TODO" for c in doc.checks):
            failed.append("checks still TODO")
        if any(c.result == "FAIL" for c in doc.checks):
            notes.append("FAIL checks remain: make sure each has a bug case")
    if reason == "fixed":
        if not _red_green(doc, ev):
            failed.append("no regression check citing a failing run before a passing run of the same "
                          "reproduction (관점 '회귀' row citing run/bot evidence with the same command or scenario)")
        causes = [c for c in doc.claims if c.label == "원인"]
        if not causes:
            failed.append("no [원인] claim in the conclusion")
        elif all(c.grade in {"추론", "미확인"} for c in causes):
            notes.append("root cause is only 추론: say so in reports")
    if reason == "data-fix":
        if not has_decision:
            failed.append("data correction needs a recorded human decision (case decide)")
        if not any(e.get("kind") == "tool" and (e.get("tool") or {}).get("name") == "db.query" for e in ev.values()):
            failed.append("no saved impact query (db query --save)")
    if reason == "external" and "report" not in kinds:
        failed.append("external cause needs report evidence (ev add --kind report)")
    if reason == "not-reproducible" and not any(k in REPRO_KINDS for k in kinds):
        failed.append("record at least one reproduction attempt (ev run / bot run --save)")
    if reason == "duplicate":
        if not of:
            failed.append("duplicate needs --of CASE-ID")
        else:
            try:
                case_dir(cases, of)
            except CaseError:
                failed.append(f"--of {of}: no such case")
    if reason in {"wont-fix", "dropped", "blocked"} and not has_decision:
        failed.append(f"{reason} needs a recorded decision (case decide)")
    return failed, notes


def _red_green(doc: CaseDoc, ev: dict[str, dict]) -> bool:
    """A regression row passes the gate when, for one reproduction (same
    repro_key: same command, or same scenario file), a failing run is followed
    by a passing run. Order is the ledger order (evidence number)."""
    for c in doc.checks:
        if c.result != "PASS" or ("회귀" not in c.aspect and "regression" not in c.aspect.lower()):
            continue
        runs = sorted((ev[r] for r in c.refs if r in ev and ev[r].get("kind") in REPRO_KINDS and ev[r].get("repro_key")),
                      key=lambda e: evidence_number(e["id"]))
        by_key: dict[str, list[dict]] = {}
        for e in runs:
            by_key.setdefault(e["repro_key"], []).append(e)
        for seq in by_key.values():
            first_fail = next((i for i, e in enumerate(seq) if e.get("outcome") == "fail"), None)
            if first_fail is not None and any(e.get("outcome") == "pass" for e in seq[first_fail + 1:]):
                return True
    return False


def close(d: Path, reason: str, force: str | None, of: str | None, cases: Path) -> tuple[dict, list[str], list[str]]:
    led = Ledger(d)
    if current_status(led.entries()) == "closed":
        raise CaseError("case is already closed")
    failed, notes = close_gates(d, reason, of, cases)
    if failed and not force:
        raise GateError("cannot close:\n  - " + "\n  - ".join(failed) +
                        "\nFix them, or pass --force \"reason\" (recorded in the ledger).")
    entry = led.append({"type": "close", "reason": reason, "of": of, "forced": bool(failed),
                        "force_reason": force if failed else None, "failed_gates": failed or None})
    led.append({"type": "status", "from": current_status(led.entries()[:-1]), "to": "closed"})
    _set_front_status(d, "closed")
    return entry, failed, notes


# --- listing -----------------------------------------------------------------------------------

def read_meta(d: Path) -> dict:
    text = (d / "case.md").read_text(encoding="utf-8")
    return parse_case(text.split("\n# ", 1)[0] + "\n").meta


def summaries(cases: Path, include_closed: bool = False) -> list[dict]:
    out = []
    if not cases or not cases.is_dir():
        return out
    for d in sorted(cases.iterdir()):
        if not (d / "case.md").is_file():
            continue
        try:
            meta = read_meta(d)
            entries = Ledger(d).entries()
        except (OSError, ValueError, LedgerError):
            out.append({"id": d.name, "status": "unreadable"})
            continue
        status = current_status(entries) or meta.get("status")
        if status == "closed" and not include_closed:
            continue
        mtimes = [p.stat().st_mtime for p in (d / "case.md", d / "ledger.jsonl") if p.exists()]
        out.append({
            "id": d.name, "type": meta.get("type"), "title": meta.get("title"), "status": status,
            "updated": datetime.fromtimestamp(max(mtimes), timezone.utc).isoformat(timespec="seconds"),
            "evidence": sum(1 for e in entries if e.get("type") == "evidence"),
            "open_questions": len(open_questions(entries)),
        })
    out.sort(key=lambda s: s.get("updated", ""), reverse=True)
    return out


def stats(cases: Path) -> dict:
    by_type: dict[str, int] = {}
    by_reason: dict[str, int] = {}
    forced = closed = 0
    durations = []
    for s in summaries(cases, include_closed=True):
        by_type[s.get("type") or "?"] = by_type.get(s.get("type") or "?", 0) + 1
        entries = Ledger(cases / s["id"]).entries()
        created = next((e["ts"] for e in entries if e.get("type") == "created"), None)
        close_e = [e for e in entries if e.get("type") == "close"]
        if close_e:
            closed += 1
            last = close_e[-1]
            by_reason[last["reason"]] = by_reason.get(last["reason"], 0) + 1
            forced += bool(last.get("forced"))
            if created:
                a = datetime.fromisoformat(created.replace("Z", "+00:00"))
                b = datetime.fromisoformat(last["ts"].replace("Z", "+00:00"))
                durations.append((b - a).total_seconds() / 3600)
    durations.sort()
    median = durations[len(durations) // 2] if durations else None
    return {"cases_by_type": by_type, "closed": closed, "close_reasons": by_reason, "forced_closes": forced,
            "forced_rate": round(forced / closed, 3) if closed else None,
            "median_hours_to_close": round(median, 1) if median is not None else None}


def purge(cases: Path, older_than_days: int, apply: bool) -> list[dict]:
    """Remove artifacts of cases closed more than N days ago (ledger and case.md stay)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    out = []
    for s in summaries(cases, include_closed=True):
        if s.get("status") != "closed":
            continue
        d = cases / s["id"]
        entries = Ledger(d).entries()
        closes = [e for e in entries if e.get("type") == "close"]
        if not closes:
            continue
        closed_at = datetime.fromisoformat(closes[-1]["ts"].replace("Z", "+00:00"))
        art = d / "artifacts"
        if closed_at < cutoff and art.is_dir():
            size = sum(p.stat().st_size for p in art.rglob("*") if p.is_file())
            out.append({"id": s["id"], "closed": closes[-1]["ts"], "artifact_bytes": size})
            if apply:
                shutil.rmtree(art)
                Ledger(d).append({"type": "purge", "artifact_bytes": size,
                                  "note": f"artifacts removed after {older_than_days} days"})
    return out
