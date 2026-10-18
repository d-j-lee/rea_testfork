// Presenter copy in the client that names content facts (battles, terms)
// must agree with the content registry that owns them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS } from "../../src/shared/content/index.ts";
import { chapterMeta, greatBattleTitles, PITCH_BATTLES } from "../../src/client/ui/chapters.ts";

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
