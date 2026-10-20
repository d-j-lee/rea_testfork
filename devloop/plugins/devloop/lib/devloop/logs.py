"""Log forensics: parse, summarize, query, merge and compare log records.

Every result states its coverage (records examined, unparsed lines, untimed
records, decoding fallbacks) so a bounded answer is never mistaken for a
complete one. Message templates mask variable tokens, which lets an agent read
thousands of lines as a few dozen patterns.
"""

from __future__ import annotations

import fnmatch
import glob
import hashlib
import json
import os
import re
import subprocess
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, tzinfo
from pathlib import Path
from typing import Iterable, Iterator

from . import textio
from .timeutil import TimeError, fmt_ts, make_ts_parser, parse_ts, parse_tz

LEVEL_RANK = {"TRACE": 0, "VERBOSE": 0, "DEBUG": 1, "INFO": 2, "NOTICE": 2, "WARN": 3, "WARNING": 3,
              "ERROR": 4, "ERR": 4, "FATAL": 5, "CRITICAL": 5, "CRIT": 5, "PANIC": 5}
_LEVEL_SCAN = re.compile(r"\b(TRACE|VERBOSE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|FATAL|CRIT(?:ICAL)?|PANIC)\b")
_LEAD_TS = re.compile(
    r"^\[?(\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)\]?")
_KV = re.compile(r"(?<![\w.\-])([A-Za-z_][\w.\-]*)=(\"[^\"]*\"|'[^']*'|[^\s,;)\]}]+)")
_JSON_TS = ("@timestamp", "timestamp", "time", "ts", "datetime", "date")
_JSON_LEVEL = ("level", "severity", "lvl", "log.level")
_JSON_MSG = ("msg", "message", "text", "log")

# Template masking: quoted strings first, then one pass over the alternatives
# below (at each position the first alternative that matches wins, so the more
# specific forms precede key=value and bare numbers).
_MASK_QUOTED = re.compile(r"\"[^\"]{0,200}\"|'[^']{0,200}'")
_MASK = re.compile("|".join([
    r"(?P<uuid>\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b)",
    r"(?P<ts>\b\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)",
    r"(?P<ip>\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b)",
    r"(?P<hex>\b0x[0-9a-fA-F]+\b|\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{12,}\b)",
    r"(?P<kv>(?<![\w.\-])(?P<key>[A-Za-z_][\w.\-]*)=[^\s,;)\]}]+)",
    r"(?P<n>(?<![A-Za-z_])[-+]?\d+(?:\.\d+)?(?![A-Za-z_]))",
]))


def _mask(m: re.Match) -> str:
    kind = m.lastgroup
    if kind in ("kv", "key"):
        return m.group("key") + "=<*>"
    return "<n>" if kind == "n" else f"<{kind}>"


MAX_TEMPLATES = 5000


class LogError(ValueError):
    pass


# --- profiles -----------------------------------------------------------------

@dataclass
class Profile:
    name: str
    format: str = "plain"  # regex | json | plain
    pattern: re.Pattern | None = None
    ts_field: str | None = "ts"
    ts_format: str = "iso8601"
    tz: tzinfo = None  # type: ignore[assignment]
    tz_spec: str = "UTC"
    tz_map: list[tuple[str, tzinfo, str]] = field(default_factory=list)
    level_field: str | None = "level"
    msg_field: str | None = "msg"
    kv: bool = True
    multiline: bool = True
    encoding: str = "auto"
    fallback: str | None = "cp949"

    def tz_for(self, source: str) -> tuple[tzinfo, str]:
        norm = source.replace("\\", "/")
        for pat, tz, spec in self.tz_map:
            if fnmatch.fnmatch(norm, pat) or fnmatch.fnmatch(os.path.basename(norm), pat):
                return tz, spec
        return self.tz, self.tz_spec


def build_profile(name: str, spec: dict) -> Profile:
    fmt = spec.get("format", "regex" if "pattern" in spec else "plain")
    if fmt not in {"regex", "json", "plain"}:
        raise LogError(f"profile {name}: format must be regex, json or plain")
    pattern = None
    if fmt == "regex":
        if "pattern" not in spec:
            raise LogError(f"profile {name}: regex format needs 'pattern'")
        try:
            pattern = re.compile(spec["pattern"])
        except re.error as exc:
            raise LogError(f"profile {name}: bad pattern: {exc}") from exc
    tz_spec = spec.get("tz", "UTC")
    try:
        tz = parse_tz(tz_spec)
        tz_map = [(str(k), parse_tz(v), str(v)) for k, v in spec.get("tz_map", {}).items()]
    except TimeError as exc:
        raise LogError(f"profile {name}: {exc}") from exc
    defaults = {"json": (None, None, None)}.get(fmt, ("ts", "level", "msg"))
    return Profile(
        name=name, format=fmt, pattern=pattern,
        ts_field=spec.get("ts_field", defaults[0]), ts_format=spec.get("ts_format", "iso8601"),
        tz=tz, tz_spec=str(tz_spec), tz_map=tz_map,
        level_field=spec.get("level_field", defaults[1]), msg_field=spec.get("msg_field", defaults[2]),
        kv=bool(spec.get("kv", True)), multiline=bool(spec.get("multiline", fmt == "regex")),
        encoding=spec.get("encoding", "auto"), fallback=spec.get("fallback", "cp949"),
    )


BUILTIN = {"json": {"format": "json"}, "plain": {"format": "plain"}}


def profiles_from(config_profiles: dict) -> dict[str, Profile]:
    out = {n: build_profile(n, s) for n, s in BUILTIN.items()}
    for n, s in config_profiles.items():
        out[n] = build_profile(n, s)
    return out


# --- records ------------------------------------------------------------------

@dataclass
class Record:
    src: str
    line: int
    ts: datetime | None
    level: str | None
    msg: str
    text: str
    groups: dict
    kv_enabled: bool = True
    parsed: bool = True
    _kv: dict | None = None

    def field(self, key: str):
        if key == "level":
            return self.level
        if key == "msg":
            return self.msg
        if key == "src":
            return self.src
        if key in self.groups:
            return self.groups[key]
        if self.kv_enabled:
            if self._kv is None:
                self._kv = {k: v.strip("\"'") for k, v in _KV.findall(self.text)}
            return self._kv.get(key)
        return None

    def ref(self) -> str:
        return f"{self.src}:{self.line}"


@dataclass
class SourceStats:
    source: str
    profile: str
    tz: str
    decode: textio.DecodeStats | None = None
    records: int = 0
    unparsed: int = 0
    untimed: int = 0
    ts_errors: int = 0
    continuation_lines: int = 0
    first: datetime | None = None
    last: datetime | None = None
    origin: dict | None = None  # provenance for command sources

    def to_dict(self, tz: tzinfo) -> dict:
        d = {
            "source": self.source, "profile": self.profile, "assumed_tz": self.tz,
            "records": self.records, "unparsed_lines": self.unparsed, "untimed_records": self.untimed,
            "timestamp_errors": self.ts_errors, "continuation_lines": self.continuation_lines,
            "first": fmt_ts(self.first, tz), "last": fmt_ts(self.last, tz),
        }
        if self.decode:
            d["decoding"] = self.decode.label()
            d["decoding_basis"] = self.decode.basis
        if self.origin:
            d["origin"] = self.origin
        return d


def _norm_level(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip().upper()
    return {"WARNING": "WARN", "ERR": "ERROR", "CRITICAL": "FATAL", "CRIT": "FATAL"}.get(s, s) or None


def _pick(d: dict, explicit: str | None, candidates: tuple[str, ...]):
    if explicit:
        cur = d
        for part in explicit.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return None
            cur = cur[part]
        return cur
    for c in candidates:
        if c in d:
            return d[c]
    return None


def detect_profile(lines: list[str], profiles: dict[str, Profile]) -> tuple[Profile, dict[str, float]]:
    """Pick the profile with the best match rate on a sample of lines."""
    sample = [ln for ln in lines if ln.strip()][:200]
    rates: dict[str, float] = {}
    if not sample:
        return profiles["plain"], rates
    json_ok = 0
    for ln in sample:
        try:
            json_ok += isinstance(json.loads(ln), dict)
        except ValueError:
            pass
    rates["json"] = json_ok / len(sample)
    for name, p in profiles.items():
        if p.format == "regex" and p.pattern is not None:
            rates[name] = sum(1 for ln in sample if p.pattern.match(ln)) / len(sample)
    best = max(((r, n) for n, r in rates.items()), default=(0.0, "plain"))
    if best[0] >= 0.5:
        return profiles[best[1]], rates
    return profiles["plain"], rates


def _iter_lines(source: textio.TextSource) -> Iterator[tuple[int, str]]:
    try:
        yield from source
    finally:
        source.close()


def parse_records(name: str, lines: Iterable[tuple[int, str]], profile: Profile, stats: SourceStats) -> Iterator[Record]:
    tz, _ = profile.tz_for(name)
    parse = make_ts_parser(profile.ts_format, tz)
    pending: Record | None = None

    def finish(rec: Record) -> Record:
        stats.records += 1
        if rec.ts is None:
            stats.untimed += 1
        else:
            if stats.first is None or rec.ts < stats.first:
                stats.first = rec.ts
            if stats.last is None or rec.ts > stats.last:
                stats.last = rec.ts
        return rec

    def ts_of(raw) -> datetime | None:
        if raw in (None, ""):
            return None
        try:
            return parse(str(raw))
        except (ValueError, OverflowError, OSError):
            stats.ts_errors += 1
            return None

    for n, line in lines:
        if profile.format == "regex":
            m = profile.pattern.match(line)  # type: ignore[union-attr]
            if m:
                if pending is not None:
                    yield finish(pending)
                g = {k: v for k, v in m.groupdict().items() if v is not None}
                pending = Record(name, n, ts_of(g.get(profile.ts_field or "")), _norm_level(g.get(profile.level_field or "")),
                                 g.get(profile.msg_field or "", line), line, g, profile.kv)
                continue
            if profile.multiline and pending is not None:
                pending.text += "\n" + line
                pending.msg += "\n" + line
                stats.continuation_lines += 1
                continue
            if pending is not None:
                yield finish(pending)
                pending = None
            if line.strip():
                stats.unparsed += 1
                yield finish(Record(name, n, None, None, line, line, {}, profile.kv, parsed=False))
            continue
        if profile.format == "json":
            try:
                obj = json.loads(line)
            except ValueError:
                obj = None
            if not isinstance(obj, dict):
                if line.strip():
                    stats.unparsed += 1
                    yield finish(Record(name, n, None, None, line, line, {}, profile.kv, parsed=False))
                continue
            flat = {k: v for k, v in obj.items() if not isinstance(v, (dict, list))}
            msg = _pick(obj, profile.msg_field, _JSON_MSG)
            yield finish(Record(name, n, ts_of(_pick(obj, profile.ts_field, _JSON_TS)),
                                _norm_level(_pick(obj, profile.level_field, _JSON_LEVEL)),
                                str(msg) if msg is not None else line, line,
                                {k: (str(v) if not isinstance(v, str) else v) for k, v in flat.items()}, profile.kv))
            continue
        # plain
        if not line.strip():
            continue
        m = _LEAD_TS.match(line)
        ts = None
        if m:
            raw = m.group(1)
            if raw[4] in "/." and raw[7] == raw[4]:
                raw = f"{raw[:4]}-{raw[5:7]}-{raw[8:]}"
            try:
                ts = parse_ts(raw, "iso8601", tz)
            except ValueError:
                stats.ts_errors += 1
        lv = _LEVEL_SCAN.search(line[:120])
        yield finish(Record(name, n, ts, _norm_level(lv.group(1)) if lv else None, line, line, {}, profile.kv))
    if pending is not None:
        yield finish(pending)


# --- sources -------------------------------------------------------------------

@dataclass
class Source:
    name: str
    open: object  # callable returning textio.TextSource
    origin: dict | None = None


def expand_paths(items: list[str]) -> list[str]:
    out: list[str] = []
    for item in items:
        if item == "-":
            out.append(item)
            continue
        if any(ch in item for ch in "*?["):
            matches = sorted(glob.glob(item, recursive=True))
            if not matches:
                raise LogError(f"no files match {item!r}")
            out.extend(m for m in matches if os.path.isfile(m))
            continue
        if os.path.isdir(item):
            out.extend(sorted(str(p) for p in Path(item).iterdir() if p.is_file()))
            continue
        if not os.path.exists(item):
            raise LogError(f"no such file: {item}")
        out.append(item)
    return out


def file_sources(paths: list[str]) -> list[Source]:
    return [Source(p, (lambda p=p: p)) for p in expand_paths(paths)]


def command_source(name: str, spec: dict, params: dict[str, str]) -> Source:
    cmd = spec.get("command")
    if not isinstance(cmd, list) or not cmd:
        raise LogError(f"log source {name}: 'command' must be a non-empty list (argv, no shell)")
    argv = [str(a).format(**params) if "{" in str(a) else str(a) for a in cmd]
    origin = {"kind": "command", "source": name, "argv_template": cmd, "params": params, "env": spec.get("env")}
    return Source(f"source:{name}", (lambda: argv), origin)


def open_source(src: Source, profile: Profile) -> tuple[textio.TextSource, subprocess.Popen | None]:
    target = src.open()  # type: ignore[operator]
    if isinstance(target, list):
        proc = subprocess.Popen(target, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        head = proc.stdout.read(4096)  # type: ignore[union-attr]
        enc, basis, fb = textio.choose_encoding(head, profile.encoding, profile.fallback)
        stats = textio.DecodeStats(source=src.name, encoding=enc, basis=basis, fallback=fb)
        return textio.TextSource(src.name, proc.stdout, stats, head, owned=True), proc
    return textio.open_text(target, profile.encoding, profile.fallback), None


# --- filters ---------------------------------------------------------------------

_COND = re.compile(r"^([\w.@\-]+)\s*(!=|!~|>=|<=|=|~|>|<)\s*(.*)$")


@dataclass
class Cond:
    key: str
    op: str
    value: str
    rx: re.Pattern | None = None

    def test(self, rec: Record) -> bool:
        v = rec.field(self.key)
        if self.op in {"=", "!="}:
            return (v is not None and str(v) == self.value) == (self.op == "=")
        if self.op in {"~", "!~"}:
            return (v is not None and self.rx.search(str(v)) is not None) == (self.op == "~")  # type: ignore[union-attr]
        try:
            a, b = float(v), float(self.value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return False
        return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[self.op]


def parse_cond(text: str) -> Cond:
    m = _COND.match(text)
    if not m:
        raise LogError(f"bad condition {text!r}; use key=value, key!=value, key~regex, key>number")
    c = Cond(m.group(1), m.group(2), m.group(3))
    if c.op in {"~", "!~"}:
        try:
            c.rx = re.compile(c.value)
        except re.error as exc:
            raise LogError(f"bad regex in {text!r}: {exc}") from exc
    return c


@dataclass
class Filter:
    since: datetime | None = None
    until: datetime | None = None
    min_level: int | None = None
    grep: re.Pattern | None = None
    conds: list[Cond] = field(default_factory=list)
    keys: list[re.Pattern] = field(default_factory=list)
    template_ids: set[str] = field(default_factory=set)
    include_unparsed: bool = True

    @property
    def timed(self) -> bool:
        return self.since is not None or self.until is not None

    def test(self, rec: Record) -> bool:
        if not rec.parsed and not self.include_unparsed:
            return False
        if self.timed:
            if rec.ts is None:
                return False
            if self.since and rec.ts < self.since:
                return False
            if self.until and rec.ts >= self.until:
                return False
        if self.min_level is not None:
            if rec.level is None or LEVEL_RANK.get(rec.level, 2) < self.min_level:
                return False
        if self.keys and not any(k.search(rec.text) for k in self.keys):
            return False
        if self.grep is not None and not self.grep.search(rec.text):
            return False
        if self.template_ids and template_id(template_of(rec.msg)) not in self.template_ids:
            return False
        return all(c.test(rec) for c in self.conds)


def key_pattern(value: str) -> re.Pattern:
    return re.compile(r"(?<![\w\-])" + re.escape(value) + r"(?![\w\-])")


def level_threshold(text: str) -> int:
    s = text.strip().upper().lstrip(">=")
    s = {"WARNING": "WARN"}.get(s, s)
    if s not in LEVEL_RANK:
        raise LogError(f"unknown level {text!r}")
    return LEVEL_RANK[s]


# --- templates ---------------------------------------------------------------------

def template_of(msg: str) -> str:
    first = msg.split("\n", 1)[0][:500]
    return _MASK.sub(_mask, _MASK_QUOTED.sub("\"<*>\"", first))


def template_id(tpl: str) -> str:
    return hashlib.sha1(tpl.encode("utf-8")).hexdigest()[:8]


@dataclass
class TemplateStat:
    template: str
    count: int = 0
    levels: Counter = field(default_factory=Counter)
    first: datetime | None = None
    last: datetime | None = None
    example: str = ""
    example_ref: str = ""

    def add(self, rec: Record) -> None:
        self.count += 1
        if rec.level:
            self.levels[rec.level] += 1
        if rec.ts is not None:
            if self.first is None or rec.ts < self.first:
                self.first = rec.ts
            if self.last is None or rec.ts > self.last:
                self.last = rec.ts
        if not self.example:
            self.example = rec.msg.split("\n", 1)[0][:240]
            self.example_ref = rec.ref()


class TemplateTable:
    """Groups records by template; ``by_level`` also splits by level, so a
    message that moves from INFO to WARN shows up as a change."""

    def __init__(self, cap: int = MAX_TEMPLATES, by_level: bool = False):
        self.stats: dict = {}
        self.cap = cap
        self.by_level = by_level
        self.overflow = 0

    def add(self, rec: Record) -> None:
        tpl = template_of(rec.msg)
        key = (tpl, rec.level or "-") if self.by_level else tpl
        st = self.stats.get(key)
        if st is None:
            if len(self.stats) >= self.cap:
                self.overflow += 1
                return
            st = self.stats[key] = TemplateStat(tpl)
        st.add(rec)

    def top(self, n: int) -> list[TemplateStat]:
        return sorted(self.stats.values(), key=lambda s: (-s.count, s.template))[:n]


# --- engine -------------------------------------------------------------------------

class Engine:
    def __init__(self, profiles: dict[str, Profile], profile_name: str = "auto"):
        if profile_name != "auto" and profile_name not in profiles:
            raise LogError(f"unknown profile {profile_name!r}; known: {', '.join(sorted(profiles))}, auto")
        self.profiles = profiles
        self.profile_name = profile_name
        self.sources: list[SourceStats] = []
        self.procs: list[tuple[str, subprocess.Popen]] = []

    def records(self, sources: list[Source]) -> Iterator[Record]:
        for src in sources:
            yield from self._records_one(src)

    def _records_one(self, src: Source) -> Iterator[Record]:
        initial = self.profiles["plain"] if self.profile_name == "auto" else self.profiles[self.profile_name]
        text, proc = open_source(src, initial)
        lines = _iter_lines(text)
        profile = initial
        if self.profile_name == "auto":
            head: list[tuple[int, str]] = []
            for item in lines:
                head.append(item)
                if len(head) >= 200:
                    break
            profile, _ = detect_profile([t for _, t in head], self.profiles)
            lines = _chain(head, lines)
        tz_obj, tz_spec = profile.tz_for(src.name)
        stats = SourceStats(src.name, profile.name, tz_spec, text.stats, origin=src.origin)
        self.sources.append(stats)
        if text.stats.encoding == "binary":
            stats.profile = "skipped:binary"
            text.close()
            return
        try:
            yield from parse_records(src.name, lines, profile, stats)
        finally:
            if proc is not None:
                text.close()  # a reader that stopped early makes the producer exit on a broken pipe
                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                err = (proc.stderr.read() or b"").decode("utf-8", "replace")[:500]  # type: ignore[union-attr]
                proc.stderr.close()  # type: ignore[union-attr]
                if proc.returncode:
                    stats.origin = {**(stats.origin or {}), "exit_code": proc.returncode, "stderr": err}


def _chain(head, rest):
    yield from head
    yield from rest


def coverage(engine: Engine, tz: tzinfo) -> dict:
    srcs = [s.to_dict(tz) for s in engine.sources]
    total = sum(s.records for s in engine.sources)
    unparsed = sum(s.unparsed for s in engine.sources)
    untimed = sum(s.untimed for s in engine.sources)
    fallback = sum((s.decode.fallback_lines if s.decode else 0) for s in engine.sources)
    replaced = sum((s.decode.replaced_lines if s.decode else 0) for s in engine.sources)
    skipped = [s.source for s in engine.sources if s.profile.startswith("skipped:")]
    return {"sources": srcs, "records": total, "unparsed_lines": unparsed, "untimed_records": untimed,
            "decode_fallback_lines": fallback, "decode_replaced_lines": replaced, "skipped_binary": skipped}


def scan(engine: Engine, sources: list[Source], flt: Filter, top: int, tz: tzinfo) -> dict:
    table = TemplateTable()
    levels: Counter = Counter()
    matched = 0
    for rec in engine.records(sources):
        if not flt.test(rec):
            continue
        matched += 1
        levels[rec.level or "-"] += 1
        table.add(rec)
    tpls = []
    for st in table.top(top):
        tpls.append({
            "id": template_id(st.template), "count": st.count, "levels": dict(st.levels),
            "first": fmt_ts(st.first, tz), "last": fmt_ts(st.last, tz),
            "template": st.template, "example": st.example, "example_ref": st.example_ref,
        })
    return {"command": "scan", "matched": matched, "levels": dict(levels),
            "distinct_templates": len(table.stats), "template_overflow_records": table.overflow,
            "templates": tpls, "coverage": coverage(engine, tz)}


def _rec_out(rec: Record, tz: tzinfo, role: str = "match", fields: list[str] | None = None) -> dict:
    d = {"ref": rec.ref(), "ts": fmt_ts(rec.ts, tz), "level": rec.level, "msg": rec.msg, "role": role}
    if not rec.parsed:
        d["unparsed"] = True
    if fields:
        d["fields"] = {f: rec.field(f) for f in fields}
    return d


def query(engine: Engine, sources: list[Source], flt: Filter, limit: int | None, offset: int, context: int,
          tz: tzinfo, fields: list[str] | None = None) -> dict:
    out: list[dict] = []
    matched = 0
    seen: set[str] = set()
    for src in sources:
        before: deque[Record] = deque(maxlen=context)
        after_left = 0
        for rec in engine._records_one(src):
            hit = flt.test(rec)
            if hit:
                idx = matched
                matched += 1
                if idx >= offset and (limit is None or idx < offset + limit):
                    for b in before:
                        if b.ref() not in seen:
                            seen.add(b.ref())
                            out.append(_rec_out(b, tz, "context", fields))
                    before.clear()
                    seen.add(rec.ref())
                    out.append(_rec_out(rec, tz, "match", fields))
                    after_left = context
                    continue
            if after_left and rec.ref() not in seen:
                seen.add(rec.ref())
                out.append(_rec_out(rec, tz, "context", fields))
                after_left -= 1
            elif context:
                before.append(rec)
    returned = sum(1 for r in out if r["role"] == "match")
    return {"command": "query", "matched": matched, "returned": returned, "offset": offset, "limit": limit,
            "truncated": returned < max(0, matched - offset), "records": out, "coverage": coverage(engine, tz)}


def timeline(engine: Engine, sources: list[Source], flt: Filter, limit: int | None, tz: tzinfo,
             max_collect: int = 100_000) -> dict:
    hits: list[Record] = []
    matched = 0
    for rec in engine.records(sources):
        if flt.test(rec):
            matched += 1
            if len(hits) < max_collect:
                hits.append(rec)
    timed = [r for r in hits if r.ts is not None]
    untimed = len(hits) - len(timed)
    timed.sort(key=lambda r: (r.ts, r.src, r.line))
    shown = timed if limit is None else timed[:limit]
    rows = []
    prev = None
    for r in shown:
        d = _rec_out(r, tz)
        d["delta_ms"] = None if prev is None else round((r.ts - prev).total_seconds() * 1000, 3)
        rows.append(d)
        prev = r.ts
    srcs = sorted({r.src for r in timed})
    caveats = []
    if len(srcs) > 1:
        caveats.append("multiple sources merged by timestamp: host clock skew and async flushing can reorder "
                       "events; treat cross-source ordering as inferred unless a shared request/transaction id links them")
    if untimed:
        caveats.append(f"{untimed} matching records without a timestamp are excluded from the ordering")
    if matched > max_collect:
        caveats.append(f"only the first {max_collect} of {matched} matches were collected")
    return {"command": "timeline", "matched": matched, "ordered": len(timed), "returned": len(rows),
            "truncated": len(rows) < len(timed), "sources_in_timeline": srcs, "caveats": caveats,
            "records": rows, "coverage": coverage(engine, tz)}


def diff(base: tuple[Engine, list[Source], Filter, float | None], target: tuple[Engine, list[Source], Filter, float | None],
         top: int, min_count: int, tz: tzinfo) -> dict:
    def side(engine, sources, flt):
        table = TemplateTable(by_level=True)
        n = 0
        for rec in engine.records(sources):
            if flt.test(rec):
                n += 1
                table.add(rec)
        return table, n

    bt, bn = side(*base[:3])
    tt, tn = side(*target[:3])
    b_minutes, t_minutes = base[3], target[3]
    rate_unit = "per_minute" if b_minutes and t_minutes else "share"

    def rate(count: int, n: int, minutes: float | None) -> float:
        if rate_unit == "per_minute":
            return count / minutes  # type: ignore[operator]
        return count / n if n else 0.0

    rows = []
    for key in set(bt.stats) | set(tt.stats):
        tpl, level = key
        bc = bt.stats[key].count if key in bt.stats else 0
        tc = tt.stats[key].count if key in tt.stats else 0
        if max(bc, tc) < min_count:
            continue
        br, tr = rate(bc, bn, b_minutes), rate(tc, tn, t_minutes)
        st = tt.stats.get(key) or bt.stats[key]
        ratio = (tr + 1e-9) / (br + 1e-9)
        rows.append({"id": template_id(tpl), "level": level, "template": tpl, "base": bc, "target": tc,
                     "base_rate": round(br, 6), "target_rate": round(tr, 6),
                     "ratio": None if bc == 0 or tc == 0 else round(ratio, 3), "example_ref": st.example_ref})
    new = sorted((r for r in rows if r["base"] == 0), key=lambda r: -r["target"])[:top]
    gone = sorted((r for r in rows if r["target"] == 0), key=lambda r: -r["base"])[:top]
    both = [r for r in rows if r["base"] and r["target"]]
    up = sorted((r for r in both if r["ratio"] > 1), key=lambda r: -r["ratio"])[:top]
    down = sorted((r for r in both if r["ratio"] < 1), key=lambda r: r["ratio"])[:top]
    return {"command": "diff", "rate_unit": rate_unit,
            "base": {"matched": bn, "minutes": b_minutes, "distinct_templates": len(bt.stats),
                     "coverage": coverage(base[0], tz)},
            "target": {"matched": tn, "minutes": t_minutes, "distinct_templates": len(tt.stats),
                       "coverage": coverage(target[0], tz)},
            "new": new, "gone": gone, "increased": up, "decreased": down}


def probe(path: str, profiles: dict[str, Profile], sample: int = 5) -> dict:
    text = textio.open_text(path)
    head: list[str] = []
    try:
        for _, line in text:
            head.append(line)
            if len(head) >= 200:
                break
    finally:
        text.close()
    best, rates = detect_profile(head, profiles)
    ts_ok = 0
    examined = [ln for ln in head if ln.strip()]
    if best.format != "plain":
        stats = SourceStats(path, best.name, best.tz_spec)
        recs = list(parse_records(path, list(enumerate(head, 1)), best, stats))
        ts_ok = sum(1 for r in recs if r.ts is not None)
        parsed = len(recs) - stats.unparsed
    else:
        ts_ok = sum(1 for ln in examined if _LEAD_TS.match(ln))
        parsed = len(examined)
    return {"command": "probe", "source": path, "decoding": text.stats.label(), "decoding_basis": text.stats.basis,
            "sample_lines": [ln[:300] for ln in examined[:sample]], "profile_match_rates": rates,
            "suggested_profile": best.name, "examined_lines": len(examined), "parsed_records": parsed,
            "timestamped_records": ts_ok,
            "hint": "binary file: not a log (skipped by scan/query)" if text.stats.encoding == "binary" else
            None if best.format != "plain" else
            "no configured profile matched >=50% of lines; add a regex profile with named groups ts, level, msg"}
