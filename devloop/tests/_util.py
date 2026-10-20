"""Shared test helpers: import path, temporary workspaces, CLI runner."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "devloop"
LIB = PLUGIN / "lib"
LAUNCHER = PLUGIN / "scripts" / "devloop"
SANDBOX = ROOT / "examples" / "sandbox"

if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

# Never read the developer's real ~/.devloop/config.toml during tests.
os.environ["DEVLOOP_USER_CONFIG"] = str(Path(tempfile.gettempdir()) / "devloop-test-no-user-config.toml")
os.environ.pop("DEVLOOP_WORKSPACE", None)


def isolated_env(**extra: str) -> dict:
    """Environment without user-level devloop config leaking in."""
    env = dict(os.environ)
    env["DEVLOOP_USER_CONFIG"] = str(Path(tempfile.gettempdir()) / "devloop-test-no-user-config.toml")
    env.pop("DEVLOOP_WORKSPACE", None)
    env.pop("SANDBOX_FIX", None)
    env["DEVLOOP_PYTHON"] = sys.executable
    env.update(extra)
    return env


def run_cli(args: list[str], cwd: Path, stdin: str | None = None, **env: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(LAUNCHER), *args], cwd=cwd, input=stdin, capture_output=True, text=True,
                          encoding="utf-8", env=isolated_env(**env), timeout=120)


def run_json(args: list[str], cwd: Path, **env: str) -> tuple[int, dict]:
    p = run_cli(["--json", *args], cwd, **env)
    try:
        return p.returncode, json.loads(p.stdout) if p.stdout.strip() else {}
    except ValueError as exc:
        raise AssertionError(f"not JSON (exit {p.returncode}): {p.stdout[:500]} {p.stderr[:500]}") from exc


class Workspace:
    """A temporary workspace with .devloop/config.toml."""

    def __init__(self, config: str = ""):
        self.tmp = tempfile.TemporaryDirectory(prefix="devloop-test-")
        self.root = Path(self.tmp.name)
        (self.root / ".devloop" / "cases").mkdir(parents=True)
        (self.root / ".devloop" / "config.toml").write_text(config, encoding="utf-8")

    def cleanup(self) -> None:
        self.tmp.cleanup()


def copy_sandbox() -> tempfile.TemporaryDirectory:
    tmp = tempfile.TemporaryDirectory(prefix="devloop-sandbox-")
    dest = Path(tmp.name) / "sandbox"
    shutil.copytree(SANDBOX, dest, ignore=shutil.ignore_patterns("run", "cases", "__pycache__", "*.xlsx"))
    return tmp
