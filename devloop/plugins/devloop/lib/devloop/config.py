"""Workspace discovery and configuration.

Resolution: ``$DEVLOOP_WORKSPACE`` or the nearest ancestor of the working
directory that contains ``.devloop/``; tier markers and policies may also come
from the user-level ``~/.devloop/config.toml`` so the guard still knows live
hosts when Claude runs in a repository that has no workspace. Built-in defaults
apply last. Configuration is read-only here; ``init`` owns writing it.
"""

from __future__ import annotations

import copy
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    import tomllib
except ImportError as exc:  # pragma: no cover - guarded by the launcher
    raise SystemExit("devloop requires Python 3.11 or later (tomllib)") from exc

TIERS = ("local", "dev", "qa", "stage", "live")
TIER_RANK = {t: i for i, t in enumerate(TIERS)}
DECISIONS = ("none", "ask", "deny")

DEFAULT_POLICY = {
    # none: no guard action (the normal permission flow decides)
    "local":   {"db_read": "none", "db_write": "none", "http_write": "none", "remote": "none",
                "devloop_db": "none", "require_bounded": False, "bot": True},
    "dev":     {"db_read": "none", "db_write": "ask", "http_write": "none", "remote": "none",
                "devloop_db": "none", "require_bounded": False, "bot": True},
    "qa":      {"db_read": "none", "db_write": "ask", "http_write": "none", "remote": "none",
                "devloop_db": "none", "require_bounded": False, "bot": True},
    "stage":   {"db_read": "ask", "db_write": "deny", "http_write": "ask", "remote": "ask",
                "devloop_db": "none", "require_bounded": True, "bot": False},
    "live":    {"db_read": "ask", "db_write": "deny", "http_write": "deny", "remote": "ask",
                "devloop_db": "ask", "require_bounded": True, "bot": False},
    # no marker matched: the target is unknown
    "unknown": {"db_read": "none", "db_write": "ask", "http_write": "none", "remote": "none",
                "devloop_db": "none", "require_bounded": False, "bot": False},
}

DEFAULT_GUARD = {
    "db_clients": ["sqlcmd", "osql", "isql", "bcp", "mysql", "mariadb", "psql", "mongosh", "mongo",
                   "redis-cli", "Invoke-Sqlcmd"],
    "local_db_clients": ["sqlite3"],
    "http_clients": ["curl", "wget", "http", "https", "Invoke-WebRequest", "Invoke-RestMethod", "iwr", "irm"],
    "remote_clients": ["ssh", "kubectl", "psexec", "PsExec", "Enter-PSSession", "Invoke-Command"],
    "mcp_sql_tools": [],
    "protect_ledger": True,
}


class ConfigError(ValueError):
    pass


@dataclass
class Config:
    workspace: Path | None
    path: Path | None
    user_path: Path | None
    data: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    # --- workspace paths ---------------------------------------------------
    @property
    def devloop_dir(self) -> Path | None:
        return self.workspace / ".devloop" if self.workspace else None

    @property
    def cases_dir(self) -> Path | None:
        return self.devloop_dir / "cases" if self.devloop_dir else None

    def require_workspace(self) -> Path:
        if not self.workspace:
            raise ConfigError("no devloop workspace found here or in parent directories; "
                              "run `devloop init` at the workspace root (or set DEVLOOP_WORKSPACE)")
        return self.workspace

    def resolve_path(self, value: str) -> Path:
        p = Path(os.path.expandvars(os.path.expanduser(value)))
        if not p.is_absolute() and self.workspace:
            p = self.workspace / p
        return p

    # --- sections ------------------------------------------------------------
    @property
    def display_tz(self) -> str:
        return self.data.get("display_tz", "UTC")

    def policy(self, tier: str) -> dict:
        base = dict(DEFAULT_POLICY.get(tier, DEFAULT_POLICY["unknown"]))
        base.update(self.data.get("tiers", {}).get(tier, {}))
        return base

    @property
    def guard(self) -> dict:
        g = copy.deepcopy(DEFAULT_GUARD)
        g.update(self.data.get("guard", {}))
        return g

    @property
    def envs(self) -> dict:
        return self.data.get("env", {})

    def env(self, name: str) -> dict:
        envs = self.envs
        if name not in envs:
            known = ", ".join(sorted(envs)) or "(none configured)"
            raise ConfigError(f"unknown env {name!r}; configured: {known}")
        env = dict(envs[name])
        env.setdefault("tier", "unknown")
        return env

    @property
    def log_profiles(self) -> dict:
        return self.data.get("log", {}).get("profiles", {})

    @property
    def log_sources(self) -> dict:
        return self.data.get("log", {}).get("sources", {})

    @property
    def adapters(self) -> dict:
        return self.data.get("bot", {}).get("adapters", {})

    @property
    def exec_allowlist(self) -> list[str] | None:
        return self.data.get("sql", {}).get("exec_allowlist")

    def tier_markers(self) -> list[tuple[str, str, str]]:
        """(marker_lowercase, tier, env_name) for every configured marker."""
        out = []
        for name, env in self.envs.items():
            tier = env.get("tier", "unknown")
            for m in env.get("markers", []):
                if m:
                    out.append((str(m).lower(), tier, name))
        return out


def _load_file(path: Path) -> dict:
    try:
        if path.suffix == ".json":
            return json.loads(path.read_text(encoding="utf-8"))
        with open(path, "rb") as f:
            return tomllib.load(f)
    except (OSError, ValueError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc


def _merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def _validate(data: dict, origin: str) -> list[str]:
    warnings = []
    known = {"display_tz", "tiers", "guard", "env", "log", "bot", "sql", "case"}
    for key in data:
        if key not in known:
            warnings.append(f"{origin}: unknown top-level key {key!r}")
    for name, env in data.get("env", {}).items():
        tier = env.get("tier")
        if tier not in TIERS:
            raise ConfigError(f"{origin}: env.{name}.tier must be one of {', '.join(TIERS)} (got {tier!r})")
        if not isinstance(env.get("markers", []), list):
            raise ConfigError(f"{origin}: env.{name}.markers must be a list")
    for tier, pol in data.get("tiers", {}).items():
        if tier not in DEFAULT_POLICY:
            raise ConfigError(f"{origin}: tiers.{tier} is not a tier")
        for k, v in pol.items():
            if k in {"db_read", "db_write", "http_write", "remote", "devloop_db"} and v not in DECISIONS:
                raise ConfigError(f"{origin}: tiers.{tier}.{k} must be one of {', '.join(DECISIONS)}")
    return warnings


def find_workspace(start: Path) -> Path | None:
    env = os.environ.get("DEVLOOP_WORKSPACE")
    if env:
        return Path(env).resolve()
    cur = start.resolve()
    for d in (cur, *cur.parents):
        if (d / ".devloop").is_dir():
            return d
    return None


def user_config_path() -> Path:
    return Path(os.environ.get("DEVLOOP_USER_CONFIG", Path.home() / ".devloop" / "config.toml"))


def load(start: Path | None = None) -> Config:
    start = start or Path.cwd()
    ws = find_workspace(start)
    data: dict = {}
    warnings: list[str] = []
    user_path = user_config_path()
    used_user = None
    if user_path.is_file():
        user = _load_file(user_path)
        warnings += _validate(user, str(user_path))
        data = _merge(data, user)
        used_user = user_path
    path = None
    if ws:
        for name in ("config.toml", "config.json"):
            cand = ws / ".devloop" / name
            if cand.is_file():
                path = cand
                ws_data = _load_file(cand)
                warnings += _validate(ws_data, str(cand))
                data = _merge(data, ws_data)
                break
    return Config(ws, path, used_user, data, warnings)
