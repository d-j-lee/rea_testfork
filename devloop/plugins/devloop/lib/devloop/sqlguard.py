"""Read-only classification for SQL and Redis commands.

This is a mistake-prevention layer, not a security boundary: shared databases
must still be reached through read-only accounts. The classifier owns the
interpretation of statement text; callers (CLI policy, hooks) only map its
classification to decisions.

Classification order: ``write`` > ``risky`` > ``read``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

READ, RISKY, WRITE = "read", "risky", "write"
_RANK = {READ: 0, RISKY: 1, WRITE: 2}

# Lexer profiles mirror how each engine reads comments and literals. With
# ``auto`` every profile runs and the strictest classification wins, so text
# that one engine reads as a comment cannot hide a statement another executes.
_PROFILES = {
    "mssql": dict(backslash=False, dollar=False, hash_comment=False, nested=True, brackets=True),
    "mysql": dict(backslash=True, dollar=False, hash_comment=True, nested=False, brackets=False),
    "postgres": dict(backslash=False, dollar=True, hash_comment=False, nested=True, brackets=False),
    "sqlite": dict(backslash=False, dollar=False, hash_comment=False, nested=False, brackets=True),
}
DIALECTS = ("auto", *_PROFILES)

_WRITE_KEYWORDS = {
    "INSERT", "DELETE", "MERGE", "UPSERT", "TRUNCATE", "DROP", "ALTER", "CREATE", "RENAME",
    "GRANT", "REVOKE", "DENY", "CALL", "LOAD", "COPY", "BACKUP", "RESTORE", "DBCC", "KILL",
    "SHUTDOWN", "RECONFIGURE", "CHECKPOINT", "BULK", "VACUUM", "REINDEX", "CLUSTER", "REFRESH",
    "IMPORT", "ATTACH", "DETACH", "HANDLER", "DISCARD", "NOTIFY", "PREPARE", "DEALLOCATE",
    "FLUSH", "PURGE", "INSTALL", "UNINSTALL", "OPTIMIZE", "REPAIR", "LOCK", "UNLOCK",
    "OPENROWSET", "OPENQUERY", "OPENDATASOURCE", "SETUSER", "REVERT", "ENABLE", "DISABLE",
}
_TXN_KEYWORDS = {"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "START"}
_LOCK_HINTS = {"UPDLOCK", "XLOCK", "HOLDLOCK", "TABLOCK", "TABLOCKX", "PAGLOCK", "SERIALIZABLE",
               "REPEATABLEREAD"}
_DIRTY_HINTS = {"NOLOCK", "READUNCOMMITTED"}
_BOUND_KEYWORDS = {"TOP", "LIMIT", "FETCH", "ROWNUM", "ROWCOUNT"}
_AGGREGATES = {"COUNT", "COUNT_BIG", "SUM", "MIN", "MAX", "AVG"}
_READ_STARTERS = {"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "VALUES", "TABLE",
                  "USE", "SET", "DECLARE", "PRINT", "IF", "PRAGMA"}
_SET_WRITES = {"GLOBAL", "PERSIST", "PERSIST_ONLY", "PASSWORD", "ROLE", "IDENTITY_INSERT"}
_WRITE_FUNCTIONS = {"PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND", "SETVAL", "NEXTVAL", "LO_IMPORT",
                    "LO_EXPORT", "LO_UNLINK", "DBLINK_EXEC", "PG_RELOAD_CONF", "SET_CONFIG",
                    "PG_ROTATE_LOGFILE"}
_RISKY_FUNCTIONS = {"SLEEP", "BENCHMARK", "PG_SLEEP", "PG_ADVISORY_LOCK", "PG_ADVISORY_XACT_LOCK",
                    "GET_LOCK"}

DEFAULT_EXEC_ALLOWLIST = (
    "sp_help", "sp_helptext", "sp_helpindex", "sp_columns", "sp_who", "sp_who2", "sp_lock",
    "sp_tables", "sp_fkeys", "sp_pkeys", "sp_depends", "sp_spaceused",
)


@dataclass
class Finding:
    level: str  # read (informational) | risky | write
    code: str
    message: str


@dataclass
class SqlAnalysis:
    classification: str
    findings: list[Finding] = field(default_factory=list)
    statements: int = 0
    bounded: bool = False
    dialects: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {
            "classification": self.classification,
            "statements": self.statements,
            "bounded": self.bounded,
            "dialects": list(self.dialects),
            "findings": [f.__dict__ for f in self.findings],
        }


@dataclass
class _Tok:
    kind: str  # word | ident | str | num | op | nl | sep
    value: str
    adjacent: bool = False  # no whitespace before this token


def _lex(sql: str, *, backslash: bool, dollar: bool, hash_comment: bool, nested: bool,
         brackets: bool) -> tuple[list[_Tok], list[str]]:
    toks: list[_Tok] = []
    problems: list[str] = []
    i, n = 0, len(sql)
    spaced = True

    def push(kind: str, value: str) -> None:
        nonlocal spaced
        toks.append(_Tok(kind, value, adjacent=not spaced))
        spaced = False

    while i < n:
        c = sql[i]
        if c == "\n":
            toks.append(_Tok("nl", "\n"))
            spaced = True
            i += 1
            continue
        if c.isspace():
            spaced = True
            i += 1
            continue
        if sql.startswith("--", i) or (hash_comment and c == "#"):
            j = sql.find("\n", i)
            i = n if j < 0 else j
            spaced = True
            continue
        if sql.startswith("/*", i):
            if sql.startswith("/*!", i):
                # MySQL executes versioned comments; expose their content as code.
                i += 3
                while i < n and sql[i].isdigit():
                    i += 1
                spaced = True
                continue
            depth, j = 1, i + 2
            while j < n and depth:
                if nested and sql.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif sql.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            if depth:
                problems.append("unterminated block comment")
            i = j
            spaced = True
            continue
        if c == "'":
            esc = backslash or (toks and toks[-1].kind == "word" and toks[-1].value.upper() == "E"
                                and not spaced)
            j = i + 1
            closed = False
            while j < n:
                if esc and sql[j] == "\\":
                    j += 2
                    continue
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    closed = True
                    break
                j += 1
            if not closed:
                problems.append("unterminated string literal")
            push("str", "")
            i = j + 1
            continue
        if c in "\"`" or (brackets and c == "["):
            close = {"\"": "\"", "`": "`", "[": "]"}[c]
            j = i + 1
            closed = False
            while j < n:
                if c == "\"" and backslash and sql[j] == "\\":
                    j += 2
                    continue
                if sql[j] == close:
                    if j + 1 < n and sql[j + 1] == close:
                        j += 2
                        continue
                    closed = True
                    break
                j += 1
            if not closed:
                problems.append("unterminated quoted identifier")
            push("ident", sql[i + 1:j])
            i = j + 1
            continue
        if dollar and c == "$" and not (i + 1 < n and sql[i + 1].isdigit()):
            j = i + 1
            while j < n and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            if j < n and sql[j] == "$":
                tag = sql[i:j + 1]
                end = sql.find(tag, j + 1)
                if end < 0:
                    problems.append("unterminated dollar-quoted string")
                    i = n
                else:
                    i = end + len(tag)
                push("str", "")
                continue
        if c.isalpha() or c in "_@" or (c == "#" and not hash_comment):
            j = i + 1
            while j < n and (sql[j].isalnum() or sql[j] in "_@#$"):
                j += 1
            push("word", sql[i:j])
            i = j
            continue
        if c.isdigit():
            j = i + 1
            while j < n and (sql[j].isalnum() or sql[j] == "."):
                j += 1
            push("num", sql[i:j])
            i = j
            continue
        push("sep" if c == ";" else "op", c)
        i += 1
    return toks, problems


def _statements(toks: list[_Tok]) -> list[list[_Tok]]:
    """Split on ';' and T-SQL ``GO`` lines. T-SQL also runs statements without
    separators, so keyword checks always scan every token, not just starters."""
    out: list[list[_Tok]] = [[]]
    line_start = True
    for idx, t in enumerate(toks):
        if t.kind == "nl":
            line_start = True
            continue
        if t.kind == "sep":
            out.append([])
            line_start = False
            continue
        if line_start and t.kind == "word" and t.value.upper() == "GO":
            rest = toks[idx + 1:idx + 3]
            if not rest or rest[0].kind == "nl" or (rest[0].kind == "num" and (len(rest) < 2 or rest[1].kind == "nl")):
                out.append([])
                line_start = False
                continue
        out[-1].append(t)
        line_start = False
    return [s for s in out if s]


def _analyze_tokens(toks: list[_Tok], problems: list[str], exec_allow: set[str]) -> tuple[list[Finding], int, bool]:
    findings: list[Finding] = [Finding(RISKY, "parse", f"{p}; statement text is ambiguous") for p in problems]
    words = [t for t in toks if t.kind != "nl"]

    def nxt(k: int, off: int = 1) -> _Tok | None:
        j = k + off
        return words[j] if 0 <= j < len(words) else None

    def prev_word(k: int) -> str:
        p = nxt(k, -1)
        return p.value.upper() if p is not None and p.kind == "word" else ""

    for k, t in enumerate(words):
        if t.kind != "word":
            continue
        u = t.value.upper()
        following = nxt(k)
        is_call = following is not None and following.kind == "op" and following.value == "("
        if u == "UPDATE":
            if prev_word(k) in {"FOR", "KEY"}:
                findings.append(Finding(RISKY, "locking-read", "FOR UPDATE takes row locks"))
            else:
                findings.append(Finding(WRITE, "dml", "UPDATE modifies rows"))
        elif u == "REPLACE":
            if not is_call:
                findings.append(Finding(WRITE, "dml", "REPLACE statement modifies rows"))
        elif u == "INTO":
            if prev_word(k) not in {"INSERT", "MERGE", "REPLACE"}:
                findings.append(Finding(WRITE, "select-into", "INTO creates a table or writes a file/variable"))
        elif u in {"EXEC", "EXECUTE"}:
            target = _exec_target(words, k)
            if target is None:
                findings.append(Finding(WRITE, "dynamic-sql", f"{u} of dynamic SQL cannot be classified"))
            elif target.lower() in exec_allow:
                findings.append(Finding(READ, "exec-allowed", f"{u} {target} is allowlisted"))
            else:
                findings.append(Finding(WRITE, "exec", f"{u} {target} may modify data"))
        elif u == "SET":
            f = nxt(k)
            fv = f.value.upper() if f is not None and f.kind == "word" else ""
            if fv in _SET_WRITES or fv.startswith("@@GLOBAL"):
                findings.append(Finding(WRITE, "admin", f"SET {fv} changes server or identity state"))
        elif u == "ANALYZE":
            if prev_word(k) == "EXPLAIN":
                findings.append(Finding(RISKY, "explain-analyze", "EXPLAIN ANALYZE executes the statement"))
            else:
                findings.append(Finding(WRITE, "admin", "ANALYZE updates statistics"))
        elif u == "COMMENT":
            f = nxt(k)
            if f is not None and f.kind == "word" and f.value.upper() == "ON":
                findings.append(Finding(WRITE, "ddl", "COMMENT ON changes the catalog"))
        elif u == "DO":
            if prev_word(k) not in {"CONFLICT"}:
                findings.append(Finding(WRITE, "do", "DO runs procedural code"))
        elif u == "SHARE" and prev_word(k) in {"FOR", "IN"}:
            findings.append(Finding(RISKY, "locking-read", "shared-lock read"))
        elif u == "WAITFOR":
            findings.append(Finding(RISKY, "delay", "WAITFOR holds the connection"))
        elif u in _WRITE_KEYWORDS:
            findings.append(Finding(WRITE, "dml-ddl-admin", f"{u} is not read-only"))
        elif u in _TXN_KEYWORDS:
            findings.append(Finding(RISKY, "transaction", f"{u} controls a transaction"))
        elif u in _LOCK_HINTS:
            findings.append(Finding(RISKY, "lock-hint", f"{u} takes or holds locks"))
        elif u in _DIRTY_HINTS:
            findings.append(Finding(READ, "dirty-read", f"{u}: uncommitted data may be read"))
        elif is_call and u in _WRITE_FUNCTIONS:
            findings.append(Finding(WRITE, "side-effect-function", f"{u}() has side effects"))
        elif is_call and u in _RISKY_FUNCTIONS:
            findings.append(Finding(RISKY, "side-effect-function", f"{u}() blocks or locks"))
        elif u == "PRAGMA":
            j = k + 1
            while j < len(words) and (words[j].kind in {"word", "ident"} or words[j].value == "."):
                j += 1
            if j < len(words) and words[j].value == "=":
                findings.append(Finding(WRITE, "pragma", "PRAGMA assignment changes database state"))

    stmts = _statements(toks)
    bounded = all(_result_bounded(s) for s in stmts)
    for s in stmts:
        first = s[0]
        if first.kind == "op" and first.value == "(":
            continue
        if first.kind != "word":
            findings.append(Finding(RISKY, "statement-start", "statement does not start with a keyword"))
            continue
        u = first.value.upper()
        if u in _READ_STARTERS or u in _WRITE_KEYWORDS or u in _TXN_KEYWORDS or u in {
                "UPDATE", "REPLACE", "EXEC", "EXECUTE", "DO", "ANALYZE", "COMMENT", "WAITFOR"}:
            continue
        if first.value.lower().split(".")[-1] in exec_allow:
            continue
        findings.append(Finding(RISKY, "statement-start",
                                f"unrecognized statement start {first.value!r} (procedure call?)"))
    if len(stmts) > 1:
        findings.append(Finding(READ, "multi-statement", f"{len(stmts)} statements"))
    return findings, len(stmts), bounded


def _result_bounded(stmt: list[_Tok]) -> bool:
    """Whether the result row count is bounded (not whether the scan is cheap).
    Aggregates and GROUP BY count only at the outermost query level."""
    top: list[tuple[str, bool]] = []  # (UPPER word, followed by "(") at depth 0
    depth = 0
    for j, t in enumerate(stmt):
        if t.kind == "op" and t.value == "(":
            depth += 1
        elif t.kind == "op" and t.value == ")":
            depth = max(0, depth - 1)
        elif t.kind == "word" and depth == 0:
            nxt = stmt[j + 1] if j + 1 < len(stmt) else None
            top.append((t.value.upper(), nxt is not None and nxt.value == "("))
    words = [w for w, _ in top]
    if not words or words[0] not in {"SELECT", "WITH", "VALUES", "TABLE"}:
        return True
    if any(t.kind == "word" and t.value.upper() in _BOUND_KEYWORDS for t in stmt):
        return True
    if "FROM" not in words and words[0] != "WITH":
        return True
    has_aggregate = any(w in _AGGREGATES and call for w, call in top)
    return has_aggregate and "GROUP" not in words


def _exec_target(words: list[_Tok], k: int) -> str | None:
    j = k + 1
    # EXEC @rc = proc ...
    if j + 1 < len(words) and words[j].kind == "word" and words[j].value.startswith("@") \
            and words[j + 1].value == "=":
        j += 2
    if j >= len(words) or words[j].kind not in {"word", "ident"}:
        return None
    if words[j].value.startswith("@"):
        return None  # EXEC @sql: dynamic
    parts = [words[j].value]
    while j + 2 < len(words) and words[j + 1].value == "." and words[j + 2].kind in {"word", "ident"}:
        parts.append(words[j + 2].value)
        j += 2
    return parts[-1]


def analyze_sql(sql: str, dialect: str = "auto", exec_allowlist=DEFAULT_EXEC_ALLOWLIST) -> SqlAnalysis:
    if dialect not in DIALECTS:
        raise ValueError(f"unknown dialect {dialect!r}; choose one of {', '.join(DIALECTS)}")
    names = tuple(_PROFILES) if dialect == "auto" else (dialect,)
    allow = {p.lower() for p in exec_allowlist}
    merged: list[Finding] = []
    seen: set[tuple[str, str]] = set()
    statements, bounded = 0, True
    for name in names:
        toks, problems = _lex(sql, **_PROFILES[name])
        findings, count, is_bounded = _analyze_tokens(toks, problems, allow)
        statements = max(statements, count)
        bounded = bounded and is_bounded
        for f in findings:
            key = (f.code, f.message)
            if key not in seen:
                seen.add(key)
                merged.append(f)
    if statements == 0:
        merged.append(Finding(RISKY, "empty", "no statement found"))
    cls = max((f.level for f in merged), key=_RANK.__getitem__, default=READ)
    merged.sort(key=lambda f: -_RANK[f.level])
    return SqlAnalysis(cls, merged, statements, bounded, names)


# --- Redis -----------------------------------------------------------------

_REDIS_READ = {
    "GET", "MGET", "HGET", "HMGET", "HGETALL", "HKEYS", "HVALS", "HLEN", "HEXISTS", "HSTRLEN",
    "LRANGE", "LLEN", "LINDEX", "SMEMBERS", "SISMEMBER", "SMISMEMBER", "SCARD", "SRANDMEMBER",
    "ZRANGE", "ZRANGEBYSCORE", "ZREVRANGE", "ZREVRANGEBYSCORE", "ZSCORE", "ZRANK", "ZREVRANK",
    "ZCARD", "ZCOUNT", "TTL", "PTTL", "EXISTS", "TYPE", "STRLEN", "SCAN", "HSCAN", "SSCAN",
    "ZSCAN", "INFO", "PING", "DBSIZE", "GETRANGE", "BITCOUNT", "GETBIT", "XRANGE", "XREVRANGE",
    "XLEN", "XINFO", "PFCOUNT", "OBJECT", "MEMORY", "TIME", "ECHO", "SELECT", "AUTH", "HELLO",
}
_REDIS_RISKY = {"KEYS", "MONITOR", "DEBUG", "SUBSCRIBE", "PSUBSCRIBE", "CLIENT", "SLOWLOG", "LATENCY"}


def analyze_redis(argv: list[str]) -> SqlAnalysis:
    """Classify one redis-cli command (already split from the connection options)."""
    if not argv:
        return SqlAnalysis(RISKY, [Finding(RISKY, "redis-interactive", "interactive redis-cli session cannot be classified")], 0)
    verb = argv[0].upper()
    if verb in _REDIS_READ:
        return SqlAnalysis(READ, [Finding(READ, "redis-read", f"{verb} is read-only")], 1)
    if verb in _REDIS_RISKY:
        return SqlAnalysis(RISKY, [Finding(RISKY, "redis-blocking", f"{verb} can block or expose the server")], 1)
    return SqlAnalysis(WRITE, [Finding(WRITE, "redis-write", f"{verb} is not in the read-only command list")], 1)
