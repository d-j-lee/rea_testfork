"""Eval suite hygiene: scaffolds are generated from their single sources."""

import importlib.util
import re
import tomllib
import unittest

import _util

spec = importlib.util.spec_from_file_location("build_eval_fixtures", _util.ROOT / "tools" / "build_eval_fixtures.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

PROMPT_KEYS = {"name", "description", "tags", "plugins", "runs", "expected_outcome", "model", "max_turns",
               "timeout_seconds", "allowed_tools", "append_system_prompt", "env"}


class EvalSuiteTest(unittest.TestCase):
    def test_scaffold_is_current(self):
        committed = (build.CASE / "scaffold.sh").read_text(encoding="utf-8")
        self.assertEqual(committed, build.scaffold(), "run: python tools/build_eval_fixtures.py")

    def test_eval_profile_matches_sandbox(self):
        sandbox = tomllib.loads((_util.SANDBOX / ".devloop" / "config.toml").read_text(encoding="utf-8"))
        evalcfg = tomllib.loads(build.CONFIG)
        self.assertEqual(evalcfg["log"]["profiles"]["sandbox"], sandbox["log"]["profiles"]["sandbox"])

    def test_prompt_frontmatter_keys(self):
        for prompt in (_util.PLUGIN / "evals").glob("*/prompt.md"):
            text = prompt.read_text(encoding="utf-8")
            m = re.match(r"---\n(.*?)\n---\n", text, re.S)
            keys = {line.split(":", 1)[0].strip() for line in m.group(1).splitlines() if ":" in line}
            self.assertLessEqual(keys, PROMPT_KEYS, prompt)
            self.assertTrue(list((prompt.parent / "graders").glob("*.md")), "a case needs a grader")


if __name__ == "__main__":
    unittest.main()
