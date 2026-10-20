"""Read-only queries against configured environments.

``devloop db query`` is the sanctioned path to shared databases: it classifies
the SQL, applies the target tier's policy, bounds the output, masks configured
columns and records provenance. It never runs a statement classified as a
write. Read-only database accounts remain the actual boundary.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import subprocess
import time

from . import sqlguard, textio
from .config import Config

DEFAULT_MAX_ROWS = 200


class DbError(ValueError):
    pass


class Refused(DbError):
    """The statement or target is outside policy; nothing was executed."""


def sql_literal(value) -> str:
    """Render a probe parameter as a SQL literal. Strings that need backslash or
    NUL handling are refused rather than escaped per dialect."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    s = str(value)
    if "\\" in s or "\x00" in s:
        raise DbError(f"parameter {s!r} contains a backslash or NUL; pass it as a number or a plain string")
    return "'" + s.replace("'", "''") + "'"


def bind(sql: str, params: dict | None) -> str:
    """Replace :name placeholders with literals (only names present in params)."""
    if not params:
        return sql

    def rep(m: re.Match) -> str:
        name = m.group(1)
        return sql_literal(params[name]) if name in params else m.group(0)

    return re.sub(r"(?<![:\w]):([A-Za-z_]\w*)", rep, sql)


def evaluate(cfg: Config, env_name: str, sql: str, allow_risky: bool, allow_unbounded: bool) -> tuple[dict, dict, sqlguard.SqlAnalysis]:
    env = cfg.env(env_name)
    db = env.get("db")
    if not db:
        raise DbError(f"env {env_name} has no [env.{env_name}.db] section")
    tier = env.get("tier", "unknown")
    policy = cfg.policy(tier)
    allow = cfg.exec_allowlist or sqlguard.DEFAULT_EXEC_ALLOWLIST
    analysis = sqlguard.analyze_sql(sql, db.get("dialect", "auto"), allow)
    reasons = "; ".join(f.message for f in analysis.findings if f.level != sqlguard.READ)
    if analysis.classification == sqlguard.WRITE:
        raise Refused(f"refused: statement is not read-only ({reasons}). devloop never executes writes; "
                      "draft the change as a reviewed script for a person to run")
    if analysis.classification == sqlguard.RISKY and not allow_risky:
        raise Refused(f"refused: risky statement ({reasons}). Rewrite it, or pass --allow-risky "
                      "(the guard asks a person on stage/live)")
    if policy.get("require_bounded") and not analysis.bounded and not allow_unbounded:
        raise Refused(f"refused: tier {tier} requires a bounded result (TOP/LIMIT/FETCH or an aggregate). "
                      "Add a bound, or pass --allow-unbounded")
    return env, db, analysis


def run_query(cfg: Config, env_name: str, sql: str, *, allow_risky: bool = False, allow_unbounded: bool = False,
              max_rows: int | None = None) -> dict:
    env, db, analysis = evaluate(cfg, env_name, sql, allow_risky, allow_unbounded)
    limit = int(max_rows or db.get("max_rows", DEFAULT_MAX_ROWS))
    masks = {c.lower() for c in db.get("mask_columns", [])}
    driver = db.get("driver", "command")
    started = time.monotonic()
    if driver == "sqlite":
        result = _sqlite(cfg, db, sql, limit)
    elif driver == "command":
        result = _command(db, sql, limit)
    else:
        raise DbError(f"env {env_name}: unknown db driver {driver!r} (sqlite | command)")
    if masks:
        if result.get("columns") is None:
            raise Refused("refused: mask_columns is configured but the output is not tabular; "
                          "set output = \"tsv\" for this env so columns can be masked")
        idx = [i for i, c in enumerate(result["columns"]) if c.lower() in masks]
        for row in result["rows"]:
            for i in idx:
                if i < len(row):
                    row[i] = "***"
        result["masked_columns"] = [result["columns"][i] for i in idx]
    result.update({
        "env": env_name, "tier": env.get("tier"), "sql": sql,
        "sql_sha256": hashlib.sha256(sql.encode("utf-8")).hexdigest(),
        "classification": analysis.classification, "bounded": analysis.bounded,
        "findings": [f.__dict__ for f in analysis.findings],
        "elapsed_s": round(time.monotonic() - started, 3), "max_rows": limit,
    })
    return result


def _sqlite(cfg: Config, db: dict, sql: str, limit: int) -> dict:
    path = cfg.resolve_path(db["path"])
    if not path.is_file():
        raise DbError(f"sqlite database not found: {path}")
    uri = "file:" + path.as_posix().replace("?", "%3f") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=float(db.get("timeout", 10)))
    try:
        con.execute("PRAGMA query_only = ON")
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchmany(limit + 1)
    except sqlite3.Error as exc:
        raise DbError(f"sqlite error: {exc}") from exc
    finally:
        con.close()
    truncated = len(rows) > limit
    return {"driver": "sqlite", "target": str(path), "columns": cols,
            "rows": [list(r) for r in rows[:limit]], "returned": min(len(rows), limit), "truncated": truncated}


def _command(db: dict, sql: str, limit: int) -> dict:
    template = db.get("command")
    if not isinstance(template, list) or not template or not any("{sql}" in str(a) for a in template):
        raise DbError("command driver needs command = [..] with a '{sql}' argument (argv form, no shell)")
    argv = [os.path.expandvars(str(a)).replace("{sql}", sql) if "{sql}" in str(a) else os.path.expandvars(str(a))
            for a in template]
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=float(db.get("timeout", 30)))
    except FileNotFoundError as exc:
        raise DbError(f"database client not found: {argv[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise DbError(f"query timed out after {db.get('timeout', 30)}s; add a DB-side statement timeout too") from exc
    text, stats = textio.decode_output(proc.stdout, db.get("output_encoding", "auto"))
    err, _ = textio.decode_output(proc.stderr, db.get("output_encoding", "auto"))
    lines = [ln for ln in text.split("\n") if ln.strip()]
    out = {"driver": "command", "target": template[0], "command_template": template, "exit_code": proc.returncode,
           "stderr": err[-2000:] or None, "decoding": stats.label()}
    if proc.returncode != 0:
        raise DbError(f"database client exited {proc.returncode}: {err.strip()[-500:]}")
    if db.get("output") == "tsv":
        header = lines[0].split("\t") if lines else []
        body = [ln.split("\t") for ln in lines[1:]]
        out.update(columns=header, rows=body[:limit], returned=min(len(body), limit), truncated=len(body) > limit)
    else:
        out.update(columns=None, rows=[[ln] for ln in lines[:limit]], returned=min(len(lines), limit),
                   truncated=len(lines) > limit)
    return out
