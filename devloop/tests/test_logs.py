import gzip
import os
import tempfile
import unittest
from datetime import timezone
from pathlib import Path

import _util  # noqa: F401
from devloop import logs, textio
from devloop.timeutil import parse_tz, parse_user_time

PATTERN = (r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(?P<level>[A-Z]+)\] "
           r"\[(?P<server>[\w-]+)\] (?P<msg>.*)$")
PROFILES = logs.profiles_from({"game": {"pattern": PATTERN, "ts_format": "%Y-%m-%d %H:%M:%S.%f", "tz": "+09:00"}})
UTC = timezone.utc


class LogTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name: str, lines: list[str], encoding: str = "utf-8", compress: bool = False) -> str:
        data = ("\n".join(lines) + "\n").encode(encoding)
        p = self.dir / name
        if compress:
            with gzip.open(p, "wb") as f:
                f.write(data)
        else:
            p.write_bytes(data)
        return str(p)

    def engine(self, profile: str = "auto") -> logs.Engine:
        return logs.Engine(PROFILES, profile)


class DecodingTest(LogTestBase):
    LINES = ["2026-10-20 09:00:00.000 [INFO] [g1] 보상 지급 uid=1", "2026-10-20 09:00:01.000 [WARN] [g1] 중복 uid=2"]

    def decode(self, path: str):
        src = textio.open_text(path)
        try:
            return [t for _, t in src], src.stats
        finally:
            src.close()

    def test_encodings(self):
        for name, enc, expected in [("u8.log", "utf-8", "utf-8"), ("bom.log", "utf-8-sig", "utf-8"),
                                    ("cp.log", "cp949", "cp949"), ("u16.log", "utf-16", "utf-16-le"),
                                    ("u16nb.log", "utf-16-le", "utf-16-le")]:
            with self.subTest(enc=enc):
                lines, st = self.decode(self.write(name, self.LINES, enc))
                self.assertEqual(lines, self.LINES)
                self.assertEqual(st.encoding, expected)
                self.assertEqual(st.replaced_lines, 0)

    def test_mixed_lines_counted(self):
        p = self.dir / "mixed.log"
        p.write_bytes(self.LINES[0].encode("utf-8") + b"\n" + self.LINES[1].encode("cp949") + b"\n\xff\xfe\xff\n")
        lines, st = self.decode(str(p))
        self.assertEqual(lines[:2], self.LINES)
        self.assertEqual((st.fallback_lines, st.replaced_lines), (1, 1))

    def test_gzip_and_binary(self):
        lines, st = self.decode(self.write("g.log.gz", self.LINES, "cp949", compress=True))
        self.assertEqual(lines, self.LINES)
        self.assertTrue(st.compressed)
        (self.dir / "x.db").write_bytes(b"SQLite format 3\x00" + b"\x00" * 200)
        lines, st = self.decode(str(self.dir / "x.db"))
        self.assertEqual((lines, st.encoding), ([], "binary"))

    def test_decode_output(self):
        text, st = textio.decode_output("가\r\n나".encode("cp949"))
        self.assertEqual((text, st.encoding), ("가\n나", "cp949"))


class ParseTest(LogTestBase):
    def test_profile_detection_multiline_and_tz(self):
        p = self.write("a.log", [
            "2026-10-20 09:00:00.000 [INFO] [g1] start",
            "2026-10-20 09:00:01.500 [ERROR] [g1] boom",
            "  at Foo.Bar(Foo.cs:1)",
            "2026-10-20 09:00:02.000 [INFO] [g1] done uid=7 latency_ms=12",
        ])
        eng = self.engine()
        recs = list(eng.records(logs.file_sources([p])))
        self.assertEqual(len(recs), 3)
        self.assertEqual(eng.sources[0].profile, "game")
        self.assertEqual(eng.sources[0].continuation_lines, 1)
        self.assertIn("Foo.cs:1", recs[1].msg)
        self.assertEqual(recs[0].ts.astimezone(UTC).hour, 0)  # 09:00 KST == 00:00 UTC
        self.assertEqual(recs[2].field("uid"), "7")
        self.assertEqual(recs[2].field("server"), "g1")

    def test_json_and_plain(self):
        j = self.write("a.jsonl", ['{"time":"2026-10-20T00:00:00Z","level":"warning","msg":"x","uid":5}'] * 3)
        eng = self.engine()
        recs = list(eng.records(logs.file_sources([j])))
        self.assertEqual((recs[0].level, recs[0].field("uid"), eng.sources[0].profile), ("WARN", "5", "json"))
        p = self.write("p.log", ["2026/10/20 00:00:00 ERROR something", "no timestamp here"])
        recs = list(self.engine().records(logs.file_sources([p])))
        self.assertEqual(recs[0].level, "ERROR")
        self.assertIsNotNone(recs[0].ts)
        self.assertIsNone(recs[1].ts)

    def test_unparsed_lines_are_reported(self):
        p = self.write("u.log", ["garbage first", "2026-10-20 09:00:00.000 [INFO] [g1] ok"] * 3)
        eng = self.engine("game")
        list(eng.records(logs.file_sources([p])))
        self.assertEqual(eng.sources[0].unparsed, 1)  # later garbage lines fold into the previous record

    def test_template_masking(self):
        t = logs.template_of('reward uid=1042 req=r000746 from 10.0.0.1:8080 id 3f2a9c1b-0d1e-4f00-9a1b-0123456789ab "quoted"')
        self.assertEqual(t, 'reward uid=<*> req=<*> from <ip> id <uuid> "<*>"')
        self.assertEqual(logs.template_of("채팅 필터: 금칙어 감지 uid=3"), "채팅 필터: 금칙어 감지 uid=<*>")
        cases = {
            'msg="hello world" n=3': 'msg=<*> n=<*>',
            "at 2026-10-20T00:00:01.5Z took 12.5 ms": "at <ts> took <n> ms",
            "ptr 0x7ffe at=2026-10-20T00:00:00Z": "ptr <hex> at=<*>",
            "token deadbeef00112233 v2 x-1 -7": "token <hex> v2 <id> <n>",
            "player3 hit 25 times": "<id> hit <n> times",
            "char_1234 picked ITEM_3A at #G12 on game-01": "<id> picked <id> at #<id> on <id>",
            "build 1.4.3 tick ms": "build <n>.<n> tick ms",
        }
        for text, expected in cases.items():
            self.assertEqual(logs.template_of(text), expected, text)


class CommandsTest(LogTestBase):
    def setUp(self):
        super().setUp()
        lines = []
        for i in range(30):
            lines.append(f"2026-10-20 09:{i:02d}:00.000 [INFO] [g1] claim uid={1000 + i % 3} retry=0")
        lines.append("2026-10-20 09:40:00.000 [WARN] [g1] slow latency_ms=2000 uid=1001")
        self.a = self.write("a.log", lines)
        self.b = self.write("b.log", ["2026-10-20 09:05:00.010 [INFO] [g2] grant uid=1001",
                                      "2026-10-20 09:05:00.005 [INFO] [g2] grant uid=1001"])
        self.tz = parse_tz("UTC")

    def test_scan_counts_and_templates(self):
        r = logs.scan(self.engine(), logs.file_sources([self.a, self.b]), logs.Filter(), 5, self.tz)
        self.assertEqual(r["matched"], 33)
        self.assertEqual(r["templates"][0]["count"], 30)
        self.assertEqual(r["coverage"]["records"], 33)

    def test_query_limits_report_totals_and_context(self):
        f = logs.Filter(conds=[logs.parse_cond("uid=1001")])
        r = logs.query(self.engine(), logs.file_sources([self.a]), f, 3, 0, 1, self.tz)
        self.assertEqual(r["matched"], 11)
        self.assertEqual(r["returned"], 3)
        self.assertTrue(r["truncated"])
        self.assertTrue(any(x["role"] == "context" for x in r["records"]))
        f = logs.Filter(conds=[logs.parse_cond("latency_ms>1500")])
        self.assertEqual(logs.query(self.engine(), logs.file_sources([self.a]), f, None, 0, 0, self.tz)["matched"], 1)

    def test_time_window_and_level(self):
        f = logs.Filter(since=parse_user_time("2026-10-20T00:10:00Z", self.tz),
                        until=parse_user_time("2026-10-20T00:20:00Z", self.tz))
        self.assertEqual(logs.query(self.engine(), logs.file_sources([self.a]), f, None, 0, 0, self.tz)["matched"], 10)
        f = logs.Filter(min_level=logs.level_threshold("WARN"))
        self.assertEqual(logs.query(self.engine(), logs.file_sources([self.a]), f, None, 0, 0, self.tz)["matched"], 1)

    def test_timeline_orders_across_sources_with_caveat(self):
        f = logs.Filter(keys=[logs.key_pattern("1001")])
        r = logs.timeline(self.engine(), logs.file_sources([self.a, self.b]), f, None, self.tz)
        times = [x["ts"] for x in r["records"]]
        self.assertEqual(times, sorted(times))
        self.assertTrue(any("clock skew" in c for c in r["caveats"]))
        self.assertEqual(r["records"][1]["delta_ms"] is not None, True)

    def test_diff_is_level_aware(self):
        tz = self.tz
        f1 = logs.Filter(since=parse_user_time("2026-10-20T00:00Z", tz), until=parse_user_time("2026-10-20T00:30Z", tz))
        f2 = logs.Filter(since=parse_user_time("2026-10-20T00:30Z", tz), until=parse_user_time("2026-10-20T01:00Z", tz))
        r = logs.diff((self.engine(), logs.file_sources([self.a]), f1, 30.0),
                      (self.engine(), logs.file_sources([self.a]), f2, 30.0), 5, 1, tz)
        self.assertEqual([(x["level"], x["template"]) for x in r["new"]], [("WARN", "slow latency_ms=<*> uid=<*>")])
        self.assertEqual(r["rate_unit"], "per_minute")

    def test_probe_suggests_profile(self):
        r = logs.probe(self.a, PROFILES)
        self.assertEqual(r["suggested_profile"], "game")
        self.assertEqual(r["timestamped_records"], 31)

    def test_command_source(self):
        src = logs.command_source("cat", {"command": [os.sys.executable, "-c", "import sys;print(open(sys.argv[1]).read())",
                                                      self.a]}, {})
        r = logs.scan(self.engine(), [src], logs.Filter(), 3, self.tz)
        self.assertEqual(r["matched"], 31)
        self.assertEqual(r["coverage"]["sources"][0]["origin"]["kind"], "command")

    def test_command_source_with_noisy_stderr_does_not_hang(self):
        code = ("import sys\nsys.stderr.write('warning: x\\n' * 20000)\nsys.stderr.flush()\n"
                f"print(open({self.a!r}).read())")
        src = logs.command_source("noisy", {"command": [os.sys.executable, "-c", code]}, {})
        r = logs.scan(self.engine(), [src], logs.Filter(), 3, self.tz)
        self.assertEqual(r["matched"], 31)

    def test_short_level_names(self):
        p = self.write("s.log", [f"2026-10-20 09:00:0{i}.000 [{lv}] [g1] m" for i, lv in enumerate(["INF", "WRN", "ERR", "FTL", "DBG"])])
        f = logs.Filter(min_level=logs.level_threshold("WARN"))
        r = logs.query(self.engine(), logs.file_sources([p]), f, None, 0, 0, self.tz)
        self.assertEqual([x["level"] for x in r["records"]], ["WARN", "ERROR", "FATAL"])

    def test_profile_encoding_applies_under_auto(self):
        profiles = logs.profiles_from({"sj": {"pattern": PATTERN, "ts_format": "%Y-%m-%d %H:%M:%S.%f",
                                              "tz": "+09:00", "encoding": "shift_jis"}})
        p = self.write("jp.log", ["2026-10-20 09:00:00.000 [INFO] [g1] ログイン成功 uid=1"] * 3, "shift_jis")
        recs = list(logs.Engine(profiles, "auto").records(logs.file_sources([p])))
        self.assertEqual(recs[0].msg, "ログイン成功 uid=1")

    def test_dst_ambiguous_local_times_are_counted(self):
        try:
            profiles = logs.profiles_from({"eu": {"pattern": PATTERN, "ts_format": "%Y-%m-%d %H:%M:%S.%f",
                                                  "tz": "Europe/Berlin"}})
        except logs.LogError:
            self.skipTest("IANA zone data unavailable")
        p = self.write("eu.log", ["2026-10-25 02:30:00.000 [INFO] [g1] in the repeated hour",
                                  "2026-10-25 04:30:00.000 [INFO] [g1] after"])
        eng = logs.Engine(profiles, "eu")
        list(eng.records(logs.file_sources([p])))
        self.assertEqual(eng.sources[0].ambiguous_ts, 1)

    def test_bad_inputs(self):
        with self.assertRaises(logs.LogError):
            logs.file_sources([str(self.dir / "missing.log")])
        with self.assertRaises(logs.LogError):
            logs.parse_cond("nonsense")
        with self.assertRaises(logs.LogError):
            logs.build_profile("x", {"format": "regex", "pattern": "("})


if __name__ == "__main__":
    unittest.main()
