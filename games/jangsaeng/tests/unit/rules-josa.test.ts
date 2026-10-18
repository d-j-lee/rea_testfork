// Particles after names (rules/util.ts josa): every template that puts a name
// before 은/는, 이/가, 을/를, 과/와 or 으로/로 picks the form the name's last sound takes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSave, josa, washIdentity } from "../../src/shared/rules/index.ts";
import { FIXTURE, newSave } from "./rules-fixture.ts";

test("josa picks the particle from the last sound: vowel, ㄹ, other finals, digits, Latin, closing marks", () => {
  assert.equal(josa("윤무진", "으로/로"), "윤무진으로");
  assert.equal(josa("이원춘", "으로/로"), "이원춘으로");
  assert.equal(josa("강상호", "으로/로"), "강상호로", "no final");
  assert.equal(josa("한결", "으로/로"), "한결로", "ㄹ takes 로");
  assert.equal(josa("제주", "으로/로"), "제주로");
  assert.equal(josa("강진", "으로/로"), "강진으로");
  assert.equal(josa("윤무진", "이/가"), "윤무진이");
  assert.equal(josa("강상호", "이/가"), "강상호가");
  assert.equal(josa("한결", "이/가"), "한결이", "ㄹ is a final for 이/가");
  assert.equal(josa("산삼", "을/를"), "산삼을");
  assert.equal(josa("부채", "을/를"), "부채를");
  assert.equal(josa("백도윤", "은/는"), "백도윤은");
  assert.equal(josa("송상", "과/와"), "송상과");
  assert.equal(josa("홍가", "과/와"), "홍가와");
  assert.equal(josa("150", "이/가"), "150이", "백오십: 십");
  assert.equal(josa("1", "으로/로"), "1로", "일: ㄹ");
  assert.equal(josa("2", "이/가"), "2가", "이: no final");
  assert.equal(josa("Kim", "이/가"), "Kim이");
  assert.equal(josa("Lee", "으로/로"), "Lee로");
  assert.equal(josa("Paul", "으로/로"), "Paul로");
  assert.equal(josa("「장용영」", "이/가"), "「장용영」이", "closing marks are skipped");
  assert.equal(josa("漢", "으로/로"), "漢(으)로", "an unknown sound keeps both forms");
  assert.equal(josa("漢", "이/가"), "漢이(가)");
});

test("no chronicle line of a run or a demo preset keeps a (으)로 or 이(가) placeholder", () => {
  const vowelEnd = newSave({ name: "강상호" });
  washIdentity(FIXTURE, vowelEnd, "descendant", "윤무진");
  washIdentity(FIXTURE, vowelEnd, "merchant", "이수");
  const texts = vowelEnd.chronicle.map((entry) => entry.text);
  assert.ok(texts.includes("강상호의 이름을 버리고 윤무진으로 살아가다 (낙향 후 후손 행세)."), texts.join(" / "));
  assert.ok(texts.includes("윤무진의 이름을 버리고 이수로 살아가다 (상인 행세)."), texts.join(" / "));
  for (const demoChapter of ["ch08", "ch16"] as const) {
    const demo = createSave(FIXTURE, { token: "t", name: "한결", variant: "m", origin: "northeast", seed: 9, demoChapter });
    for (const entry of demo.chronicle) assert.doesNotMatch(entry.text, /\(으\)로|이\(가\)|을\(를\)|은\(는\)/, entry.text);
    assert.ok(demo.chronicle.some((entry) => entry.text.endsWith("한결로 살아가다 (낙향 후 후손 행세).") || entry.text.includes("한결로 살아가다")), demoChapter);
  }
});
