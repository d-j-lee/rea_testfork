import unittest

import _util  # noqa: F401
from devloop.sqlguard import analyze_redis, analyze_sql

CASES = [
    # (sql, dialect, classification, bounded)
    ("SELECT TOP 10 * FROM users WITH (NOLOCK) WHERE uid = 1", "auto", "read", True),
    ("select * from t", "auto", "read", False),
    ("SELECT COUNT(*) FROM t", "auto", "read", True),
    ("SELECT COUNT(*) FROM (SELECT uid FROM r GROUP BY uid HAVING COUNT(*) > 1) x", "auto", "read", True),
    ("SELECT uid, COUNT(*) FROM r GROUP BY uid", "auto", "read", False),
    ("SET NOCOUNT ON; SELECT TOP 5 * FROM t", "mssql", "read", True),
    ("SELECT REPLACE(name, 'a', 'b') FROM t LIMIT 5", "auto", "read", True),
    ("SELECT * FROM t WHERE note = 'please DELETE me' LIMIT 1", "auto", "read", True),
    ("SELECT [delete] FROM t", "mssql", "read", False),
    ("EXEC sp_who2", "auto", "read", True),
    ("PRAGMA table_info(t)", "sqlite", "read", True),
    ("SELECT 1\nGO\nSELECT 2", "mssql", "read", True),
    # writes, including ones that hide behind comments, strings and missing separators
    ("SELECT 1 DELETE FROM t", "auto", "write", None),
    ("SELECT '\\'' ; DROP TABLE x; -- '", "auto", "write", None),
    ("SELECT 1 /*!50000 ; DROP TABLE t */", "auto", "write", None),
    ("SELECT $$ ; DROP TABLE x; $$", "auto", "write", None),
    ("SELECT * INTO backup_t FROM t", "auto", "write", None),
    ("SELECT * FROM t INTO OUTFILE '/tmp/x'", "mysql", "write", None),
    ("WITH c AS (SELECT 1) UPDATE t SET a = 1", "auto", "write", None),
    ("EXEC dbo.usp_GiveItem 1", "auto", "write", None),
    ("EXEC('DELETE FROM t')", "auto", "write", None),
    ("EXEC @rc = dbo.usp_X", "auto", "write", None),
    ("SELECT nextval('s')", "postgres", "write", None),
    ("SET GLOBAL max_connections = 1", "mysql", "write", None),
    ("PRAGMA journal_mode = WAL", "sqlite", "write", None),
    ("MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE", "auto", "write", None),
    ("TRUNCATE TABLE t", "auto", "write", None),
    ("SELECT * FROM OPENQUERY(LIVE, 'SELECT 1')", "mssql", "write", None),
    ("CALL give_item(1)", "auto", "write", None),
    # risky
    ("SELECT * FROM t FOR UPDATE", "auto", "risky", None),
    ("SELECT * FROM t WITH (UPDLOCK)", "mssql", "risky", None),
    ("EXPLAIN ANALYZE SELECT 1", "postgres", "risky", None),
    ("BEGIN TRAN; SELECT 1; COMMIT", "mssql", "risky", None),
    ("usp_GiveItem 1", "mssql", "risky", None),
    ("WAITFOR DELAY '00:00:10'", "mssql", "risky", None),
    ("SELECT 'unterminated", "auto", "risky", None),
    ("", "auto", "risky", None),
]


class SqlGuardTest(unittest.TestCase):
    def test_table(self):
        for sql, dialect, cls, bounded in CASES:
            with self.subTest(sql=sql):
                a = analyze_sql(sql, dialect)
                self.assertEqual(a.classification, cls, [f.__dict__ for f in a.findings])
                if bounded is not None:
                    self.assertEqual(a.bounded, bounded)

    def test_auto_is_strictest_of_dialects(self):
        # MySQL reads '#' as a comment; T-SQL reads '#x' as a temp table name.
        self.assertEqual(analyze_sql("SELECT 1 #\nDROP TABLE x").classification, "write")
        # Brackets are identifiers only in T-SQL/SQLite, so auto stays conservative.
        self.assertEqual(analyze_sql("SELECT [delete] FROM t").classification, "write")

    def test_exec_allowlist_is_configurable(self):
        self.assertEqual(analyze_sql("EXEC dbo.usp_Report", "mssql", ["usp_report"]).classification, "read")

    def test_findings_explain(self):
        a = analyze_sql("SELECT * FROM t WITH (UPDLOCK)", "mssql")
        self.assertTrue(any(f.code == "lock-hint" for f in a.findings))

    def test_unknown_dialect(self):
        with self.assertRaises(ValueError):
            analyze_sql("SELECT 1", "oracle")

    def test_redis(self):
        self.assertEqual(analyze_redis(["GET", "k"]).classification, "read")
        self.assertEqual(analyze_redis(["keys", "*"]).classification, "risky")
        self.assertEqual(analyze_redis(["FLUSHALL"]).classification, "write")
        self.assertEqual(analyze_redis(["EVAL", "return 1", "0"]).classification, "write")
        self.assertEqual(analyze_redis([]).classification, "risky")


if __name__ == "__main__":
    unittest.main()
