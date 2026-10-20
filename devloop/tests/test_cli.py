"""Public CLI forms documented in skills and references."""

import json
import sys
import unittest

import _util


class CliFormsTest(unittest.TestCase):
    def setUp(self):
        self.ws = _util.Workspace('[secrets]\nenv = ["DEVLOOP_TEST_SECRET"]\n')
        p = _util.run_cli(["case", "new", "bug", "cli forms", "--slug", "forms"], self.ws.root)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.cid = p.stdout.split()[1]

    def tearDown(self):
        self.ws.cleanup()

    def cli(self, *args, expect=0, **env):
        p = _util.run_cli(list(args), self.ws.root, **env)
        self.assertEqual(p.returncode, expect, f"{args}: {p.stdout[-800:]} {p.stderr[-800:]}")
        return p.stdout + p.stderr

    def test_ev_run_documented_order(self):
        out = self.cli("ev", "run", self.cid, "--claim", "red", "--", sys.executable, "-c", "import sys; sys.exit(1)",
                       expect=1)
        self.assertIn("outcome=fail exit=1", out)
        out = self.cli("ev", "run", "--claim", "green", self.cid, "--", sys.executable, "-c", "print('ok')")
        self.assertIn("outcome=pass exit=0", out)

    def test_ev_run_timeout_and_missing_command(self):
        out = self.cli("ev", "run", self.cid, "--claim", "slow", "--timeout", "0.5", "--",
                       sys.executable, "-c", "import time; time.sleep(5)", expect=1)
        self.assertIn("exit=timeout", out)
        self.cli("ev", "run", self.cid, "--claim", "nothing", expect=2)
        self.cli("case", "list", "--", "echo", expect=2)  # only ev run accepts a command

    def test_secret_values_from_config_are_redacted(self):
        self.cli("ev", "run", self.cid, "--claim", "uses secret", "--", sys.executable, "-c", "print('ok')",
                 "s3cr3t-value", DEVLOOP_TEST_SECRET="s3cr3t-value")
        ledger_text = next((self.ws.root / ".devloop" / "cases").glob("*/ledger.jsonl")).read_text(encoding="utf-8")
        self.assertNotIn("s3cr3t-value", ledger_text)
        self.assertIn("${DEVLOOP_TEST_SECRET}", ledger_text)

    def test_bad_inputs_are_usage_errors(self):
        log = self.ws.root / "a.log"
        log.write_text("2026-10-20T00:00:00Z INFO x\n", encoding="utf-8")
        out = self.cli("log", "query", str(log), "--grep", "(", expect=2)
        self.assertIn("bad --grep", out)
        out = self.cli("db", "query", "--env", "x", "SELECT 1", "--param", "novalue", expect=2)
        self.assertNotIn("Traceback", out)

    def test_review_attachment_is_stored(self):
        f = self.ws.root / "review.md"
        f.write_text("verdict", encoding="utf-8")
        self.cli("ev", "add", self.cid, "--kind", "review", "--ref", "adversary", "--claim", "x", expect=2)
        out = json.loads(_util.run_cli(["--json", "ev", "add", self.cid, "--kind", "review", "--ref", "adversary",
                                        "--attach", str(f), "--claim", "x"], self.ws.root).stdout)
        self.assertTrue(out["artifact"]["sha256"])


if __name__ == "__main__":
    unittest.main()
