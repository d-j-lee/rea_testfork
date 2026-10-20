"""devloop command line. Exit codes: 0 ok, 1 check/run failed, 2 usage or
configuration error, 3 refused by policy (nothing was executed)."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from . import __version__, bot, case, config, db, doctext, hooks, ledger, logs, sqlguard
from .timeutil import TimeError, fmt_ts, parse_tz, parse_user_time, parse_window

EXIT_FAIL, EXIT_USAGE, EXIT_REFUSED = 1, 2, 3
TEMPLATES = Path(__file__).parent / "templates"


class Usage(Exception):
    pass


def out(args, payload: dict, text: str) -> None:
    if getattr(args, "json", False):
        print(json.dumps(payload, ensure_ascii=False, indent=1, default=str))
    else:
        print(text)


def _cfg() -> config.Config:
    return config.load()


def _case_dir(cfg: config.Config, case_id: str) -> Path:
    cfg.require_workspace()
    return case.case_dir(cfg.cases_dir, case_id)  # type: ignore[arg-type]


def _save(args, cfg: config.Config, tool: str, payload: dict, claim: str, kind: str = "tool",
          outcome: str | None = None, scope: str | None = None) -> str:
    if not getattr(args, "save", None):
        return ""
    d = _case_dir(cfg, args.save)
    if getattr(args, "note", None):
        claim = f"{claim} — {args.note}"
    e = ledger.Ledger(d).save_tool_result(tool=tool, argv=sys.argv[1:], payload=payload, claim=claim, kind=kind,
                                          outcome=outcome, scope=scope)
    return f"\nsaved {e['id']} ({e['kind']}, {e['grade']}) to {d.name}: {e['artifact']['path']}"


def _num(n) -> str:
    return f"{n:,}" if isinstance(n, int) else str(n)


# --- init / config ------------------------------------------------------------------------

def cmd_init(args) -> int:
    if args.user:
        root = config.user_config_path().parent
        plan = [(root / "config.toml", TEMPLATES / "config.toml")]
    else:
        root = Path(args.dir).resolve() / ".devloop"
        plan = [
            (root / "config.toml", TEMPLATES / "config.toml"),
            (root / ".gitignore", TEMPLATES / "gitignore"),
            (root / "knowledge" / "systems.md", TEMPLATES / "knowledge_systems.md"),
            (root / "knowledge" / "checklist.md", TEMPLATES / "knowledge_checklist.md"),
            (root / "knowledge" / "pitfalls.md", TEMPLATES / "knowledge_pitfalls.md"),
            (root / "scenarios" / ".keep", None),
            (root / "cases" / ".keep", None),
        ]
    lines = [f"devloop init ({'user' if args.user else 'workspace'}): {root}"]
    todo = []
    for dest, src in plan:
        if dest.exists():
            lines.append(f"  keep    {dest} (exists, not modified)")
        else:
            lines.append(f"  create  {dest}")
            todo.append((dest, src))
    if not args.yes:
        lines.append("dry run: nothing written. Re-run with --yes to apply." if todo else "nothing to do.")
        out(args, {"root": str(root), "create": [str(d) for d, _ in todo], "applied": False}, "\n".join(lines))
        return 0
    for dest, src in todo:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src is None:
            dest.write_text("", encoding="utf-8")
        else:
            shutil.copyfile(src, dest)
    lines.append(f"applied: {len(todo)} file(s) created.")
    out(args, {"root": str(root), "create": [str(d) for d, _ in todo], "applied": True}, "\n".join(lines))
    return 0


def cmd_config(args) -> int:
    cfg = _cfg()
    envs = {n: {"tier": e.get("tier"), "markers": e.get("markers", []), "db": bool(e.get("db"))}
            for n, e in cfg.envs.items()}
    payload = {"workspace": str(cfg.workspace) if cfg.workspace else None, "config": str(cfg.path) if cfg.path else None,
               "user_config": str(cfg.user_path) if cfg.user_path else None, "display_tz": cfg.display_tz,
               "envs": envs, "log_profiles": sorted(cfg.log_profiles), "log_sources": sorted(cfg.log_sources),
               "adapters": sorted(cfg.adapters), "warnings": cfg.warnings}
    lines = [f"workspace:   {payload['workspace'] or '(none)'}", f"config:      {payload['config'] or '(none)'}",
             f"user config: {payload['user_config'] or '(none)'}", f"display_tz:  {cfg.display_tz}"]
    for n, e in envs.items():
        lines.append(f"env {n}: tier={e['tier']} markers={e['markers']} db={'yes' if e['db'] else 'no'}")
    lines.append(f"log profiles: {', '.join(payload['log_profiles']) or '-'}; sources: "
                 f"{', '.join(payload['log_sources']) or '-'}; adapters: {', '.join(payload['adapters']) or '-'}")
    lines += [f"warning: {w}" for w in cfg.warnings]
    out(args, payload, "\n".join(lines))
    return 0


# --- case / ev ------------------------------------------------------------------------------

def cmd_case(args) -> int:
    cfg = _cfg()
    ws = cfg.require_workspace()
    cases_dir = cfg.cases_dir
    assert cases_dir is not None
    sub = args.case_cmd
    if sub == "new":
        spec = Path(args.spec) if args.spec else None
        d = case.new_case(cases_dir, args.type, args.title, args.slug, args.ref, spec, ws)
        out(args, {"id": d.name, "path": str(d)}, f"created {d.name}\n  {d / 'case.md'}")
        return 0
    if sub == "list":
        items = case.summaries(cases_dir, include_closed=args.all)
        text = "\n".join(f"{s['id']}  [{s.get('type')}/{s.get('status')}]  {s.get('title')}  "
                         f"E{s.get('evidence', 0)} Q{s.get('open_questions', 0)}  {s.get('updated')}" for s in items)
        out(args, {"cases": items}, text or "no cases")
        return 0
    if sub == "stats":
        st = case.stats(cases_dir)
        out(args, st, json.dumps(st, ensure_ascii=False, indent=1))
        return 0
    if sub == "purge":
        rows = case.purge(cases_dir, args.older_than, args.yes)
        text = "\n".join(f"{'removed' if args.yes else 'would remove'} {r['id']} artifacts "
                         f"({_num(r['artifact_bytes'])} bytes, closed {r['closed']})" for r in rows)
        out(args, {"purged": rows, "applied": args.yes},
            (text or "nothing to purge") + ("" if args.yes else "\ndry run: pass --yes to delete"))
        return 0
    d = case.case_dir(cases_dir, args.id)
    led = ledger.Ledger(d)
    if sub == "show":
        doc, issues = case.check(d)
        entries = led.entries()
        ev = [e for e in entries if e.get("type") == "evidence"]
        qs = case.open_questions(entries)
        decisions = [e for e in entries if e.get("type") == "decision"]
        payload = {"id": d.name, "meta": doc.meta, "status": case.current_status(entries), "evidence": ev,
                   "open_questions": qs, "decisions": decisions, "claims": len(doc.claims), "checks": len(doc.checks),
                   "issues": [i.to_dict() for i in issues]}
        lines = [f"{d.name}  [{doc.meta.get('type')}/{payload['status']}]  {doc.meta.get('title')}",
                 f"  path: {d / 'case.md'}", f"  refs: {doc.meta.get('refs')}  spec_rev: {doc.meta.get('spec_rev')}",
                 f"  claims {len(doc.claims)}, requirements {len(doc.reqs)}, checks {len(doc.checks)}, "
                 f"lint {sum(i.level == 'error' for i in issues)} error(s) / {sum(i.level == 'warning' for i in issues)} warning(s)"]
        if ev:
            lines.append("  evidence:")
            for e in ev[-args.last:]:
                extra = f" outcome={e['outcome']}" if e.get("outcome") else ""
                lines.append(f"    {e['id']} {e['kind']}/{e['grade']}{extra}: {e['claim'][:140]}")
            if len(ev) > args.last:
                lines.append(f"    (+{len(ev) - args.last} earlier; ev list for all)")
        for q in qs:
            lines.append(f"  open {q['id']} → {q.get('to') or '?'}: {q['text']}")
        for x in decisions[-5:]:
            lines.append(f"  decision {x['id']} by {x.get('by')}: {x['text']}")
        out(args, payload, "\n".join(lines))
        return 0
    if sub == "check":
        doc, issues = case.check(d)
        errors = [i for i in issues if i.level == "error"]
        text = "\n".join(f"{i.level:7} {('L' + str(i.line)) if i.line else '-':>5} {i.code}: {i.message}" for i in issues)
        summary = (f"{d.name}: {len(errors)} error(s), {len(issues) - len(errors)} warning(s); "
                   f"claims {len(doc.claims)}, requirements {len(doc.reqs)}, checks {len(doc.checks)}")
        out(args, {"id": d.name, "errors": len(errors), "issues": [i.to_dict() for i in issues]},
            (text + "\n" if text else "") + summary)
        return EXIT_FAIL if errors else 0
    if sub == "status":
        e = case.set_status(d, args.status, args.note)
        out(args, e, f"{d.name}: {e['from']} -> {e['to']}")
        return 0
    if sub == "ask":
        e = led.append({"type": "question", "id": led.next_id("Q"), "text": args.text, "to": args.to})
        out(args, e, f"{e['id']} recorded for {args.to or '?'}")
        return 0
    if sub == "answer":
        qids = {x["id"] for x in led.entries() if x.get("type") == "question"}
        if args.qid not in qids:
            raise Usage(f"no question {args.qid} in {d.name}")
        e = led.append({"type": "answer", "question": args.qid, "text": args.text, "ref": args.ref,
                        "resolution": "deferred" if args.defer else "answered"})
        out(args, e, f"{args.qid} {e['resolution']}")
        return 0
    if sub == "decide":
        e = led.append({"type": "decision", "id": led.next_id("D"), "text": args.text, "by": args.by})
        out(args, e, f"{e['id']} recorded (by {args.by})")
        return 0
    if sub == "close":
        e, failed, notes = case.close(d, args.reason, args.force, args.of, cases_dir)
        lines = [f"{d.name} closed: {args.reason}" + (" (FORCED)" if e.get("forced") else "")]
        lines += [f"  bypassed gate: {f}" for f in failed] + [f"  note: {n}" for n in notes]
        out(args, {"close": e, "bypassed": failed, "notes": notes}, "\n".join(lines))
        return 0
    raise Usage(f"unknown case command {sub}")


def cmd_ev(args) -> int:
    cfg = _cfg()
    d = _case_dir(cfg, args.id)
    led = ledger.Ledger(d)
    if args.ev_cmd == "add":
        e = led.add_evidence(kind=args.kind, claim=args.claim, grade=args.grade, ref=args.ref, scope=args.scope,
                             premises=[p.strip() for p in args.from_.split(",")] if args.from_ else None,
                             supersedes=args.supersedes, how_to_check=args.how, workspace=cfg.workspace,
                             attach=Path(args.attach) if args.attach else None)
        out(args, e, f"{e['id']} {e['kind']}/{e['grade']}: {e['claim']}")
        return 0
    if args.ev_cmd == "run":
        cmd = args.command[1:] if args.command[:1] == ["--"] else args.command
        e, tail = led.run_command(argv=cmd, claim=args.claim, timeout=args.timeout, scope=args.scope)
        out(args, e, f"{tail}\n{e['id']} run/{e['grade']} outcome={e['outcome']} exit={e['exit_code']} "
                     f"({e['elapsed_s']}s) → {e['artifact']['path']}")
        return 0 if e["outcome"] == "pass" else EXIT_FAIL
    if args.ev_cmd == "list":
        ev = [e for e in led.entries() if e.get("type") == "evidence" and (not args.kind or e.get("kind") == args.kind)]
        text = "\n".join(f"{e['id']:>4} {e['kind']:8} {e['grade']}"
                         f"{(' cite=' + ledger.citation_grade(e)) if ledger.citation_grade(e) != e['grade'] else ''}"
                         f"{(' ' + e['outcome']) if e.get('outcome') else ''}  {e['claim'][:160]}"
                         f"{('  ← ' + e['ref']) if e.get('ref') else ''}" for e in ev)
        out(args, {"evidence": ev}, text or "no evidence")
        return 0
    raise Usage(f"unknown ev command {args.ev_cmd}")


# --- log --------------------------------------------------------------------------------------

def _filter(args, tz) -> logs.Filter:
    f = logs.Filter()
    try:
        if args.since:
            f.since = parse_user_time(args.since, tz)
        if args.until:
            f.until = parse_user_time(args.until, tz)
    except TimeError as exc:
        raise Usage(str(exc)) from exc
    if args.level:
        f.min_level = logs.level_threshold(args.level)
    if args.grep:
        import re

        f.grep = re.compile(args.grep)
    f.conds = [logs.parse_cond(c) for c in args.where or []]
    f.keys = [logs.key_pattern(k) for k in args.key or []]
    f.template_ids = set(args.template or [])
    f.include_unparsed = not args.no_unparsed
    return f


def _sources(args, cfg: config.Config, paths: list[str], since=None, until=None) -> tuple[list[logs.Source], str | None]:
    if args.source:
        spec = cfg.log_sources.get(args.source)
        if spec is None:
            raise Usage(f"unknown log source {args.source!r}; configured: {', '.join(sorted(cfg.log_sources)) or '-'}")
        params = {"since": since.isoformat() if since else "", "until": until.isoformat() if until else ""}
        for p in args.param or []:
            k, _, v = p.partition("=")
            params[k] = v
        return [logs.command_source(args.source, spec, params)], spec.get("profile")
    if not paths:
        raise Usage("give log files/globs/directories, '-' for stdin, or --source NAME")
    return logs.file_sources(paths), None


def _engine(args, cfg: config.Config, profile_hint: str | None) -> logs.Engine:
    return logs.Engine(logs.profiles_from(cfg.log_profiles), args.profile or profile_hint or "auto")


def _cov_line(cov: dict) -> str:
    parts = [f"{len(cov['sources'])} source(s)", f"{_num(cov['records'])} records"]
    for key, label in (("unparsed_lines", "unparsed"), ("untimed_records", "untimed"),
                       ("decode_fallback_lines", "decode-fallback"), ("decode_replaced_lines", "decode-replaced")):
        if cov[key]:
            parts.append(f"{label} {_num(cov[key])}")
    if cov.get("skipped_binary"):
        parts.append(f"skipped binary {len(cov['skipped_binary'])} ({', '.join(cov['skipped_binary'][:3])})")
    return "coverage: " + ", ".join(parts)


def _src_lines(cov: dict) -> list[str]:
    out_ = []
    for s in cov["sources"]:
        line = (f"  {s['source']}  profile={s['profile']} tz={s['assumed_tz']} {s.get('decoding', '')} "
                f"records={_num(s['records'])} {s['first']}..{s['last']}")
        if s.get("origin", {}) and s["origin"].get("exit_code"):
            line += f"  SOURCE EXIT {s['origin']['exit_code']}: {s['origin'].get('stderr', '')[:200]}"
        out_.append(line)
    return out_


def _rec_line(r: dict, show_delta: bool = False) -> str:
    prefix = "  " if r["role"] == "context" else ""
    delta = ""
    if show_delta:
        delta = "         " if r.get("delta_ms") is None else f"{'+' + str(r['delta_ms']) + 'ms':>9}"
        delta += " "
    msg = r["msg"].replace("\n", "\n      ")
    fields = ""
    if r.get("fields"):
        fields = " {" + ", ".join(f"{k}={v}" for k, v in r["fields"].items()) + "}"
    return f"{prefix}{delta}{r['ts']} {r['level'] or '-':5} {r['ref']}  {msg}{fields}"


def cmd_log(args) -> int:
    cfg = _cfg()
    try:
        tz = parse_tz(getattr(args, "tz", None) or cfg.display_tz)
    except TimeError as exc:
        raise Usage(str(exc)) from exc
    profiles = logs.profiles_from(cfg.log_profiles)
    sub = args.log_cmd
    if sub == "profiles":
        payload = {n: {"format": p.format, "tz": p.tz_spec, "pattern": p.pattern.pattern if p.pattern else None}
                   for n, p in profiles.items()}
        out(args, payload, "\n".join(f"{n}: {v['format']} tz={v['tz']} {v['pattern'] or ''}" for n, v in payload.items()))
        return 0
    if sub == "probe":
        results = [logs.probe(p, profiles) for p in logs.expand_paths(args.paths)]
        lines = []
        for r in results:
            rates = ", ".join(f"{k}={v:.0%}" for k, v in sorted(r["profile_match_rates"].items(), key=lambda x: -x[1]))
            lines += [f"{r['source']}: decoding {r['decoding']} ({r['decoding_basis']}); suggested profile "
                      f"{r['suggested_profile']}; parsed {r['parsed_records']}/{r['examined_lines']} lines, "
                      f"timestamped {r['timestamped_records']}", f"  match rates: {rates or '-'}"]
            lines += [f"  | {s}" for s in r["sample_lines"]]
            if r.get("hint"):
                lines.append(f"  hint: {r['hint']}")
        out(args, {"probes": results}, "\n".join(lines))
        return 0
    flt = _filter(args, tz)
    if sub == "diff":
        return _cmd_diff(args, cfg, tz, flt)
    sources, hint = _sources(args, cfg, args.paths, flt.since, flt.until)
    eng = _engine(args, cfg, hint)
    window = f" [{fmt_ts(flt.since, tz)}..{fmt_ts(flt.until, tz)}]" if flt.timed else ""
    if sub == "scan":
        r = logs.scan(eng, sources, flt, args.top, tz)
        lines = [f"scan: matched {_num(r['matched'])} of {_num(r['coverage']['records'])} records{window} | "
                 f"{r['distinct_templates']} templates | times in {tz}",
                 "levels: " + ", ".join(f"{k} {_num(v)}" for k, v in sorted(r["levels"].items(),
                                                                         key=lambda x: -logs.LEVEL_RANK.get(x[0], -1))),
                 "sources:", *_src_lines(r["coverage"]), f"templates (top {len(r['templates'])}):"]
        for t in r["templates"]:
            lv = ",".join(f"{k}:{v}" for k, v in t["levels"].items())
            lines.append(f"  [{t['id']}] {t['count']:>7,} {lv:14} {t['first']}..{t['last']}  {t['template'][:160]}"
                         f"  @{t['example_ref']}")
        if r["template_overflow_records"]:
            lines.append(f"  ({_num(r['template_overflow_records'])} records beyond the template cap were not grouped)")
        lines.append(_cov_line(r["coverage"]))
        lines.append("drill down: devloop log query ... --template <id>")
        claim = (f"log scan{window}: {r['matched']} records matched in {len(r['coverage']['sources'])} source(s), "
                 f"{r['distinct_templates']} templates; levels {r['levels']}")
    elif sub == "query":
        fields = [x.strip() for x in args.fields.split(",")] if args.fields else None
        r = logs.query(eng, sources, flt, None if args.limit == 0 else args.limit, args.offset, args.context, tz, fields)
        lines = [f"query: matched {_num(r['matched'])}{window} | returned {r['returned']} "
                 f"(offset {r['offset']}, limit {r['limit']})" +
                 (f" | more: --offset {r['offset'] + r['returned']}" if r["truncated"] else "")]
        lines += [_rec_line(x) for x in r["records"]]
        lines.append(_cov_line(r["coverage"]))
        claim = f"log query{window}: {r['matched']} matching records ({r['returned']} returned)"
    else:  # timeline
        r = logs.timeline(eng, sources, flt, None if args.limit == 0 else args.limit, tz)
        lines = [f"timeline: {_num(r['ordered'])} ordered of {_num(r['matched'])} matched{window} | returned "
                 f"{r['returned']} | sources: {', '.join(r['sources_in_timeline']) or '-'} | times in {tz}"]
        lines += [_rec_line(x, show_delta=True) for x in r["records"]]
        lines += [f"caveat: {c}" for c in r["caveats"]]
        lines.append(_cov_line(r["coverage"]))
        claim = (f"log timeline{window}: {r['ordered']} ordered records from "
                 f"{len(r['sources_in_timeline'])} source(s)")
    filters = _describe_filter(args)
    if filters:
        claim += f" (filters: {filters})"
    text = "\n".join(lines) + _save(args, cfg, f"log.{sub}", r, claim)
    out(args, r, text)
    return 0


def _describe_filter(args) -> str:
    parts = []
    for name in ("level", "grep"):
        if getattr(args, name, None):
            parts.append(f"{name}={getattr(args, name)}")
    parts += [f"where {w}" for w in args.where or []] + [f"key {k}" for k in args.key or []]
    parts += [f"template {t}" for t in args.template or []]
    return ", ".join(parts)


def _cmd_diff(args, cfg, tz, flt: logs.Filter) -> int:
    def side(paths, window):
        f = logs.Filter(**{**flt.__dict__})
        minutes = None
        if window:
            try:
                f.since, f.until = parse_window(window, tz)
            except TimeError as exc:
                raise Usage(str(exc)) from exc
            minutes = (f.until - f.since).total_seconds() / 60
        srcs, hint = _sources(args, cfg, paths, f.since, f.until)
        return _engine(args, cfg, hint), srcs, f, minutes

    base_paths = args.base_files or args.paths
    target_paths = args.target_files or args.paths
    if not (args.base_window or args.base_files) or not (args.target_window or args.target_files):
        raise Usage("diff needs --base-window/--target-window on the same sources, or --base-files/--target-files")
    r = logs.diff(side(base_paths, args.base_window), side(target_paths, args.target_window), args.top,
                  args.min_count, tz)
    unit = "/min" if r["rate_unit"] == "per_minute" else " share"
    lines = [f"diff: base {_num(r['base']['matched'])} records ({r['base']['distinct_templates']} templates) → "
             f"target {_num(r['target']['matched'])} ({r['target']['distinct_templates']} templates); rates{unit}"]
    for title, key in (("new in target", "new"), ("gone in target", "gone"), ("increased", "increased"),
                       ("decreased", "decreased")):
        rows = r[key]
        if not rows:
            continue
        lines.append(f"{title}:")
        for x in rows:
            ratio = f"x{x['ratio']}" if x["ratio"] is not None else ""
            lines.append(f"  [{x['id']}] {x['level']:5} {x['base']:>6} → {x['target']:<6} {ratio:>9}  "
                         f"{x['template'][:150]}  @{x['example_ref']}")
    lines.append("base " + _cov_line(r["base"]["coverage"]))
    lines.append("target " + _cov_line(r["target"]["coverage"]))
    claim = (f"log diff: base {r['base']['matched']} vs target {r['target']['matched']} records; "
             f"{len(r['new'])} new, {len(r['gone'])} gone, {len(r['increased'])} increased templates")
    out(args, r, "\n".join(lines) + _save(args, cfg, "log.diff", r, claim))
    return 0


# --- sql / db ------------------------------------------------------------------------------------

def _read_sql(args) -> str:
    if args.file:
        return Path(args.file).read_text(encoding="utf-8-sig")
    if args.sql is None or args.sql == "-":
        return sys.stdin.read()
    return args.sql


def cmd_sql(args) -> int:
    cfg = _cfg()
    sql = _read_sql(args)
    a = sqlguard.analyze_sql(sql, args.dialect, cfg.exec_allowlist or sqlguard.DEFAULT_EXEC_ALLOWLIST)
    decision = {"read": "allow", "risky": "ask", "write": "deny"}[a.classification]
    lines = [f"{a.classification} (suggested decision: {decision}); statements={a.statements}; "
             f"bounded={'yes' if a.bounded else 'no'}; dialects={','.join(a.dialects)}"]
    lines += [f"  {f.level:5} {f.code}: {f.message}" for f in a.findings]
    out(args, {**a.to_dict(), "decision": decision}, "\n".join(lines))
    return 0


def cmd_db(args) -> int:
    cfg = _cfg()
    sql = db.bind(_read_sql(args), dict(p.split("=", 1) for p in args.param or []))
    r = db.run_query(cfg, args.env, sql, allow_risky=args.allow_risky, allow_unbounded=args.allow_unbounded,
                     max_rows=args.max_rows)
    lines = [f"db {r['env']} (tier {r['tier']}, {r['driver']}): {r['returned']} row(s)"
             f"{' — TRUNCATED at max_rows' if r['truncated'] else ''}; {r['elapsed_s']}s; {r['classification']}"]
    if r.get("columns"):
        lines.append("\t".join(map(str, r["columns"])))
    lines += ["\t".join("NULL" if v is None else str(v) for v in row) for row in r["rows"]]
    if r.get("masked_columns"):
        lines.append(f"masked: {', '.join(r['masked_columns'])}")
    claim = f"db query on {r['env']} ({r['tier']}): {r['returned']} row(s){' (truncated)' if r['truncated'] else ''}; sql sha256 {r['sql_sha256'][:12]}"
    out(args, r, "\n".join(lines) + _save(args, cfg, "db.query", r, claim, scope=f"env={r['env']}"))
    return 0


# --- bot -----------------------------------------------------------------------------------------

def _builtin_probes(cfg: config.Config, env_name: str | None) -> dict:
    def db_probe(a: dict) -> dict:
        env = a.get("env") or env_name
        if not env:
            raise bot.ScenarioError("db probe needs an env")
        r = db.run_query(cfg, env, db.bind(a["sql"], a.get("params")), max_rows=int(a.get("max_rows", 50)))
        cols = r.get("columns") or []
        return {"rows": [dict(zip(cols, row)) for row in r["rows"]] if cols else r["rows"],
                "returned": r["returned"], "truncated": r["truncated"]}

    def log_probe(a: dict) -> dict:
        tz = parse_tz(cfg.display_tz)
        f = logs.Filter(conds=[logs.parse_cond(c) for c in a.get("where", [])],
                        grep=__import__("re").compile(a["grep"]) if a.get("grep") else None,
                        keys=[logs.key_pattern(k) for k in a.get("keys", [])])
        if a.get("since"):
            f.since = parse_user_time(str(a["since"]), tz)
        eng = logs.Engine(logs.profiles_from(cfg.log_profiles), a.get("profile", "auto"))
        files = [str(cfg.resolve_path(p)) for p in a.get("files", [])]
        r = logs.query(eng, logs.file_sources(files), f, int(a.get("limit", 20)), 0, 0, tz)
        return {"matched": r["matched"], "records": r["records"]}

    return {"db": db_probe, "log": log_probe}


def cmd_bot(args) -> int:
    cfg = _cfg()
    scn = bot.load_scenario(Path(args.file))
    if args.bot_cmd == "validate":
        problems = bot.validate(scn)
        out(args, {"valid": not problems, "problems": problems},
            "valid" if not problems else "invalid:\n  " + "\n  ".join(problems))
        return EXIT_FAIL if problems else 0
    for v in args.var or []:
        k, _, val = v.partition("=")
        scn.setdefault("vars", {})[k] = val
    env_name = args.env or cfg.adapters.get(args.adapter or scn.get("adapter", ""), {}).get("env")
    r = bot.run_scenario(cfg, scn, args.env, args.adapter, _builtin_probes(cfg, env_name))
    lines = [f"scenario {r['scenario']}: {r['outcome'].upper()} on {r['env']} ({r['tier']}) via {r['adapter']} "
             f"in {r['elapsed_s']}s"]
    lines += render_steps(r["steps"], args.verbose)
    repeats = [f"{s['step']} repeat {s['passed']}/{s['iterations']} passed" for s in r["steps"] if s.get("kind") == "repeat"]
    plain_fail = [x for x in r["failed_steps"] if "#" not in x and not any(x == s_["step"] for s_ in r["steps"]
                                                                          if s_.get("kind") == "repeat")]
    claim = (f"bot scenario {r['scenario']} on {r['env']} ({r['tier']}): {r['outcome']}"
             + (f"; {'; '.join(repeats)}" if repeats else "")
             + (f"; failed {', '.join(plain_fail[:5])}" if plain_fail else ""))
    out(args, r, "\n".join(lines) + _save(args, cfg, "bot.run", r, claim, kind="bot", outcome=r["outcome"],
                                          scope=f"env={r['env']}"))
    return 0 if r["outcome"] == "pass" else EXIT_FAIL


def render_steps(steps: list[dict], verbose: bool) -> list[str]:
    """One line per top-level step; repeat iterations collapse to an outcome
    distribution plus the distinct failing assertions (``--verbose`` lists all)."""
    from collections import Counter

    lines: list[str] = []
    inner: dict[str, list[dict]] = {}
    for s in steps:
        if "#" in s["step"]:
            inner.setdefault(s["step"].split("#", 1)[0], []).append(s)
    for s in steps:
        if "#" in s["step"] and not verbose:
            continue
        if s.get("kind") == "repeat":
            fails = Counter()
            spreads = []
            for x in inner.get(s["step"], []):
                if x.get("send_spread_ms") is not None:
                    spreads.append(x["send_spread_ms"])
                if x.get("error"):
                    fails[f"ERROR {x['error']}"] += 1
                for a in x.get("assertions", []):
                    if not a["ok"]:
                        fails[f"{a['assert']} (actual {json.dumps(a['actual'], ensure_ascii=False, default=str)[:80]})"] += 1
            spread = f"; send spread max {max(spreads)}ms" if spreads else ""
            lines.append(f"  {'ok ' if s['ok'] else 'FAIL'} {s['step']} repeat: {s['passed']}/{s['iterations']} "
                         f"iterations passed{spread}" + (f" — {s['note']}" if s.get("note") else ""))
            for desc, n in fails.most_common(5):
                lines.append(f"       {n}x {desc}")
            continue
        mark = "ok " if s.get("ok") else "FAIL"
        what = s.get("op") or s.get("probe") or s.get("kind")
        extra = f" spread={s['send_spread_ms']}ms" if s.get("send_spread_ms") is not None else ""
        lines.append(f"  {mark} {s['step']} {s.get('actor', '')} {what} {s.get('elapsed_ms')}ms{extra}"
                     + (f"  ERROR {s['error']}" if s.get("error") else ""))
        for a in s.get("assertions", []):
            if not a["ok"] or verbose:
                lines.append(f"       {'ok' if a['ok'] else 'FAILED'}: {a['assert']} "
                             f"(actual {json.dumps(a['actual'], ensure_ascii=False, default=str)[:200]})")
    return lines


# --- doc ---------------------------------------------------------------------------------------------

def cmd_doc(args) -> int:
    cfg = _cfg()
    r = doctext.extract(Path(args.file), args.sheet, args.max_rows, args.notes)
    lines = r["lines"]
    total = sum(len(x) + 1 for x in lines)
    shown, used = [], 0
    for x in lines:
        if used + len(x) + 1 > args.max_chars:
            break
        shown.append(x)
        used += len(x) + 1
    header = f"{args.file}: {r['kind']}" + (f", decoding {r['decoding']}" if r.get("decoding") else "")
    if len(shown) < len(lines):
        header += f" | showing {len(shown)}/{len(lines)} lines ({used}/{total} chars): narrow with --sheet or raise --max-chars"
    payload = {**r, "file": args.file}
    out(args, payload, header + "\n" + "\n".join(shown) +
        _save(args, cfg, "doc.text", payload, f"text extracted from {Path(args.file).name} ({r['kind']})"))
    return 0


def cmd_hook(args) -> int:
    text, code = hooks.run(args.event, sys.stdin.read())
    if text:
        print(text)
    return code


# --- parser ---------------------------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="devloop", description="Evidence-driven work loops for game server teams.")
    p.add_argument("--version", action="version", version=f"devloop {__version__}")
    p.add_argument("--json", action="store_true", help="structured output")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="scaffold .devloop/ (dry run unless --yes)")
    s.add_argument("--dir", default=".")
    s.add_argument("--user", action="store_true", help="create ~/.devloop/config.toml for tier markers")
    s.add_argument("--yes", action="store_true")
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("config", help="show the resolved configuration")
    s.set_defaults(fn=cmd_config)

    c = sub.add_parser("case", help="case dossiers").add_subparsers(dest="case_cmd", required=True)
    x = c.add_parser("new")
    x.add_argument("type", choices=case.TYPES)
    x.add_argument("title")
    x.add_argument("--slug")
    x.add_argument("--ref", help="ticket or related case")
    x.add_argument("--spec", help="spec file to pin (recorded as spec_rev and file evidence)")
    x = c.add_parser("list")
    x.add_argument("--all", action="store_true")
    c.add_parser("stats")
    x = c.add_parser("purge")
    x.add_argument("--older-than", type=int, required=True, metavar="DAYS")
    x.add_argument("--yes", action="store_true")
    for name in ("show", "check"):
        x = c.add_parser(name)
        x.add_argument("id")
        if name == "show":
            x.add_argument("--last", type=int, default=12, help="evidence entries to list")
    x = c.add_parser("status")
    x.add_argument("id")
    x.add_argument("status", choices=[s_ for s_ in case.STATUSES if s_ != "closed"])
    x.add_argument("--note")
    x = c.add_parser("ask")
    x.add_argument("id")
    x.add_argument("text")
    x.add_argument("--to", help="who must answer (기획, 운영, QA, ...)")
    x = c.add_parser("answer")
    x.add_argument("id")
    x.add_argument("qid")
    x.add_argument("text")
    x.add_argument("--ref", help="where the answer came from")
    x.add_argument("--defer", action="store_true")
    x = c.add_parser("decide")
    x.add_argument("id")
    x.add_argument("text")
    x.add_argument("--by", required=True, help="the person who decided")
    x = c.add_parser("close")
    x.add_argument("id")
    x.add_argument("--reason", required=True)
    x.add_argument("--of", help="original case for duplicate")
    x.add_argument("--force", metavar="WHY", help="bypass failing gates (recorded)")
    for parser in c.choices.values():
        parser.set_defaults(fn=cmd_case)

    e = sub.add_parser("ev", help="evidence ledger").add_subparsers(dest="ev_cmd", required=True)
    x = e.add_parser("add")
    x.add_argument("id")
    x.add_argument("--kind", required=True, choices=list(ledger.KINDS))
    x.add_argument("--claim", required=True)
    x.add_argument("--grade")
    x.add_argument("--ref")
    x.add_argument("--scope", help="env, build, time window the evidence covers")
    x.add_argument("--from", dest="from_", help="premises for kind derived: E1,E2")
    x.add_argument("--supersedes")
    x.add_argument("--how", help="how to check (kind unknown)")
    x.add_argument("--attach", help="file to copy into artifacts (kind artifact/review)")
    x = e.add_parser("run")
    x.add_argument("id")
    x.add_argument("--claim", required=True)
    x.add_argument("--scope")
    x.add_argument("--timeout", type=float)
    x.add_argument("command", nargs=argparse.REMAINDER)
    x = e.add_parser("list")
    x.add_argument("id")
    x.add_argument("--kind")
    for parser in e.choices.values():
        parser.set_defaults(fn=cmd_ev)

    lg = sub.add_parser("log", help="log forensics").add_subparsers(dest="log_cmd", required=True)
    lg.add_parser("profiles")
    x = lg.add_parser("probe")
    x.add_argument("paths", nargs="+")
    for name in ("scan", "query", "timeline", "diff"):
        x = lg.add_parser(name)
        x.add_argument("paths", nargs="*", help="files, globs, directories or '-'")
        x.add_argument("--source", help="configured command source")
        x.add_argument("--param", action="append", help="source parameter k=v")
        x.add_argument("--profile", help="profile name (default auto)")
        x.add_argument("--since")
        x.add_argument("--until")
        x.add_argument("--level", help="minimum level, e.g. WARN")
        x.add_argument("--grep", help="regex on the raw record")
        x.add_argument("--where", action="append", help="field condition: k=v, k!=v, k~re, k>n")
        x.add_argument("--key", action="append", help="whole-token value (uid, match id), any of")
        x.add_argument("--template", action="append", help="template id from scan")
        x.add_argument("--no-unparsed", action="store_true")
        x.add_argument("--tz", help="display time zone (default config display_tz)")
        x.add_argument("--save", metavar="CASE")
        x.add_argument("--note", help="appended to the saved evidence claim")
        if name in {"scan", "diff"}:
            x.add_argument("--top", type=int, default=20)
        if name in {"query", "timeline"}:
            x.add_argument("--limit", type=int, default=50, help="0 = no limit")
        if name == "query":
            x.add_argument("--offset", type=int, default=0)
            x.add_argument("--context", type=int, default=0)
            x.add_argument("--fields", help="comma list of fields to show")
        if name == "diff":
            x.add_argument("--base-window")
            x.add_argument("--target-window")
            x.add_argument("--base-files", action="append")
            x.add_argument("--target-files", action="append")
            x.add_argument("--min-count", type=int, default=3)
    for parser in lg.choices.values():
        parser.set_defaults(fn=cmd_log)

    s = sub.add_parser("sql", help="SQL classification").add_subparsers(dest="sql_cmd", required=True)
    x = s.add_parser("check")
    x.add_argument("sql", nargs="?")
    x.add_argument("--file")
    x.add_argument("--dialect", default="auto", choices=sqlguard.DIALECTS)
    x.set_defaults(fn=cmd_sql)

    s = sub.add_parser("db", help="read-only queries").add_subparsers(dest="db_cmd", required=True)
    x = s.add_parser("query")
    x.add_argument("sql", nargs="?")
    x.add_argument("--env", required=True)
    x.add_argument("--file")
    x.add_argument("--param", action="append", help="bind :name placeholders, k=v")
    x.add_argument("--max-rows", type=int)
    x.add_argument("--allow-risky", action="store_true")
    x.add_argument("--allow-unbounded", action="store_true")
    x.add_argument("--save", metavar="CASE")
    x.add_argument("--note")
    x.set_defaults(fn=cmd_db)

    s = sub.add_parser("bot", help="bot scenarios").add_subparsers(dest="bot_cmd", required=True)
    x = s.add_parser("validate")
    x.add_argument("file")
    x = s.add_parser("run")
    x.add_argument("file")
    x.add_argument("--env")
    x.add_argument("--adapter")
    x.add_argument("--var", action="append", help="k=v scenario variable")
    x.add_argument("--save", metavar="CASE")
    x.add_argument("--note")
    x.add_argument("--verbose", action="store_true")
    for parser in s.choices.values():
        parser.set_defaults(fn=cmd_bot)

    s = sub.add_parser("doc", help="spec/data-table text").add_subparsers(dest="doc_cmd", required=True)
    x = s.add_parser("text")
    x.add_argument("file")
    x.add_argument("--sheet")
    x.add_argument("--max-rows", type=int, default=500)
    x.add_argument("--max-chars", type=int, default=60000)
    x.add_argument("--notes", action="store_true", help="include slide notes")
    x.add_argument("--save", metavar="CASE")
    x.add_argument("--note")
    x.set_defaults(fn=cmd_doc)

    s = sub.add_parser("hook", help="Claude Code hook entry point")
    s.add_argument("event", choices=["pretooluse", "sessionstart"])
    s.set_defaults(fn=cmd_hook)
    return p


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except db.Refused as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED
    except case.GateError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_FAIL
    except bot.ScenarioError as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED if str(exc).startswith("refused") else EXIT_USAGE
    except (Usage, config.ConfigError, case.CaseError, ledger.LedgerError, logs.LogError, db.DbError,
            doctext.DocError, TimeError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_USAGE
    except BrokenPipeError:
        return 0
