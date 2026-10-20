import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

import _util
from devloop import config, hooks

CONFIG = """
[env.qa]
tier = "qa"
markers = ["qa-db01"]
[env.live]
tier = "live"
markers = ["live-db01", "live-gm"]
[env.live.db]
driver = "sqlite"
path = "x.db"
[tiers.live]
ask_patterns = ["gm_tool\\\\s+grant"]
"""


class GuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ws = _util.Workspace(CONFIG)
        cls.cfg = config.load(cls.ws.root)

    @classmethod
    def tearDownClass(cls):
        cls.ws.cleanup()

    def decide(self, command: str) -> str:
        return hooks.analyze_command(command, self.cfg).decision

    def test_decisions(self):
        table = [
            ('sqlcmd -S live-db01 -Q "DELETE FROM users"', "deny"),
            ('sqlcmd -S live-db01 -Q "SELECT TOP 5 * FROM users"', "ask"),
            ('sqlcmd -S qa-db01 -Q "SELECT * FROM users"', "none"),
            ('sqlcmd -S qa-db01 -Q "UPDATE users SET gold=0"', "ask"),
            ('mysql -h somewhere -e "DROP TABLE t"', "ask"),  # unknown tier: writes ask
            ('mysql -h somewhere -e "SELECT 1"', "none"),
            ("mysql -h live-db01 < fix.sql", "ask"),
            ("redis-cli -h live-db01 FLUSHALL", "deny"),
            ("redis-cli -h live-db01 GET k", "ask"),
            ("curl -X POST https://live-gm/grant -d uid=1", "deny"),
            ("curl https://live-gm/status", "none"),
            ('ssh live-gm "mysql -e \\"UPDATE users SET gold=0\\""', "deny"),
            ('bash -c "psql -h live-db01 -c \'drop table x\'"', "deny"),
            ("grep live-db01 server.log", "none"),
            ('git commit -m "DELETE rows on live-db01"', "none"),
            ("gm_tool grant --host live-gm --uid 1", "ask"),
            ("devloop db query --env live 'SELECT 1'", "ask"),
            ("devloop db query --env qa 'SELECT 1'", "none"),
            ("ls -la && echo done", "none"),
            ('mysql -h live-db01 -e "select 1 limit 1" -e "drop table x"', "deny"),  # every -e is classified
            ("curl -XPOST https://live-gm/grant", "deny"),
            ("curl -duid=1 https://live-gm/grant", "deny"),
            ("mysqladmin -h live-db01 shutdown", "deny"),
            ("mysqldump -h live-db01 game", "ask"),
            ("python fix_rewards.py --host live-db01", "ask"),  # unclassified command naming a live target
            ('bash -c "python fix.py --host live-db01"', "ask"),
            ('echo "$(sqlcmd -S live-db01 -Q \'DELETE FROM t\')"', "deny"),
            ("kubectl --context live-gm logs pod/x", "none"),
            ("kubectl --context live-gm exec pod/x -- sh", "ask"),
            ("devloop ev run C --claim x -- python fix.py --host live-db01", "ask"),
            ("devloop log scan --source live-db01", "none"),
        ]
        for cmd, expected in table:
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decide(cmd), expected)

    def test_hook_never_allows_and_protects_ledger(self):
        out = hooks.pretooluse({"tool_name": "Bash", "tool_input": {"command": "ls"}, "cwd": str(self.ws.root)})
        self.assertIsNone(out)
        out = hooks.pretooluse({"tool_name": "Write", "cwd": str(self.ws.root),
                                "tool_input": {"file_path": str(self.ws.root / ".devloop/cases/X/ledger.jsonl")}})
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_errors_degrade_to_ask(self):
        bad = _util.Workspace("this is = not toml [")
        try:
            text, code = hooks.run("pretooluse", json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"},
                                                             "cwd": str(bad.root)}))
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(text)["hookSpecificOutput"]["permissionDecision"], "ask")
        finally:
            bad.cleanup()

    def test_sessionstart_summary(self):
        from devloop import case
        case.new_case(self.ws.root / ".devloop" / "cases", "issue", "dup reward", None, None, None, self.ws.root)
        text, _ = hooks.run("sessionstart", json.dumps({"cwd": str(self.ws.root)}))
        ctx = json.loads(text)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("dup reward", ctx)
        self.assertLessEqual(len(ctx.splitlines()), 10)


class MergeTest(unittest.TestCase):
    def test_user_markers_survive_and_stricter_policy_wins(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as home:
            user = Path(home) / "config.toml"
            user.write_text('[env.live]\ntier = "live"\nmarkers = ["prod-db"]\n[tiers.live]\ndb_read = "deny"\n',
                            encoding="utf-8")
            ws = _util.Workspace('[env.live]\ntier = "live"\nmarkers = ["live-db01"]\n[tiers.live]\ndb_read = "none"\n'
                                 '[guard]\ndb_clients = ["mysqlsh"]\n')
            old = os.environ.get("DEVLOOP_USER_CONFIG")
            os.environ["DEVLOOP_USER_CONFIG"] = str(user)
            try:
                cfg = config.load(ws.root)
                self.assertEqual(sorted(cfg.envs["live"]["markers"]), ["live-db01", "prod-db"])
                self.assertEqual(cfg.policy("live")["db_read"], "deny")
                self.assertIn("sqlcmd", cfg.guard["db_clients"])  # extends, not replaces
                self.assertIn("mysqlsh", cfg.guard["db_clients"])
            finally:
                os.environ["DEVLOOP_USER_CONFIG"] = old
                ws.cleanup()


class LauncherTest(unittest.TestCase):
    def test_hook_via_launcher(self):
        ws = _util.Workspace(CONFIG)
        try:
            payload = json.dumps({"tool_name": "Bash", "cwd": str(ws.root),
                                  "tool_input": {"command": 'sqlcmd -S live-db01 -Q "DELETE FROM t"'}})
            p = _util.run_cli(["hook", "pretooluse"], ws.root, stdin=payload)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(json.loads(p.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
        finally:
            ws.cleanup()

    def test_missing_python_degrades_to_ask(self):
        bash = shutil.which("bash")
        with tempfile.TemporaryDirectory() as bindir:
            os.symlink(bash, Path(bindir) / "bash")
            for tool in ("dirname",):
                found = shutil.which(tool)
                if found:
                    os.symlink(found, Path(bindir) / tool)
            env = {"PATH": bindir, "DEVLOOP_PYTHON": "/nonexistent/python", "HOME": bindir}
            import subprocess
            p = subprocess.run([bash, str(_util.LAUNCHER), "hook", "pretooluse"], input="{}", capture_output=True,
                               text=True, env=env, timeout=30)
            self.assertEqual(p.returncode, 0)
            out = json.loads(p.stdout)["hookSpecificOutput"]
            self.assertEqual(out["permissionDecision"], "ask")
            self.assertIn("Python", out["permissionDecisionReason"])


if __name__ == "__main__":
    unittest.main()
