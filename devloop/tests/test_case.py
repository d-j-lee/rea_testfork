import sys
import unittest
from pathlib import Path

import _util
from devloop import case, ledger


CHK6 = "| CHK | 관점 | 방법 | 기대 | 결과 | 근거 |\n| --- | --- | --- | --- | --- | --- |\n"


class CaseTestBase(unittest.TestCase):
    def setUp(self):
        self.ws = _util.Workspace()
        self.cases = self.ws.root / ".devloop" / "cases"

    def tearDown(self):
        self.ws.cleanup()

    def new(self, ctype="bug", title="보상 중복") -> Path:
        return case.new_case(self.cases, ctype, title, None, "T-1", None, self.ws.root)

    def write_body(self, d: Path, old: str, new: str) -> None:
        p = d / "case.md"
        text = p.read_text(encoding="utf-8")
        assert old in text, old
        p.write_text(text.replace(old, new, 1), encoding="utf-8")

    def codes(self, d: Path) -> set[str]:
        return {i.code for i in case.check(d)[1]}


class LedgerTest(CaseTestBase):
    def test_ceilings(self):
        led = ledger.Ledger(self.new())
        with self.assertRaises(ledger.LedgerError):
            led.add_evidence(kind="manual", claim="x", ref="memo", grade="확인")
        with self.assertRaises(ledger.LedgerError):
            led.add_evidence(kind="file", claim="x", ref="missing.py:3")
        with self.assertRaises(ledger.LedgerError):
            led.add_evidence(kind="unknown", claim="x")
        e = led.add_evidence(kind="manual", claim="x", ref="memo")
        self.assertEqual(e["grade"], "추론")

    def test_file_snapshot_and_derived_floor(self):
        src = self.ws.root / "code.py"
        src.write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
        led = ledger.Ledger(self.new())
        e1 = led.add_evidence(kind="file", claim="b is 2", ref="code.py:2", workspace=self.ws.root)
        self.assertEqual((e1["grade"], e1["file"]["snapshot"]), ("확인", "b = 2"))
        e2 = led.add_evidence(kind="report", claim="QA says so", ref="QA-1")
        d = led.add_evidence(kind="derived", claim="from both", premises=[e1["id"], e2["id"]])
        self.assertEqual(d["grade"], "추론")  # a report cited for a conclusion counts as 추론
        with self.assertRaises(ledger.LedgerError):
            led.add_evidence(kind="derived", claim="too strong", premises=[e2["id"]], grade="도출")

    def test_run_records_outcome(self):
        led = ledger.Ledger(self.new())
        ok, _ = led.run_command(argv=[sys.executable, "-c", "print('가')"], claim="ok", timeout=30, scope=None)
        bad, tail = led.run_command(argv=[sys.executable, "-c", "import sys; sys.exit(3)"], claim="bad", timeout=30,
                                    scope=None)
        self.assertEqual((ok["outcome"], bad["outcome"], bad["exit_code"]), ("pass", "fail", 3))
        self.assertTrue((led.case_dir / ok["artifact"]["path"]).is_file())


class IntegrityTest(CaseTestBase):
    def test_chain_detects_edits_outside_the_cli(self):
        d = self.new()
        led = ledger.Ledger(d)
        led.add_evidence(kind="manual", claim="a", ref="memo")
        led.add_evidence(kind="manual", claim="b", ref="memo")
        self.assertNotIn("ledger-chain", self.codes(d))
        lines = (d / "ledger.jsonl").read_text(encoding="utf-8").splitlines()
        lines[-2] = lines[-2].replace('"추론"', '"확인"')
        (d / "ledger.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.assertIn("ledger-chain", self.codes(d))

    def test_artifact_hash_is_rechecked(self):
        d = self.new()
        e, _ = ledger.Ledger(d).run_command(argv=[sys.executable, "-c", "print(1)"], claim="x", timeout=30, scope=None)
        (d / e["artifact"]["path"]).write_text("forged", encoding="utf-8")
        self.assertIn("artifact-modified", self.codes(d))

    def test_concurrent_appends_get_unique_ids(self):
        import threading
        led = ledger.Ledger(self.new())
        threads = [threading.Thread(target=lambda: led.add_evidence(kind="manual", claim="x", ref="m"))
                   for _ in range(30)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        ids = [e["id"] for e in led.entries() if e.get("type") == "evidence"]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(led.verify_chain(), [])

    def test_explicit_secrets_are_redacted(self):
        d = self.new()
        led = ledger.Ledger(d, secrets={"hunter2-secret": "DB_PASS"})
        e, tail = led.run_command(argv=[sys.executable, "-c", "print('pw=hunter2-secret')", "-p", "hunter2-secret"],
                                  claim="x", timeout=30, scope=None)
        raw = (d / "ledger.jsonl").read_text(encoding="utf-8") + (d / e["artifact"]["path"]).read_text(encoding="utf-8")
        self.assertNotIn("hunter2-secret", raw)
        self.assertIn("${DB_PASS}", raw)


class LintTest(CaseTestBase):
    def test_template_is_clean(self):
        for t in case.TYPES:
            with self.subTest(type=t):
                d = self.new(t, f"{t} case")
                self.assertEqual([i for i in case.check(d)[1] if i.level == "error"], [])

    def test_grade_rules(self):
        d = self.new()
        led = ledger.Ledger(d)
        rep = led.add_evidence(kind="report", claim="ticket", ref="T-1")["id"]
        man = led.add_evidence(kind="manual", claim="guess", ref="memo")["id"]
        self.write_body(d, "## 4. 결론\n", f"""## 4. 결론
- (확인) 티켓대로 두 번 지급 [{rep}]
- (도출) [원인] 락이 없다 [{man}]
- (확인) [원인] 관찰된 원인 [{rep}]
- (도출) 근거 없는 결론
- (도출) 없는 근거 [E99]
- (추론) 근거 없는 추정
문장 속 (확인) 태그
""")
        codes = self.codes(d)
        for code in ("grade-inflation", "causal-observed", "unsupported-claim", "dangling-ref", "uncited-inference",
                     "unparsed-grade"):
            self.assertIn(code, codes)

    def test_causal_needs_repro_and_checks_need_runs(self):
        d = self.new()
        led = ledger.Ledger(d)
        src = self.ws.root / "x.py"
        src.write_text("x\n", encoding="utf-8")
        f = led.add_evidence(kind="file", claim="code", ref=str(src))["id"]
        self.write_body(d, "## 4. 결론\n", f"## 4. 결론\n- (도출) [원인] 코드만 보고 [{f}]\n")
        self.write_body(d, CHK6, f"{CHK6}| CHK-1 | 회귀 | t | ok | PASS | [{f}] |\n")
        codes = self.codes(d)
        self.assertIn("causal-without-repro", codes)
        self.assertIn("check-without-run", codes)

    def test_check_row_in_wrong_table_is_reported(self):
        d = self.new()
        self.write_body(d, "| --- | --- | --- | --- | --- | --- |\n",
                        "| --- | --- | --- | --- | --- | --- |\n| CHK-1 | 회귀 | t | ok | PASS | |\n")
        self.assertIn("unparsed-check", self.codes(d))

    def test_comments_are_not_content(self):
        d = self.new()
        self.write_body(d, "## 4. 결론\n", "## 4. 결론\n<!--\n- (확인) [원인] 예시 [E42]\n-->\n")
        self.assertNotIn("dangling-ref", self.codes(d))

    def test_status_is_cli_owned(self):
        d = self.new()
        self.write_body(d, "status: open", "status: closed")
        self.assertIn("status-mismatch", self.codes(d))

    def test_verify_coverage(self):
        d = self.new("verify", "verify")
        self.write_body(d, "## 2. 요구사항\n", "## 2. 요구사항\n- [REQ-1] a\n- [REQ-2] b\n")
        self.write_body(d, "| --- | --- | --- | --- | --- | --- | --- |\n",
                        "| --- | --- | --- | --- | --- | --- | --- |\n| CHK-1 | REQ-1, REQ-9 | 정상 | bot | ok | TODO | |\n")
        codes = self.codes(d)
        self.assertIn("uncovered-req", codes)
        self.assertIn("unknown-req", codes)
        self.assertIn("check-todo", codes)


class CloseTest(CaseTestBase):
    def repro(self, led, claim: str) -> str:
        """The same command before and after a 'fix' (the marker file)."""
        marker = self.ws.root / "fixed.flag"
        code = f"import pathlib, sys; sys.exit(0 if pathlib.Path({str(marker)!r}).exists() else 1)"
        return led.run_command(argv=[sys.executable, "-c", code], claim=claim, timeout=30, scope=None)[0]["id"]

    def fix(self):
        (self.ws.root / "fixed.flag").write_text("x", encoding="utf-8")

    def run_evidence(self, led, code: int, claim: str) -> str:
        return led.run_command(argv=[sys.executable, "-c", f"import sys; sys.exit({code})"], claim=claim,
                               timeout=30, scope=None)[0]["id"]

    def test_fixed_requires_red_green_review_and_answers(self):
        d = self.new()
        led = ledger.Ledger(d)
        red = self.repro(led, "before")
        self.fix()
        green = self.repro(led, "after")
        self.write_body(d, "## 4. 결론\n", f"## 4. 결론\n- (도출) [원인] 재현됨 [{red}][{green}]\n")
        self.write_body(d, CHK6, f"{CHK6}| CHK-1 | 회귀 | t | ok | PASS | [{green}] |\n")
        led.append({"type": "question", "id": "Q1", "text": "보상?"})
        failed, _ = case.close_gates(d, "fixed", None, self.cases)
        self.assertTrue(any("regression" in f for f in failed))
        self.assertTrue(any("review" in f for f in failed))
        self.assertTrue(any("Q1" in f for f in failed))
        with self.assertRaises(case.CaseError):
            case.close(d, "fixed", None, None, self.cases)
        # satisfy the gates
        self.write_body(d, f"| PASS | [{green}] |", f"| PASS | [{red}][{green}] |")
        review = self.ws.root / "review.md"
        review.write_text("ok", encoding="utf-8")
        with self.assertRaises(ledger.LedgerError):
            led.add_evidence(kind="review", claim="reviewed", ref="adversary")  # a review must attach its output
        e = led.add_evidence(kind="review", claim="reviewed", ref="adversary", attach=review)
        self.assertTrue((d / e["artifact"]["path"]).is_file())
        led.append({"type": "answer", "question": "Q1", "text": "no", "resolution": "answered"})
        entry, failed, _ = case.close(d, "fixed", None, None, self.cases)
        self.assertEqual((failed, entry["forced"]), ([], False))
        self.assertEqual(case.read_meta(d)["status"], "closed")
        with self.assertRaises(case.CaseError):
            case.close(d, "fixed", None, None, self.cases)

    def test_different_commands_do_not_make_red_green(self):
        d = self.new()
        led = ledger.Ledger(d)
        red = self.run_evidence(led, 1, "false")
        green = self.run_evidence(led, 0, "true")
        self.write_body(d, CHK6, f"{CHK6}| CHK-1 | 회귀 | t | ok | PASS | [{red}][{green}] |\n")
        failed, _ = case.close_gates(d, "fixed", None, self.cases)
        self.assertTrue(any("regression" in f for f in failed))

    def test_order_is_ledger_order_not_citation_order(self):
        d = self.new()
        led = ledger.Ledger(d)
        red = self.repro(led, "before")
        self.fix()
        green = self.repro(led, "after")
        self.write_body(d, CHK6, f"{CHK6}| CHK-1 | 회귀 | t | ok | PASS | [{green}][{red}] |\n")
        failed, _ = case.close_gates(d, "fixed", None, self.cases)
        self.assertFalse(any("regression" in f for f in failed), failed)

    def test_data_fix_needs_db_query_and_verify_needs_reqs(self):
        d = self.new()
        led = ledger.Ledger(d)
        led.save_tool_result(tool="log.scan", argv=["log", "scan"], payload={}, claim="scan")
        led.append({"type": "decision", "text": "ok", "by": "pm"}, id_prefix="D")
        failed, _ = case.close_gates(d, "data-fix", None, self.cases)
        self.assertTrue(any("impact query" in f for f in failed))
        v = self.new("verify", "empty verify")
        failed, _ = case.close_gates(v, "done", None, self.cases)
        self.assertTrue(any("at least one" in f for f in failed))

    def test_green_before_red_does_not_count(self):
        d = self.new()
        led = ledger.Ledger(d)
        self.fix()
        green = self.repro(led, "after")
        (self.ws.root / "fixed.flag").unlink()
        red = self.repro(led, "before")
        self.write_body(d, CHK6, f"{CHK6}| CHK-1 | 회귀 | t | ok | PASS | [{green}][{red}] |\n")
        failed, _ = case.close_gates(d, "fixed", None, self.cases)
        self.assertTrue(any("regression" in f for f in failed))

    def test_force_is_recorded_and_counted(self):
        d = self.new()
        entry, failed, _ = case.close(d, "fixed", "hotfix by vendor", None, self.cases)
        self.assertTrue(entry["forced"] and failed)
        st = case.stats(self.cases)
        self.assertEqual((st["closed"], st["forced_closes"]), (1, 1))

    def test_reopen_and_reasons(self):
        d = self.new()
        case.close(d, "dropped", "test", None, self.cases)
        case.set_status(d, "active", "reopen")
        self.assertEqual(case.current_status(ledger.Ledger(d).entries()), "active")
        with self.assertRaises(case.CaseError):
            case.close_gates(d, "done", None, self.cases)  # not a bug reason

    def test_purge_dry_run_then_apply(self):
        d = self.new()
        ledger.Ledger(d).write_artifact("x.txt", b"data")
        case.close(d, "dropped", "test", None, self.cases)
        self.assertEqual(case.purge(self.cases, 0, apply=False)[0]["artifact_bytes"], 4)
        self.assertTrue((d / "artifacts").exists())
        case.purge(self.cases, 0, apply=True)
        self.assertFalse((d / "artifacts").exists())


if __name__ == "__main__":
    unittest.main()
