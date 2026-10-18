// The infiltration caption (국운 tab and ending, rules INFILTRATION_NOTE)
// quotes the rule that settles 1910, so it can never again promise
// 「역사의 길」 only at 100.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NATION_ENDINGS } from "../../src/shared/content/endings.ts";
import { ENDING_RULE, INFILTRATION_NOTE } from "../../src/shared/rules/index.ts";

test("the infiltration caption states the ending rule's own numbers", () => {
  assert.equal(
    INFILTRATION_NOTE,
    "외세의 침투. 놓친 분기마다 오르고(모두 놓치면 100), 1910년 판정에서 1마다 −0.3점이다. 판정이 45점에 못 미치고 B12b까지 놓치면 「역사의 길」로 간다.",
  );
  assert.ok(INFILTRATION_NOTE.includes(`${ENDING_RULE.n2.score}점`));
  assert.ok(INFILTRATION_NOTE.includes(`−${Math.abs(ENDING_RULE.infiltration)}점`));
  assert.ok(INFILTRATION_NOTE.includes(ENDING_RULE.n2.branch));
  assert.ok(INFILTRATION_NOTE.includes(`「${NATION_ENDINGS.N3.title}」`));
  assert.doesNotMatch(INFILTRATION_NOTE, /100이면/);
});
