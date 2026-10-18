// Purge risk (GDD §5.5.3): side multiplier, protection, worked examples,
// 풍향계 blur and preview, determinism and outcome margins.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT } from "../../src/shared/content/index.ts";
import { CHAPTER_IDS, type Cond, type Effect, type PurgeSpec } from "../../src/shared/content/schema.ts";
import {
  applyEffects,
  createSave,
  hashRoll,
  purgeProtection,
  purgeRisk,
  purgeRiskShown,
  purgeSide,
  purgeTerms,
} from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { FIXTURE, newSave } from "./rules-fixture.ts";

const P1398: PurgeSpec = { id: "purge_1398", intensity: 45, winner: "bangwon", loser: "jeongdojeon", exileSite: "jeju" };
const P1453: PurgeSpec = { id: "purge_1453", intensity: 60, winner: "suyang", loser: "kimjongseo", exileSite: "hoeryeong" };

function riskWith(setup: (save: PlayerSave) => void, spec: PurgeSpec): number {
  const save = newSave();
  save.favor = {};
  setup(save);
  return purgeRisk(FIXTURE, save, spec);
}

test("side multiplier: 0.3 with the winner, 1.0 with the loser, 0.6 otherwise", () => {
  const save = newSave();
  assert.equal(purgeSide(save, P1398), 0.6);
  save.aligned = "bangwon";
  assert.equal(purgeSide(save, P1398), 0.3);
  save.aligned = "jeongdojeon";
  assert.equal(purgeSide(save, P1398), 1.0);
  save.aligned = "someone_else";
  assert.equal(purgeSide(save, P1398), 0.6);
});

test("a neutral option stands aside: 0.6 whatever the player was aligned with, no flat discount", () => {
  const save = newSave();
  save.favor = {};
  save.stats.tact = 5;
  const neutral: PurgeSpec = { ...P1398, neutral: true };
  for (const aligned of [null, "bangwon", "jeongdojeon", "someone_else"]) {
    save.aligned = aligned;
    assert.equal(purgeSide(save, neutral), 0.6, `aligned ${aligned}`);
    // 0.6·45 − 5 = 22, the same for preview and roll.
    assert.equal(purgeRisk(FIXTURE, save, neutral), 22, `aligned ${aligned}`);
  }
  // An earlier align in the same chapter does not leak into the neutral option.
  save.aligned = "jeongdojeon";
  assert.equal(purgeRisk(FIXTURE, save, P1398), 40, "1.0·45 − 5 for the side that loses");
  assert.equal(purgeRisk(FIXTURE, save, neutral), 22);
});

test("protection: 5 per 열전 bond ≥ 60 (max 15) + 5 for 동료 보증; family houses don't count", () => {
  const save = newSave();
  save.bonds = { yi_sunsin: 60, kim_jongseo: 70, jeongjo: 90, park_gyusu: 99, han_house: 100 };
  assert.equal(purgeProtection(save), 15);
  save.flags["vouch"] = true;
  assert.equal(purgeProtection(save), 20);
  save.bonds = { han_house: 100, baek_house: 100 };
  assert.equal(purgeProtection(save), 5);
});

test("§5.5.3 worked example 1398 (E45, 의심도 35, renowned, 처세 14): 6% · 33% · 66%", () => {
  // The GDD leaves favor implicit; these are the favor states that reproduce it.
  const base = (save: PlayerSave) => {
    save.suspicion = 35;
    save.flags["renowned"] = true;
    save.stats.tact = 14;
  };
  const bangwon = riskWith((save) => { base(save); save.aligned = "bangwon"; save.favor["bangwon"] = 40; }, P1398);
  const neutral = riskWith((save) => { base(save); save.favor["jeongdojeon"] = 4; }, P1398);
  const jeong = riskWith((save) => { base(save); save.aligned = "jeongdojeon"; save.favor["jeongdojeon"] = 40; }, P1398);
  assert.deepEqual([bangwon, neutral, jeong], [6, 33, 66]);
  // Without any favor the neutral stance is 0.6·45 + 8.75 + 10 − 14 = 31.75 → 32.
  assert.equal(riskWith(base, P1398), 32);
});

test("§5.5.3 worked example 1453 (E60, 의심도 30, 당상관, 처세 18, 보호 5): 5% · 38% · 72%", () => {
  const base = (save: PlayerSave) => {
    save.suspicion = 30;
    save.rank = 14;
    save.stats.tact = 18;
    save.bonds["yi_sunsin"] = 60;
  };
  const suyang = riskWith((save) => { base(save); save.aligned = "suyang"; save.favor["suyang"] = 25; }, P1453);
  const hermit = riskWith((save) => { base(save); save.favor["kimjongseo"] = 19; }, P1453);
  const kim = riskWith((save) => { base(save); save.aligned = "kimjongseo"; save.favor["kimjongseo"] = 44; }, P1453);
  assert.deepEqual([suyang, hermit, kim], [5, 38, 72]);
});

test("terms list every part of the formula; R clamps to 5..95", () => {
  const save = newSave();
  save.favor = { jeongdojeon: 50, bangwon: 10 };
  save.aligned = "jeongdojeon";
  save.suspicion = 20;
  save.rank = 14;
  save.flags["renowned"] = true;
  save.flags["vouch"] = true;
  save.stats.tact = 5;
  // 45 + 20 − 3 + 5 + 10 + 10 − 5 − 5 = 77
  assert.equal(purgeRisk(FIXTURE, save, P1398), 77);
  assert.deepEqual(purgeTerms(save, P1398).map((term) => term.label), [
    "사건 강도 45 × 1", "패배측 총애", "승리측 총애", "의심도", "당상관", "공훈의 이름", "처세", "보호",
  ]);
  assert.equal(purgeRisk(FIXTURE, save, { ...P1398, intensity: 200 }), 95);
  assert.equal(purgeRisk(FIXTURE, save, { ...P1398, intensity: -200 }), 5);
});

test("preview applies the option's effects to a clone only", () => {
  const save = newSave();
  save.favor = {};
  save.stats.tact = 5;
  const before = JSON.stringify(save);
  assert.equal(purgeRisk(FIXTURE, save, P1453), 31, "0.6·60 − 5");
  assert.equal(purgeRisk(FIXTURE, save, P1453, [{ k: "align", faction: "suyang" }, { k: "favor", faction: "suyang", add: 25 }]), 6, "0.3·60 − 7.5 − 5 = 5.5");
  assert.equal(purgeRisk(FIXTURE, save, P1453, [{ k: "align", faction: "kimjongseo" }, { k: "suspicion", add: 15 }]), 59);
  assert.equal(JSON.stringify(save), before, "the real save is untouched");
});

/** R printed on the 숙청 판정 line of a resolution. */
function rolledRisk(lines: readonly { text: string }[]): number | undefined {
  const match = lines.map((entry) => /^숙청 판정 — 위험 (\d+)/.exec(entry.text)).find(Boolean);
  return match ? Number(match[1]) : undefined;
}

test("preview equals the R the purge rolls, even when the verdict lowers the rank", () => {
  // 당상관 (+10) until the verdict demotes: the preview must not apply its own verdict.
  for (const margin of [5, 20, 40]) {
    const save = plainSave();
    save.rank = 14;
    const { id, roll } = idWithRoll(save, 10, 40);
    // Neutral plain save at rank 14: R = 0.6·E − 1 + 10.
    const spec: PurgeSpec = { id, intensity: (roll + margin - 9) / 0.6, winner: null, loser: null };
    const option: Effect[] = [{ k: "suspicion", add: 8 }, { k: "purge", spec }, { k: "rank", add: -5 }];
    const preview = purgeRisk(FIXTURE, save, spec, option);
    const real = JSON.parse(JSON.stringify(save)) as PlayerSave;
    const out = applyEffects(FIXTURE, real, option);
    assert.notEqual(real.flags[`purge:${id}`], "survived", `margin ${margin}`);
    assert.equal(preview, rolledRisk(out.lines), `margin ${margin}: 풍향계 = 숙청 판정 line`);
    assert.equal(preview, roll + margin + 2, `margin ${margin}: includes the suspicion before the purge, not the rank after`);
  }
});

test("preview walks a guarding check on the side that reaches the purge, without its roll", () => {
  const spec: PurgeSpec = { id: "guarded", intensity: 50, winner: null, loser: null };
  const option: Effect[] = [
    {
      k: "check", id: "guard_check", label: "연판장", base: 50,
      success: [{ k: "point", point: "honor", add: 10 }],
      failure: [{ k: "suspicion", add: 20 }, { k: "purge", spec }],
    },
  ];
  const outcomes = new Set<boolean>();
  for (let seed = 1; seed < 60; seed++) {
    const save = plainSave();
    save.seed = seed;
    const preview = purgeRisk(FIXTURE, save, spec, option);
    assert.equal(preview, 34, `seed ${seed}: 0.6·50 − 1 + 0.25·20, the same whether the check passes or fails`);
    const real = JSON.parse(JSON.stringify(save)) as PlayerSave;
    const out = applyEffects(FIXTURE, real, option);
    const failed = real.flags["check:guard_check"] === false;
    outcomes.add(failed);
    if (failed) assert.equal(rolledRisk(out.lines), preview, `seed ${seed}`);
    else assert.equal(rolledRisk(out.lines), undefined, `seed ${seed}: no purge on success`);
  }
  assert.equal(outcomes.size, 2, "both check outcomes were exercised");
});

test("every shipped purge option: the 풍향계 equals the R its purge rolls; a neutral one rolls at side 0.6", () => {
  let compared = 0;
  let neutral = 0;
  for (const chapter of CHAPTER_IDS) {
    for (const prompt of CONTENT.chapters[chapter].prompts) {
      for (const option of prompt.options) {
        if (!option.risk) continue;
        for (let seed = 1; seed <= 12; seed++) {
          const save = createSave(CONTENT, { token: "t", name: "강휘", variant: "m", origin: "northeast", seed, demoChapter: chapter });
          save.stats.wit = 30;
          // Every third seed carries a stale alignment with the loser from an earlier card of the chapter.
          if (seed % 3 === 0) save.aligned = option.risk.loser;
          if (option.risk.neutral) {
            // Standing aside rolls at 0.6 whatever is aligned; with the stale loser alignment, only that rule keeps it off 1.0.
            assert.equal(purgeSide(save, option.risk), 0.6, `${prompt.id}/${option.id} seed ${seed}: neutral side`);
            if (option.risk.loser && save.aligned === option.risk.loser)
              assert.equal(purgeSide(save, { ...option.risk, neutral: false }), 1.0, `${prompt.id}/${option.id}: the loser's side without the rule`);
            neutral++;
          }
          const shown = purgeRiskShown(CONTENT, save, option.risk, option.effects);
          const real = JSON.parse(JSON.stringify(save)) as PlayerSave;
          const rolled = rolledRisk(applyEffects(CONTENT, real, option.effects).lines);
          if (rolled === undefined) continue;
          assert.deepEqual(shown, { value: rolled, exact: true }, `${prompt.id}/${option.id} seed ${seed}`);
          compared++;
        }
      }
    }
  }
  assert.ok(compared > 300, `compared ${compared} rolls`);
  assert.ok(neutral >= 24, `checked ${neutral} neutral stances`);
});

/** Purge ids reachable from an effect list (through checks and ifs). */
function purgesIn(effects: readonly Effect[]): string[] {
  return effects.flatMap((effect) =>
    effect.k === "purge" ? [effect.spec.id]
      : effect.k === "check" ? [...purgesIn(effect.success), ...purgesIn(effect.failure)]
        : effect.k === "if" ? [...purgesIn(effect.then), ...purgesIn(effect.else ?? [])]
          : []);
}

/** Flags a condition reads. */
function condFlags(cond: Cond | undefined): string[] {
  if (!cond) return [];
  if (cond.k === "flag") return [cond.flag];
  if (cond.k === "all" || cond.k === "any") return cond.of.flatMap(condFlags);
  if (cond.k === "not") return condFlags(cond.of);
  return [];
}

/** Flags read by `if` conditions anywhere in an effect list. */
function flagsRead(effects: readonly Effect[]): string[] {
  return effects.flatMap((effect) =>
    effect.k === "if" ? [...condFlags(effect.cond), ...flagsRead(effect.then), ...flagsRead(effect.else ?? [])]
      : effect.k === "check" ? [...flagsRead(effect.success), ...flagsRead(effect.failure)]
        : []);
}

test("shipped content keeps to the shapes the 풍향계 preview is exact for", () => {
  let guarded = 0;
  for (const chapter of CHAPTER_IDS) {
    const def = CONTENT.chapters[chapter];
    const lists: [string, readonly Effect[]][] = [
      ...def.prompts.flatMap((prompt) => prompt.options.map((option): [string, readonly Effect[]] => [`${prompt.id}/${option.id}`, option.effects])),
      ...def.battles.flatMap((battle): [string, readonly Effect[]][] => [[`${battle.id}:victory`, battle.victory], [`${battle.id}:defeat`, battle.defeat]]),
      ...def.steps.flatMap((step) => [
        [`${step.id}:enter`, step.onEnter ?? []] as [string, readonly Effect[]],
        ...step.objectives.map((objective): [string, readonly Effect[]] => [`${step.id}/${objective.id}`, objective.onComplete ?? []]),
      ]),
    ];
    for (const [where, effects] of lists) {
      const visit = (list: readonly Effect[]): void => {
        for (const effect of list) {
          if (effect.k === "check") {
            const both = purgesIn(effect.success).filter((id) => purgesIn(effect.failure).includes(id));
            assert.deepEqual(both, [], `${chapter} ${where}: check ${effect.id} has the same purge on both sides`);
            if (purgesIn([effect]).length > 0) {
              guarded++;
              const checkFlags = flagsRead(effects).filter((flag) => flag.startsWith("check:"));
              assert.deepEqual(checkFlags, [], `${chapter} ${where}: a guarded purge's option reads check flags`);
            }
            visit(effect.success);
            visit(effect.failure);
          } else if (effect.k === "if") {
            visit(effect.then);
            visit(effect.else ?? []);
          }
        }
      };
      visit(effects);
    }
  }
  assert.ok(guarded >= 1, `found ${guarded} guarded purges (ch13 연판장)`);
});

test("풍향계: exact with 지략 ≥ 30, else a stable ±10 blur", () => {
  const save = newSave();
  save.favor = {};
  save.stats.tact = 5;
  const risk = purgeRisk(FIXTURE, save, P1453);
  const blur = (hashRoll(save.seed, "purge_1453:blur") % 21) - 10;
  assert.deepEqual(purgeRiskShown(FIXTURE, save, P1453), { value: Math.max(0, Math.min(100, risk + blur)), exact: false });
  assert.deepEqual(purgeRiskShown(FIXTURE, save, P1453), purgeRiskShown(FIXTURE, save, P1453), "same value on every look");
  save.stats.wit = 30;
  assert.deepEqual(purgeRiskShown(FIXTURE, save, P1453), { value: risk, exact: true });
  let spread = new Set<number>();
  for (let seed = 1; seed < 300; seed++) {
    const other = newSave({ seed });
    spread.add(purgeRiskShown(FIXTURE, other, P1453).value - purgeRisk(FIXTURE, other, P1453));
  }
  spread = new Set([...spread].map((value) => Math.abs(value)));
  assert.ok(Math.max(...spread) <= 10 && spread.size >= 10, "blur spans −10..+10");
});

/** A save whose risk is exactly 0.6·E − 1 (neutral, tact 1, nothing else). */
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

/** Intensity giving a neutral plain save risk exactly R (E·0.6 − 1 = R). */
const intensityFor = (risk: number) => (risk + 1) / 0.6;

test("same purge id gives the same verdict across clones and reloads", () => {
  const verdicts = new Set<string>();
  for (let copy = 0; copy < 5; copy++) {
    const save = JSON.parse(JSON.stringify(newSave())) as PlayerSave;
    applyEffects(FIXTURE, save, [{ k: "purge", spec: P1398 }]);
    verdicts.add(String(save.flags["purge:purge_1398"]));
  }
  assert.equal(verdicts.size, 1);
});

test("roll ≥ R survives and counts", () => {
  const save = plainSave();
  const { id, roll } = idWithRoll(save, 20, 50);
  const out = applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll), winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "survived");
  assert.equal(save.record.purgesSurvived, 1);
  assert.equal(out.escape, false);
  assert.equal(out.lines[0]?.text, `숙청 판정 — 위험 ${roll} · 판정값 ${roll}`);
});

test("margin 0–14 dismisses (rank −3, salary suspended)", () => {
  const save = plainSave();
  save.rank = 10;
  const { id, roll } = idWithRoll(save, 10, 40);
  applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll + 14), winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "dismissed");
  assert.equal(save.rank, 7);
  assert.equal(save.flags["salarySuspended"], true);
});

test("margin 15–34 exiles (rank −5, life −1, exile site)", () => {
  const save = plainSave();
  save.rank = 4;
  const { id, roll } = idWithRoll(save, 10, 40);
  applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll + 15), winner: null, loser: null, exileSite: "geoje" } }]);
  assert.equal(save.flags[`purge:${id}`], "exiled");
  assert.equal(save.rank, 0);
  assert.equal(save.lifeEnd, 1860);
  assert.equal(save.exile, "geoje");
  const fallback = plainSave();
  const pick = idWithRoll(fallback, 10, 40);
  applyEffects(FIXTURE, fallback, [{ k: "purge", spec: { id: pick.id, intensity: intensityFor(pick.roll + 34), winner: null, loser: null } }]);
  assert.equal(fallback.exile, "jeju");
});

test("margin ≥ 35 is a death-sentence crisis: the 사사 위기 card offers flight or a plea", () => {
  const save = plainSave();
  const { id, roll } = idWithRoll(save, 10, 50);
  const out = applyEffects(FIXTURE, save, [{ k: "purge", spec: { id, intensity: intensityFor(roll + 35), winner: null, loser: null } }]);
  assert.equal(save.flags[`purge:${id}`], "sentenced");
  assert.equal(out.escape, true);
  assert.equal(out.lines.at(-1)?.text, "사사의 명 — 담을 넘어 달아날지, 끝까지 결백을 주장할지 정해야 한다");
  assert.doesNotMatch(JSON.stringify([out.lines, save.chronicle]), /추격/, "no chase battle is promised");
});
