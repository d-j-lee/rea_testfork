"""Declarative bot scenarios over a team-provided adapter.

The runner owns sequencing, concurrency, assertions and the result record; the
adapter owns the game protocol. A parallel block opens no connections itself:
actors log in during earlier steps, then branch threads wait on a barrier so
requests leave the client together. That aligns client send times only, not
server arrival, so race checks should repeat and report the outcome
distribution rather than rely on one run.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from .config import Config

_MISSING = object()
DEFAULT_TIERS = ["local", "dev", "qa"]


class ScenarioError(ValueError):
    pass


# --- paths and variables ------------------------------------------------------------

_PATH_TOKEN = re.compile(r"\.([A-Za-z_][\w\-]*)|\[(\d+)\]|\[\"([^\"]+)\"\]")


def get_path(obj, path: str):
    if path in {"$", ""}:
        return obj
    if not path.startswith("$"):
        raise ScenarioError(f"path {path!r} must start with '$'")
    rest = path[1:]
    pos = 0
    cur = obj
    while pos < len(rest):
        m = _PATH_TOKEN.match(rest, pos)
        if not m:
            raise ScenarioError(f"bad path {path!r} near {rest[pos:]!r}")
        pos = m.end()
        key = m.group(1) or m.group(3)
        if key is not None:
            if key == "length" and isinstance(cur, (list, str)):
                cur = len(cur)
            elif isinstance(cur, dict) and key in cur:
                cur = cur[key]
            else:
                return _MISSING
        else:
            i = int(m.group(2))
            if isinstance(cur, list) and -len(cur) <= i < len(cur):
                cur = cur[i]
            else:
                return _MISSING
    return cur


_VAR = re.compile(r"\$\{([A-Za-z_][\w]*)((?:\.[A-Za-z_][\w\-]*|\[\d+\])*)\}")


def interpolate(value, variables: dict):
    if isinstance(value, str):
        whole = _VAR.fullmatch(value)
        if whole:
            return _lookup(whole, variables)
        return _VAR.sub(lambda m: str(_lookup(m, variables)), value)
    if isinstance(value, list):
        return [interpolate(v, variables) for v in value]
    if isinstance(value, dict):
        return {k: interpolate(v, variables) for k, v in value.items()}
    return value


def _lookup(m: re.Match, variables: dict):
    name, rest = m.group(1), m.group(2)
    if name not in variables:
        raise ScenarioError(f"undefined variable ${{{name}}}")
    v = get_path(variables[name], "$" + rest) if rest else variables[name]
    if v is _MISSING:
        raise ScenarioError(f"${{{name}{rest}}} does not exist")
    return v


# --- assertions --------------------------------------------------------------------------

_OPS = {
    "eq": lambda a, b: a == b, "ne": lambda a, b: a != b,
    "gt": lambda a, b: a is not None and a > b, "ge": lambda a, b: a is not None and a >= b,
    "lt": lambda a, b: a is not None and a < b, "le": lambda a, b: a is not None and a <= b,
    "contains": lambda a, b: a is not None and b in a, "in": lambda a, b: a in b,
    "matches": lambda a, b: a is not None and re.search(b, str(a)) is not None,
    "exists": lambda a, b: a is not _MISSING, "not_exists": lambda a, b: a is _MISSING,
}


def check_assert(spec: dict, response, variables: dict) -> dict:
    op = spec.get("op", "eq")
    if op not in _OPS:
        raise ScenarioError(f"unknown assertion op {op!r}; use {', '.join(_OPS)}")
    expected = interpolate(spec.get("value"), variables)
    if "count" in spec:
        inner = spec["count"]
        if not isinstance(response, list):
            raise ScenarioError("count assertions apply to parallel results")
        actual = sum(1 for r in response if _safe(_OPS[inner.get("op", "eq")], get_path(r, inner["path"]),
                                                   interpolate(inner.get("value"), variables)))
        desc = f"count({inner['path']} {inner.get('op', 'eq')} {inner.get('value')!r}) {op} {expected!r}"
    else:
        actual = get_path(response, spec["path"])
        desc = f"{spec['path']} {op} {expected!r}" if op not in {"exists", "not_exists"} else f"{spec['path']} {op}"
    ok = _safe(_OPS[op], actual, expected)
    return {"assert": desc, "ok": ok, "actual": None if actual is _MISSING else actual}


def _safe(fn, a, b) -> bool:
    try:
        return bool(fn(a, b))
    except (TypeError, ValueError, re.error):
        return False


# --- adapters ------------------------------------------------------------------------------

class ProcessAdapter:
    """Wrap an existing bot (any language) speaking JSON lines on stdin/stdout.

    Requests: {"id", "cmd": open|call|probe|events|close, ...}; responses carry
    the same id with "result" or "error". Requests may be answered out of order,
    which is what lets parallel branches reach the server concurrently.
    """

    def __init__(self, command: list[str], cwd: str | None = None, startup_timeout: float = 10):
        self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     cwd=cwd, text=True, encoding="utf-8", bufsize=1)
        self._lock = threading.Lock()
        self._next = 0
        self._waiters: dict[int, tuple[threading.Event, list]] = {}
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()
        self._stderr: list[str] = []
        threading.Thread(target=self._drain, daemon=True).start()

    def _drain(self) -> None:
        for line in self.proc.stderr:  # type: ignore[union-attr]
            if len(self._stderr) < 200:
                self._stderr.append(line.rstrip())

    def _read(self) -> None:
        for line in self.proc.stdout:  # type: ignore[union-attr]
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            w = self._waiters.get(msg.get("id"))
            if w:
                w[1].append(msg)
                w[0].set()

    def request(self, payload: dict, timeout: float) -> dict:
        ev, box = threading.Event(), []
        with self._lock:
            self._next += 1
            rid = self._next
            self._waiters[rid] = (ev, box)
            if self.proc.poll() is not None:
                raise ScenarioError(f"bot process exited ({self.proc.returncode}): {' | '.join(self._stderr[-5:])}")
            self.proc.stdin.write(json.dumps({"id": rid, **payload}, ensure_ascii=False) + "\n")  # type: ignore[union-attr]
            self.proc.stdin.flush()  # type: ignore[union-attr]
        if not ev.wait(timeout):
            self._waiters.pop(rid, None)
            raise TimeoutError(f"no response to {payload.get('cmd')} {payload.get('op', '')} within {timeout}s")
        self._waiters.pop(rid, None)
        msg = box[0]
        if "error" in msg:
            raise RuntimeError(str(msg["error"]))
        return msg.get("result", {})

    def open(self, actor: str, spec: dict) -> "_ProcessSession":
        self.request({"cmd": "open", "actor": actor, "spec": spec}, 30)
        return _ProcessSession(self, actor)

    def probe(self, kind: str, args: dict) -> dict:
        return self.request({"cmd": "probe", "kind": kind, "args": args}, 30)

    def close(self) -> None:
        try:
            self.request({"cmd": "close"}, 5)
        except Exception:  # noqa: BLE001 - shutting down regardless
            pass
        try:
            self.proc.stdin.close()  # type: ignore[union-attr]
            self.proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            self.proc.kill()
            self.proc.wait()
        self._reader.join(timeout=5)
        for stream in (self.proc.stdout, self.proc.stderr):
            try:
                stream.close()  # type: ignore[union-attr]
            except Exception:  # noqa: BLE001 - the drain thread may still hold it
                pass


@dataclass
class _ProcessSession:
    adapter: ProcessAdapter
    actor: str

    def call(self, op: str, args: dict, timeout: float) -> dict:
        return self.adapter.request({"cmd": "call", "actor": self.actor, "op": op, "args": args,
                                     "timeout": timeout}, timeout + 5)

    def events(self, timeout: float) -> list:
        return self.adapter.request({"cmd": "events", "actor": self.actor, "timeout": timeout}, timeout + 5)

    def close(self) -> None:
        pass


def load_adapter(cfg: Config, name: str):
    spec = cfg.adapters.get(name)
    if spec is None:
        known = ", ".join(sorted(cfg.adapters)) or "(none configured)"
        raise ScenarioError(f"unknown adapter {name!r}; configured: {known}")
    kind = spec.get("type", "python")
    if kind == "process":
        cmd = spec.get("command")
        if not isinstance(cmd, list) or not cmd:
            raise ScenarioError(f"adapter {name}: process adapters need command = [..]")
        cwd = str(cfg.resolve_path(spec["cwd"])) if spec.get("cwd") else (str(cfg.workspace) if cfg.workspace else None)
        argv = [sys.executable if str(c) == "{python}" else str(c) for c in cmd]
        return ProcessAdapter(argv, cwd=cwd), spec
    if kind == "python":
        path = cfg.resolve_path(spec["module"])
        if not path.is_file():
            raise ScenarioError(f"adapter {name}: module not found: {path}")
        mod_spec = importlib.util.spec_from_file_location(f"devloop_adapter_{name}", path)
        module = importlib.util.module_from_spec(mod_spec)  # type: ignore[arg-type]
        mod_spec.loader.exec_module(module)  # type: ignore[union-attr]
        cls = getattr(module, spec.get("class", "Adapter"))
        options = {k: (str(cfg.resolve_path(v)) if k.endswith("_path") and isinstance(v, str) else v)
                   for k, v in spec.get("options", {}).items()}
        return cls(options), spec
    raise ScenarioError(f"adapter {name}: type must be python or process")


# --- runner ---------------------------------------------------------------------------------

def _redact(value, keys: set[str]):
    if not keys:
        return value
    if isinstance(value, dict):
        return {k: ("***" if k.lower() in keys else _redact(v, keys)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v, keys) for v in value]
    return value


def _clip(value, limit: int = 2000):
    text = json.dumps(value, ensure_ascii=False, default=str)
    return value if len(text) <= limit else {"_truncated": text[:limit]}


def validate(scn: dict) -> list[str]:
    problems = []
    for key in ("name", "steps"):
        if key not in scn:
            problems.append(f"missing {key!r}")
    actors = scn.get("actors", {})

    def walk(steps, where):
        if not isinstance(steps, list):
            problems.append(f"{where}: steps must be a list")
            return
        for i, st in enumerate(steps):
            loc = f"{where}[{i}]"
            kinds = [k for k in ("op", "parallel", "probe", "sleep", "repeat", "wait_event") if k in st]
            if len(kinds) != 1:
                problems.append(f"{loc}: needs exactly one of op/parallel/probe/sleep/repeat/wait_event")
                continue
            k = kinds[0]
            if k == "op" and st.get("actor") not in actors:
                problems.append(f"{loc}: unknown actor {st.get('actor')!r}")
            if k == "parallel":
                for j, br in enumerate(st["parallel"]):
                    if "op" not in br or br.get("actor") not in actors:
                        problems.append(f"{loc}.parallel[{j}]: branches need op and a known actor")
            if k == "repeat":
                if not isinstance(st["repeat"], int) or st["repeat"] < 1:
                    problems.append(f"{loc}: repeat must be a positive integer")
                walk(st.get("steps"), f"{loc}.steps")
            if k == "wait_event" and st["wait_event"].get("actor") not in actors:
                problems.append(f"{loc}: wait_event needs a known actor")
            for a in st.get("expect", []) + st.get("expect_all", []):
                if "path" not in a and "count" not in a:
                    problems.append(f"{loc}: assertion needs path or count")
    walk(scn.get("steps"), "steps")
    return problems


@dataclass
class Runner:
    adapter: object
    timeout: float
    variables: dict
    redact: set[str]
    probes: dict  # kind -> callable(args) -> dict (built-in probes)
    sessions: dict = field(default_factory=dict)
    records: list = field(default_factory=list)
    t0: float = field(default_factory=time.monotonic)

    def at(self) -> float:
        return round((time.monotonic() - self.t0) * 1000, 1)

    def run_steps(self, steps: list, path: str) -> bool:
        ok = True
        for i, st in enumerate(steps):
            loc = f"{path}[{i}]"
            if "repeat" in st:
                ok &= self._repeat(st, loc)
                continue
            rec = {"step": loc, "note": st.get("note"), "started_ms": self.at()}
            try:
                if "op" in st:
                    resp = self._call(st["actor"], st["op"], st.get("args", {}), st.get("timeout"))
                    rec.update(kind="op", actor=st["actor"], op=st["op"])
                elif "parallel" in st:
                    resp = self._parallel(st["parallel"], rec)
                    rec.update(kind="parallel")
                elif "probe" in st:
                    resp = self._probe(st["probe"], interpolate(st.get("args", {}), self.variables))
                    rec.update(kind="probe", probe=st["probe"])
                elif "wait_event" in st:
                    resp = self._wait_event(st["wait_event"])
                    rec.update(kind="wait_event")
                else:
                    time.sleep(float(st["sleep"]))
                    resp = None
                    rec.update(kind="sleep")
            except (ScenarioError, TimeoutError, RuntimeError, OSError, ValueError) as exc:
                rec.update(ok=False, error=f"{type(exc).__name__}: {exc}", elapsed_ms=round(self.at() - rec["started_ms"], 1))
                self.records.append(rec)
                if st.get("allow_error"):
                    continue
                return False
            results = [check_assert(a, resp, self.variables) for a in st.get("expect", []) + st.get("expect_all", [])]
            for var, p in st.get("save", {}).items():
                v = get_path(resp, p)
                if v is _MISSING:
                    results.append({"assert": f"save {var} <- {p}", "ok": False, "actual": None})
                else:
                    self.variables[var] = v
            if "save_all" in st:
                self.variables[st["save_all"]] = resp
            rec.update(response=_clip(_redact(resp, self.redact)), assertions=results,
                       ok=all(r["ok"] for r in results), elapsed_ms=round(self.at() - rec["started_ms"], 1))
            self.records.append(rec)
            ok &= rec["ok"]
        return ok

    def _repeat(self, st: dict, loc: str) -> bool:
        n = st["repeat"]
        outcomes = []
        for it in range(n):
            self.variables["iter"] = it
            outcomes.append(self.run_steps(st["steps"], f"{loc}#{it}"))
        failed = outcomes.count(False)
        self.records.append({"step": loc, "kind": "repeat", "iterations": n, "passed": n - failed, "failed": failed,
                             "ok": failed == 0, "note": st.get("note")})
        return failed == 0

    def _session(self, actor: str):
        s = self.sessions.get(actor)
        if s is None:
            raise ScenarioError(f"actor {actor} has no session")
        return s

    def _call(self, actor: str, op: str, args: dict, timeout: float | None):
        return self._session(actor).call(op, interpolate(args, self.variables), float(timeout or self.timeout))

    def _parallel(self, branches: list, rec: dict) -> list:
        barrier = threading.Barrier(len(branches))
        results: list = [None] * len(branches)
        timing: list = [None] * len(branches)

        def run(i: int, br: dict) -> None:
            args = interpolate(br.get("args", {}), self.variables)
            session = self._session(br["actor"])
            try:
                barrier.wait(timeout=self.timeout)
                start = self.at()
                results[i] = session.call(br["op"], args, float(br.get("timeout") or self.timeout))
            except Exception as exc:  # noqa: BLE001 - recorded as the branch outcome
                start = self.at() if timing[i] is None else timing[i][0]
                results[i] = {"_error": f"{type(exc).__name__}: {exc}"}
            timing[i] = (start, self.at())

        threads = [threading.Thread(target=run, args=(i, br)) for i, br in enumerate(branches)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        starts = [t[0] for t in timing if t]
        rec["branches"] = [{"actor": br["actor"], "op": br["op"], "sent_ms": t[0], "done_ms": t[1]}
                           for br, t in zip(branches, timing) if t]
        rec["send_spread_ms"] = round(max(starts) - min(starts), 2) if starts else None
        return results

    def _probe(self, kind: str, args: dict):
        if kind in self.probes:
            return self.probes[kind](args)
        fn = getattr(self.adapter, "probe", None)
        if fn is None:
            raise ScenarioError(f"no probe {kind!r}: not built in and the adapter has no probe()")
        return fn(kind, args)

    def _wait_event(self, spec: dict):
        session = self._session(spec["actor"])
        deadline = time.monotonic() + float(spec.get("timeout", self.timeout))
        match = spec.get("match", {})
        while time.monotonic() < deadline:
            for ev in session.events(max(0.05, min(1.0, deadline - time.monotonic()))) or []:
                if all(get_path(ev, p) == interpolate(v, self.variables) for p, v in match.items()):
                    return ev
        raise TimeoutError(f"no event matching {match} for {spec['actor']}")


def run_scenario(cfg: Config, scn: dict, env_name: str | None, adapter_name: str | None, probes: dict) -> dict:
    problems = validate(scn)
    if problems:
        raise ScenarioError("invalid scenario: " + "; ".join(problems))
    name = adapter_name or scn.get("adapter")
    if not name:
        raise ScenarioError("no adapter: set \"adapter\" in the scenario or pass --adapter")
    spec = cfg.adapters.get(name, {})
    env_name = env_name or spec.get("env")
    if not env_name:
        raise ScenarioError("no target env: pass --env or set env on the adapter (the runner needs a tier)")
    env = cfg.env(env_name)
    tier = env.get("tier", "unknown")
    allowed = scn.get("allowed_tiers", DEFAULT_TIERS)
    if tier not in allowed:
        raise ScenarioError(f"refused: scenario allows tiers {allowed}, env {env_name} is {tier}")
    if not cfg.policy(tier).get("bot", False):
        raise ScenarioError(f"refused: bot runs are disabled for tier {tier} (tiers.{tier}.bot)")
    adapter, spec = load_adapter(cfg, name)
    variables = {"run_id": time.strftime("%Y%m%d%H%M%S", time.gmtime()) + f"{int(time.time() * 1000) % 1000:03d}",
                 **scn.get("vars", {})}
    runner = Runner(adapter, float(scn.get("timeout", 10)), variables,
                    {k.lower() for k in spec.get("redact_fields", [])}, probes)
    started = time.time()
    try:
        for actor, aspec in scn.get("actors", {}).items():
            runner.sessions[actor] = adapter.open(actor, interpolate(aspec, runner.variables))
        ok = runner.run_steps(scn["steps"], "steps")
    finally:
        for s in runner.sessions.values():
            try:
                s.close()
            except Exception:  # noqa: BLE001
                pass
        close = getattr(adapter, "close", None)
        if close:
            close()
    failed = [r["step"] for r in runner.records if r.get("ok") is False]
    return {"scenario": scn.get("name"), "requirements": scn.get("requirements", []), "adapter": name,
            "env": env_name, "tier": tier, "outcome": "pass" if ok else "fail",
            "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
            "elapsed_s": round(time.time() - started, 3), "failed_steps": failed, "steps": runner.records}


def load_scenario(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ScenarioError(f"cannot read scenario {path}: {exc}") from exc
