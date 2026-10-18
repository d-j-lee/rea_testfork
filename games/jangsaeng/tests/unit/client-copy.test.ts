// Presenter copy in the client that names content facts (battles, terms,
// branches) must agree with the content registry and rules that own them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS } from "../../src/shared/content/index.ts";
import { BRANCH_IDS } from "../../src/shared/content/schema.ts";
import { BRANCH_LABELS } from "../../src/shared/rules/index.ts";
import { ALL_BRANCHES, BRANCH_YEARS, chapterMeta, greatBattleTitles, PITCH_BATTLES } from "../../src/client/ui/chapters.ts";

test("the pitch names its 대전 by their content titles (남한산성 is a 농성, 정족산성 a 전투)", () => {
  assert.deepEqual(greatBattleTitles(PITCH_BATTLES), ["황산대첩", "행주대첩", "명량대첩", "남한산성 농성", "정족산성 전투"]);
});

test("greatBattleTitles leaves out ids that are not 대전", () => {
  assert.deepEqual(greatBattleTitles(["ch02_jinpo", "nope", "b_namhan"]), ["남한산성 농성"]);
});

test("the demo grid uses ch05's own terms for the 1419 expedition", () => {
  const ch05 = JSON.stringify(CHAPTERS.ch05);
  const highlight = chapterMeta("ch05").highlight;
  assert.match(highlight, /쓰시마 정벌\(기해동정\)/);
  assert.ok(ch05.includes("쓰시마") && ch05.includes("기해동정"));
  assert.ok(!highlight.includes("대마도") || ch05.includes("대마도"));
});

test("the branch range the pitch and help name runs over every branch id", () => {
  assert.equal(ALL_BRANCHES, `${BRANCH_IDS[0]}–${BRANCH_IDS[BRANCH_IDS.length - 1]}`);
  assert.equal(ALL_BRANCHES, "B1–B12c");
});

test("the pitch's branch years are the first and last branch's own years", () => {
  const first = BRANCH_LABELS[BRANCH_IDS[0]];
  const last = BRANCH_LABELS[BRANCH_IDS[BRANCH_IDS.length - 1] as (typeof BRANCH_IDS)[number]];
  assert.match(first, new RegExp(`\\(${BRANCH_YEARS[0]}[)~]`), first);
  assert.match(last, new RegExp(`[(~]${BRANCH_YEARS[1]}\\)`), last);
});

test("the demo grid tags each branch chapter with the branches the rules decide there", () => {
  const branchTags = (id: "ch12" | "ch13" | "ch14" | "ch15" | "ch16") => chapterMeta(id).tags.filter((tag) => /^B\d/.test(tag));
  assert.deepEqual(branchTags("ch12"), []);
  assert.deepEqual(branchTags("ch13"), ["B1·B2"]);
  assert.deepEqual(branchTags("ch14"), ["B3·B4"]);
  assert.deepEqual(branchTags("ch15"), ["B5–B8"]);
  assert.deepEqual(branchTags("ch16"), ["B9–B12c"]);
  assert.deepEqual(chapterMeta("ch16").tags.at(-1), "최종장");
});
