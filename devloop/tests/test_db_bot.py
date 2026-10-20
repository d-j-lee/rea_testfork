import json
import os
import sqlite3
import unittest

import _util
from devloop import bot, config, db

SANDBOX_CONFIG = (_util.SANDBOX / ".devloop" / "config.toml").read_text(encoding="utf-8")


class DbTest(unittest.TestCase):
    def setUp(self):
        self.ws = _util.Workspace("""
[env.local]
tier = "local"
[env.local.db]
driver = "sqlite"
path = "game.db"
[env.live]
tier = "live"
[env.live.db]
driver = "sqlite"
path = "game.db"
mask_columns = ["account"]
""")
        con = sqlite3.connect(self.ws.root / "game.db")
        con.executescript("CREATE TABLE users(uid INTEGER, account TEXT, gold INTEGER);"
                          "INSERT INTO users VALUES (1,'steam_1',10),(2,'steam_2',20),(3,'steam_3',30);")
        con.commit()
        con.close()
        self.cfg = config.load(self.ws.root)

    def tearDown(self):
        self.ws.cleanup()

    def test_reads_masks_and_bounds(self):
        r = db.run_query(self.cfg, "local", "SELECT * FROM users", max_rows=2)
        self.assertEqual((r["returned"], r["truncated"], r["columns"]), (2, True, ["uid", "account", "gold"]))
        with self.assertRaises(db.Refused):
            db.run_query(self.cfg, "live", "SELECT * FROM users")  # live requires a bounded result
        r = db.run_query(self.cfg, "live", "SELECT * FROM users LIMIT 1")
        self.assertEqual(r["rows"][0][1], "***")
        r = db.run_query(self.cfg, "live", "SELECT * FROM users", allow_unbounded=True)
        self.assertEqual(r["returned"], 3)

    def test_never_writes(self):
        for sql in ("UPDATE users SET gold = 0", "SELECT 1; DELETE FROM users", "DROP TABLE users"):
            with self.subTest(sql=sql), self.assertRaises(db.Refused):
                db.run_query(self.cfg, "local", sql)
        with self.assertRaises(db.Refused):
            db.run_query(self.cfg, "local", "SELECT * FROM users FOR UPDATE")
        con = sqlite3.connect(self.ws.root / "game.db")
        self.assertEqual(con.execute("SELECT SUM(gold) FROM users").fetchone()[0], 60)
        con.close()

    def test_sqlite_connection_is_read_only_even_past_the_classifier(self):
        cfg = config.load(self.ws.root)
        with self.assertRaises(db.DbError):
            db._sqlite(cfg, {"path": "game.db"}, "UPDATE users SET gold = 0", 10)

    def test_bind(self):
        self.assertEqual(db.bind("SELECT * FROM t WHERE a = :a AND b = :b AND c = '::x'", {"a": 1, "b": "o'k"}),
                         "SELECT * FROM t WHERE a = 1 AND b = 'o''k' AND c = '::x'")
        with self.assertRaises(db.DbError):
            db.sql_literal("a\\b")

    def test_command_driver(self):
        script = self.ws.root / "fake_client.py"
        script.write_text("import sys\nrows = {'ok': ['uid\\taccount', '---\\t-------', '1\\tsteam_1', '007\\tNULL', '(2 rows affected)'],\n"
                          "        'bad': ['uid\\taccount', '1\\tnick\\twith tab']}\n"
                          "print('\\n'.join(rows[sys.argv[1].split()[-1]]))\n", encoding="utf-8")
        import sys
        cfg_text = f"""
[env.qa]
tier = "qa"
[env.qa.db]
driver = "command"
command = [{json.dumps(sys.executable)}, {json.dumps(str(script))}, "{{sql}}"]
output = "tsv"
mask_columns = ["account"]
"""
        ws = _util.Workspace(cfg_text)
        try:
            cfg = config.load(ws.root)
            r = db.run_query(cfg, "qa", "SELECT ok")
            self.assertEqual(r["columns"], ["uid", "account"])
            self.assertEqual(r["rows"], [[1, "***"], ["007", "***"]])  # separator/trailer dropped, typed when lossless
            with self.assertRaises(db.Refused):  # a tab inside a value would misalign masking
                db.run_query(cfg, "qa", "SELECT bad")
        finally:
            ws.cleanup()


class PathTest(unittest.TestCase):
    def test_paths_vars_asserts(self):
        doc = {"a": {"b": [1, {"c": "x"}]}, "list": [1, 2, 3]}
        self.assertEqual(bot.get_path(doc, "$.a.b[1].c"), "x")
        self.assertEqual(bot.get_path(doc, "$.list.length"), 3)
        self.assertIs(bot.get_path(doc, "$.nope"), bot._MISSING)
        self.assertEqual(bot.interpolate({"u": "${uid}", "s": "u-${uid}", "n": "${obj.k[0]}"},
                                         {"uid": 7, "obj": {"k": [9]}}), {"u": 7, "s": "u-7", "n": 9})
        r = bot.check_assert({"count": {"path": "$.ok", "value": True}, "op": "eq", "value": 1},
                             [{"ok": True}, {"ok": False}], {})
        self.assertTrue(r["ok"])
        self.assertFalse(bot.check_assert({"path": "$.x", "op": "gt", "value": 1}, {}, {})["ok"])
        with self.assertRaises(bot.ScenarioError):
            bot.interpolate("${missing}", {})

    def test_validate(self):
        problems = bot.validate({"name": "x", "actors": {"a": {}}, "steps": [{"op": "x", "actor": "b"},
                                                                              {"repeat": 0, "steps": []}, {}]})
        self.assertEqual(len(problems), 3)


class ScenarioTest(unittest.TestCase):
    """Runs the sandbox server through both adapter types."""

    def setUp(self):
        self.tmp = _util.copy_sandbox()
        from pathlib import Path
        self.root = Path(self.tmp.name) / "sandbox"
        self.cfg = config.load(self.root)
        os.environ.pop("SANDBOX_FIX", None)

    def tearDown(self):
        os.environ.pop("SANDBOX_FIX", None)
        self.tmp.cleanup()

    def scenario(self, name: str) -> dict:
        return bot.load_scenario(self.root / ".devloop" / "scenarios" / name)

    def run_scn(self, name: str, adapter: str = "sandbox") -> dict:
        from devloop.cli import _builtin_probes
        return bot.run_scenario(self.cfg, self.scenario(name), None, adapter,
                                lambda env: _builtin_probes(self.cfg, env))

    def test_race_red_then_green_with_both_adapters(self):
        for adapter in ("sandbox", "sandbox-proc"):
            with self.subTest(adapter=adapter):
                os.environ.pop("SANDBOX_FIX", None)
                red = self.run_scn("double-claim-race.json", adapter)
                self.assertEqual(red["outcome"], "fail")
                rep = [s for s in red["steps"] if s.get("kind") == "repeat"][0]
                self.assertGreater(rep["failed"], 0)
                os.environ["SANDBOX_FIX"] = "claim"
                green = self.run_scn("double-claim-race.json", adapter)
                self.assertEqual(green["outcome"], "pass", json.dumps(green["failed_steps"]))

    def test_happy_path_and_reset_boundary(self):
        self.assertEqual(self.run_scn("happy-path.json")["outcome"], "pass")
        self.assertEqual(self.run_scn("daily-reset-boundary.json")["outcome"], "fail")
        os.environ["SANDBOX_FIX"] = "reset"
        self.assertEqual(self.run_scn("daily-reset-boundary.json")["outcome"], "pass")

    def test_tier_refusal_and_env_binding(self):
        scn = self.scenario("happy-path.json")
        with self.assertRaises(bot.ScenarioError) as ctx:  # adapter bound to sandbox: --env cannot relabel it
            bot.run_scenario(self.cfg, scn, "incident", "sandbox", {})
        self.assertIn("bound", str(ctx.exception))

    def test_probe_on_other_env_follows_policy(self):
        from devloop.cli import _builtin_probes
        probe = _builtin_probes(self.cfg, "sandbox")["db"]
        with self.assertRaises(bot.ScenarioError):
            probe({"env": "incident", "sql": "SELECT COUNT(*) FROM users"})

    def test_process_adapter_survives_cp949_and_reports_crash(self):
        import sys
        from pathlib import Path
        script = Path(self.tmp.name) / "fake_bot.py"
        script.write_text(
            "import sys, json\n"
            "sys.stdout.buffer.write('봇 시작\\n'.encode('cp949')); sys.stdout.flush()\n"
            "for line in sys.stdin:\n"
            "    req = json.loads(line)\n"
            "    if req.get('op') == 'crash':\n"
            "        sys.exit(3)\n"
            "    print(json.dumps({'id': req['id'], 'result': {'ok': True}}), flush=True)\n", encoding="utf-8")
        adapter = bot.ProcessAdapter([sys.executable, str(script)])
        try:
            session = adapter.open("a", {})
            self.assertEqual(session.call("ping", {}, 5), {"ok": True})
            import time
            t0 = time.monotonic()
            with self.assertRaises((RuntimeError, bot.ScenarioError)):
                session.call("crash", {}, 20)
            self.assertLess(time.monotonic() - t0, 10)  # released at EOF, not after the timeout
        finally:
            adapter.close()


if __name__ == "__main__":
    unittest.main()
