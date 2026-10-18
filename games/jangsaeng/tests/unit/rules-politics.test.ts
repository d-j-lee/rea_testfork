// Purge risk formula, hypothetical preview, determinism and severity bands.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PurgeSpec } from "../../src/shared/content/schema.ts";
import { applyEffects, hashRoll, purgeRisk, purgeTerms } from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { FIXTURE, newSave } from "./rules-fixture.ts";

/** A save whose risk is exactly E − 1 (tact 1, nothing else). */
function plainSave(): PlayerSave {
  const save = newSave({ origin: "kaesong" });
  save.stats.tact = 1;
  save.favor = {};
  return save;
}

/** First id whose roll falls inside [min, max]. */
function idWithRoll(save: PlayerSave, min: number, max: number): { id: string; roll: number } {
  for (let index = 0; ; index++) {
    const id = `purge_case_${index}`;
    const roll = hashRoll(save.seed, id);
    if (roll >= min && roll <= max) return { id, roll };
  }
}

test("risk formula: intensity, favors, suspicion, exposure, tact and protection", () => {
  const save = newSave();
  save.stats.tact = 5;
  save.suspicion = 20;
  save.rank = 14;
  save.meritSubject = 2;
  save.favor = { jeong: 50, bangwon: 0 };
  const spec: PurgeSpec = { id: "1398", intensity: 45, winner: "bangwon", loser: "jeong" };
  // 45 + 0.4·50 − 0 + 0.25·20 + 10 + 10 − 5 = 85
  assert.equal(purgeRisk(FIXTURE, save, spec), 85);
  assert.equal(purgeRisk(FIXTURE, save, { ...spec, neutral: true }), 70);
  save.favor["bangwon"] = 40;
  assert.equal(purgeRisk(FIXTURE, save, spec), 73, "winner favor −0.3/pt");
  save.favor["bangwon"] = -80;
  assert.equal(purgeRisk(FIXTURE, save, spec), 85, "negative winner favor is ignored");
  save.bonds["yi_sunsin"] = 60;
  assert.equal(purgeRisk(FIXTURE, save, spec), 75, "a bond ≥ 60 protects (−10)");
  assert.equal(purgeRisk(FIXTURE, save, { ...spec, intensity: 200 }), 95, "clamped to 95");
  assert.equal(purgeRisk(FIXTURE, save, { ...spec, intensity: -200 }), 5, "clamped to 5");
  const labels = purgeTerms(save, spec).map((term) => term.label);
  assert.deepEqual(labels, ["사건 강도", "패배측 총애", "의심도", "당상관", "공신", "처세", "인연 보호"]);
});

test("preview applies hypothetical effects to a clone only", () => {
  const save = newSave();
  save.stats.tact = 5;
  const spec: PurgeSpec = { id: "1453", intensity: 60, winner: "sejo", loser: "kim" };
  const before = JSON.stringify(save);
  const base = purgeRisk(FIXTURE, save, spec);
  const sideWithWinner = purgeRisk(FIXTURE, save, spec, [{ k: "favor", faction: "sejo", add: 40 }]);
  const sideWithLoser = purgeRisk(FIXTURE, save, spec, [{ k: "favor", faction: "kim", add: 40 }, { k: "suspicion", add: 20 }]);
  assert.equal(base, 55);
  assert.equal(sideWithWinner, 43);
  assert.equal(sideWithLoser, 76);
  assert.equal(JSON.stringify(save), before, "the real save is untouched");
});

test("same purge id gives the same verdict across clones and reloads", () => {
  const spec: PurgeSpec = { id: "1519_gimyo", intensity: 45, winner: "hungu", loser: "sarim" };
  const verdicts = new Set<string>();
  for (let copy = 0; copy < 5; copy++) {
    const save = newSave();
    save.favor["sarim"] = 30;
    const reloaded = JSON.parse(JSON.stringify(save)) as PlayerSave;
    applyEffects(FIXTURE, reloaded, [{ k: "purge", spec }]);
    verdicts.add(String(reloaded.flags["purge:1519_gimyo"]));
  }
  assert.equal(verdicts.size, 1);
  // A different seed is a different person and may fare differently, but deterministically.
  const other = newSave({ seed: 99 });
  const first = applyEffects(FIXTURE, JSON.parse(JSON.stringify(other)) as PlayerSave, [{ k: "purge", spec }]);
  const second = applyEffects(FIXTURE, JSON.parse(JSON.stringify(other)) as PlayerSave, [{ k: "purge", spec }]);
  assert.deepEqual(first.lines, second.lines);
});

test("roll ≥ R survives and counts", () => {
  const save = plainSave();
  const { id, roll } = idWithRoll(save, 20, 90);
  const out = applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: roll + 1, winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "survived");
  assert.equal(save.record.purgesSurvived, 1);
  assert.equal(out.escape, false);
  assert.equal(out.lines[0]?.text, `숙청 판정 — 위험 ${roll} · 판정값 ${roll}`);
});

test("severity 0–14 dismisses (rank −3, salary suspended)", () => {
  const save = plainSave();
  save.rank = 10;
  const { id, roll } = idWithRoll(save, 10, 60);
  applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: roll + 14 + 1, winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "dismissed");
  assert.equal(save.rank, 7);
  assert.equal(save.flags["salarySuspended"], true);
});

test("severity 15–34 exiles (rank −5, exile site or a remote default)", () => {
  const save = plainSave();
  save.rank = 4;
  const { id, roll } = idWithRoll(save, 10, 60);
  applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: roll + 15 + 1, winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "exiled");
  assert.equal(save.rank, 0);
  assert.equal(save.exile, "jeju");
  const named = plainSave();
  const pick = idWithRoll(named, 10, 60);
  applyEffects(FIXTURE, named, [{ k: "purge", spec: { id: pick.id, intensity: pick.roll + 34 + 1, winner: null, loser: null, exileSite: "geoje" } }]);
  assert.equal(named.exile, "geoje");
});

test("severity ≥ 35 is a death-sentence crisis handled by an escape battle", () => {
  const save = plainSave();
  const { id, roll } = idWithRoll(save, 10, 55);
  const out = applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: roll + 35 + 1, winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "sentenced");
  assert.equal(out.escape, true);
});
