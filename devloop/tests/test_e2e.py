"""End-to-end: the sandbox incident investigated and closed through the public CLI only."""

import subprocess
import sys
import unittest
from pathlib import Path

import _util


class SandboxIncidentE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = _util.copy_sandbox()
        cls.root = Path(cls.tmp.name) / "sandbox"
        subprocess.run([sys.executable, "incident/generate.py"], cwd=cls.root, check=True, capture_output=True)
        subprocess.run([sys.executable, "spec/make_table.py"], cwd=cls.root, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def cli(self, *args: str, expect: int = 0, **env: str) -> str:
        p = _util.run_cli(list(args), self.root, **env)
        self.assertEqual(p.returncode, expect, f"{args}\nstdout:{p.stdout[-1500:]}\nstderr:{p.stderr[-1500:]}")
        return p.stdout + p.stderr

    def edit(self, path: Path, old: str, new: str) -> None:
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1), encoding="utf-8")

    def test_incident_loop(self):
        logs = "run/incident/game-*"
        scan = self.cli("log", "scan", logs)
        self.assertIn("cp949 + gzip", scan)  # rotated CP949 file decoded
        self.assertIn("coverage: 3 source(s)", scan)
        diff = self.cli("log", "diff", logs, "--base-window", "2026-10-20T00:00Z..2026-10-20T06:00Z",
                        "--target-window", "2026-10-20T06:00Z..2026-10-20T12:00Z")
        self.assertRegex(diff, r"\[\w+\] WARN\s+0 → \d+.*reward\.svc\.call")

        out = self.cli("case", "new", "issue", "보상 중복 지급", "--slug", "dup-reward", "--ref", "CS-88120")
        cid = out.split()[1]
        case_md = self.root / ".devloop" / "cases" / cid / "case.md"

        tl = self.cli("log", "timeline", logs, "--key", "1042", "--where", "mission=102", "--save", cid)
        self.assertIn("retry=1", tl)
        self.assertIn("saved E1", tl)

        self.cli("db", "query", "--env", "incident", "SELECT uid FROM reward_log", expect=3)  # live: unbounded
        self.cli("db", "query", "--env", "incident", "UPDATE users SET gold = 0", expect=3)  # never writes
        impact = self.cli("db", "query", "--env", "incident",
                          "SELECT COUNT(*) AS groups FROM (SELECT uid FROM reward_log "
                          "GROUP BY uid, mission_id, cycle HAVING COUNT(*) > 1)", "--save", cid)
        self.assertIn("saved E2", impact)

        red = self.cli("bot", "run", ".devloop/scenarios/double-claim-race.json", "--save", cid, expect=1)
        self.assertIn("saved E3", red)
        green = self.cli("bot", "run", ".devloop/scenarios/double-claim-race.json", "--save", cid,
                         SANDBOX_FIX="claim")
        self.assertIn("saved E4", green)
        code = self.cli("ev", "add", cid, "--kind", "file", "--ref", "server/game.py:1-20",
                        "--claim", "claim handler")
        self.assertIn("E5 file/확인", code)

        self.edit(case_md, "## 4. 결론\n", "## 4. 결론\n- (확인) [원인] 비원자적 수령 [E3][E5]\n")
        self.cli("case", "check", cid, expect=1)  # causal claim graded as an observation
        self.edit(case_md, "- (확인) [원인]", "- (도출) [원인]")
        self.edit(case_md, "| --- | --- | --- | --- | --- | --- |\n\n## 8.",
                  "| --- | --- | --- | --- | --- | --- |\n| CHK-1 | 회귀 | race x10 | 1건 | PASS | [E3][E4] |\n\n## 8.")
        self.cli("case", "check", cid)

        self.cli("case", "ask", cid, "회수 여부", "--to", "운영")
        blocked = self.cli("case", "close", cid, "--reason", "fixed", expect=1)
        self.assertIn("Q1", blocked)
        review = self.root / "review.md"
        review.write_text("유지: 재현과 코드 근거 일치", encoding="utf-8")
        self.cli("ev", "add", cid, "--kind", "review", "--ref", "adversary", "--attach", str(review),
                 "--claim", "교차검증")
        self.cli("case", "answer", cid, "Q1", "회수 안 함", "--ref", "운영 회의")
        closed = self.cli("case", "close", cid, "--reason", "fixed")
        self.assertIn("closed: fixed", closed)
        self.assertNotIn("FORCED", closed)
        self.assertIn('"forced_closes": 0', self.cli("case", "stats"))

    def test_spec_text_and_guard(self):
        self.assertIn("9001", self.cli("doc", "text", "spec/mission_table.xlsx", "--sheet", "missions"))
        payload = ('{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"sqlite3 run/incident/incident.db '
                   '\\"DELETE FROM users\\""}}' % self.root)
        p = _util.run_cli(["hook", "pretooluse"], self.root, stdin=payload)
        self.assertIn('"permissionDecision": "deny"', p.stdout)


if __name__ == "__main__":
    unittest.main()
