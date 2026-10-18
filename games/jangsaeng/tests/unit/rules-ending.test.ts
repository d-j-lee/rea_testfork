// 1910 settlement: score S, nation endings for the GDD's three verification
// plays, infiltration from failed branches, and personal endings.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BranchId } from "../../src/shared/content/schema.ts";
import { BRANCH_IDS } from "../../src/shared/content/schema.ts";
import { applyEffects, computeEnding, ENDING_RULE, finalInfiltration, nationValue } from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";
import { at, FIXTURE, newSave } from "./rules-fixture.ts";

function finalSave(
  nation: readonly [number, number, number, number, number],
  succeeded: readonly BranchId[],
  zeitgeist = 0,
): PlayerSave {
  const save = at(newSave(), "ch16", 1910);
  const [defense, diplomacy, finance, people, reform] = nation;
  save.nation = { defense, diplomacy, finance, people, reform };
  for (const id of BRANCH_IDS) save.branches[id] = succeeded.includes(id);
  if (zeitgeist) save.flags["zeitgeist"] = zeitgeist;
  return save;
}

test("skilled play (GDD): S ≈ 83.7 → N1", () => {
  // Failed: B2, B3, B5 (+10), B9 (+8), B10 (+7) → infiltration 25.
  const save = finalSave([65, 62, 50, 65, 60], ["B1", "B4", "B6", "B7", "B8", "B11", "B12a", "B12b", "B12c"], 3);
  assert.equal(finalInfiltration(save), 25);
  const ending = computeEnding(FIXTURE, save);
  assert.equal(ending.score, 83.7);
  assert.equal(ending.nation, "N1");
  assert.deepEqual(ending.breakdown.map((term) => term.value), [16.3, 12.4, 7.5, 13, 12, 27, -7.5, 3]);
  assert.equal(ending.breakdown[5]?.label, "분기 성공 9개 × 3");
});

test("the rows are settled to 0.1 and the score is their sum, so they agree as shown", () => {
  const shown = (value: number) => value.toFixed(1);
  let checked = 0;
  for (let defense = 0; defense <= 100; defense += 7) {
    for (const finance of [3, 41, 77]) {
      for (const infiltrated of [[], ["B4", "B8"], ["B5", "B6", "B9", "B10", "B12a"]] as BranchId[][]) {
        const won = BRANCH_IDS.filter((id) => !infiltrated.includes(id));
        const save = finalSave([defense, 100 - defense, finance, (defense * 3) % 101, (finance * 7) % 101], won, defense % 6);
        const ending = computeEnding(FIXTURE, save);
        for (const row of ending.breakdown) assert.equal(Math.round(row.value * 10) / 10, row.value, `${row.label}: ${row.value}`);
        const rows = ending.breakdown.reduce((sum, row) => sum + Number(shown(row.value)), 0);
        assert.equal(shown(rows), shown(ending.score), `rows ${ending.breakdown.map((row) => shown(row.value)).join(" + ")} vs ${ending.score}`);
        assert.equal(Math.round(rows * 10) / 10, ending.score, "the score is exactly the sum of the rows");
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `checked ${checked} settlements`);
});

test("each meter row is its exact product rounded half up to 0.1 (재정 57 × 0.15 = 8.55 → 8.6)", () => {
  const rowOf = (save: PlayerSave, prefix: string) => computeEnding(FIXTURE, save).breakdown.find((row) => row.label.startsWith(prefix))?.value;
  assert.equal(rowOf(finalSave([50, 50, 57, 50, 50], []), "재정 57"), 8.6);
  assert.equal(rowOf(finalSave([50, 50, 55, 50, 50], []), "재정 55"), 8.3);
  // Every meter value under every weight, against decimal arithmetic on the product's digits.
  const weights: [string, number][] = [["국방", 25], ["외교", 20], ["재정", 15], ["민심", 20], ["개혁", 20]];
  for (let value = 0; value <= 100; value++) {
    const ending = computeEnding(FIXTURE, finalSave([value, value, value, value, value], []));
    for (const [index, [name, hundredths]] of weights.entries()) {
      const digits = String(value * hundredths).padStart(3, "0");
      const settled = Number(`${digits.slice(0, -2)}.${digits.slice(-2, -1)}`) + (Number(digits.slice(-1)) >= 5 ? 0.1 : 0);
      assert.equal(ending.breakdown[index]?.value, Math.round(settled * 10) / 10, `${name} ${value}`);
    }
  }
});

test("§8.3 N1 boundary: 60/60/45/58/55, 10 branches, infiltration 20, P 2 → S ≈ 82.4, N1", () => {
  // Failed: B1, B2, B3 (no weight) and B8 (+20).
  const save = finalSave([60, 60, 45, 58, 55], ["B4", "B5", "B6", "B7", "B9", "B10", "B11", "B12a", "B12b", "B12c"], 2);
  assert.equal(finalInfiltration(save), 20);
  const ending = computeEnding(FIXTURE, save);
  assert.equal(ending.score, 82.4);
  assert.equal(ending.nation, "N1");
});

test("N1 needs defense ≥ 60, B12b and B12c (§8.2)", () => {
  const withoutB12b: BranchId[] = ["B1", "B4", "B6", "B7", "B8", "B11", "B12a", "B12c", "B9", "B10"];
  assert.equal(computeEnding(FIXTURE, finalSave([90, 90, 90, 90, 90], withoutB12b, 5)).nation, "N2", "B11 alone is not enough");
  const branches: BranchId[] = ["B1", "B4", "B6", "B7", "B8", "B11", "B12a", "B12b", "B12c"];
  assert.equal(computeEnding(FIXTURE, finalSave([59, 62, 50, 65, 60], branches, 3)).nation, "N2");
  assert.equal(computeEnding(FIXTURE, finalSave([65, 62, 50, 65, 60], branches.filter((id) => id !== "B12c"), 3)).nation, "N2");
  const noShield = branches.filter((id) => id !== "B11" && id !== "B12b");
  assert.equal(computeEnding(FIXTURE, finalSave([90, 90, 90, 90, 90], noShield, 5)).nation, "N2");
});

test("average play (GDD): S ≈ 45 → N2 boundary", () => {
  // Succeeded B1, B3 (no weight), B4 (15), B5 (10), B8 (20) → infiltration 55.
  const save = finalSave([45, 45, 35, 50, 45], ["B1", "B3", "B4", "B5", "B8"], 2);
  assert.equal(finalInfiltration(save), 55);
  const ending = computeEnding(FIXTURE, save);
  // 11.25 and 5.25 settle to 11.3 and 5.3: the rows as shown add up to 45.1.
  assert.equal(ending.score, 45.1);
  assert.equal(ending.nation, "N2");
  save.flags["zeitgeist"] = 1;
  assert.equal(computeEnding(FIXTURE, save).nation, "N3", "just below the boundary");
});

test("historical path (GDD): every branch failed → infiltration 100, S ≈ −5 → N3", () => {
  const save = finalSave([15, 20, 15, 40, 35], []);
  assert.equal(finalInfiltration(save), 100);
  const ending = computeEnding(FIXTURE, save);
  // 3.75 and 2.25 settle to 3.8 and 2.3.
  assert.equal(ending.score, -4.9);
  assert.equal(ending.nation, "N3");
  // Unresolved branches count as failed too.
  const untouched = at(newSave(), "ch16", 1910);
  untouched.nation = { defense: 15, diplomacy: 20, finance: 15, people: 40, reform: 35 };
  assert.equal(computeEnding(FIXTURE, untouched).score, -4.9);
});

test("「역사의 길」 (N3) comes from the score and B12b, not from infiltration reaching 100 (ENDING_RULE)", () => {
  assert.deepEqual(
    { n2: ENDING_RULE.n2, infiltration: ENDING_RULE.infiltration, allFailed: ENDING_RULE.allFailed },
    { n2: { score: 45, branch: "B12b" }, infiltration: -0.3, allFailed: 100 },
  );
  // As reviewed: B9 and B12a won, infiltration 85, yet the run settles N3.
  const below = finalSave([20, 25, 20, 35, 35], ["B9", "B12a"]);
  assert.equal(finalInfiltration(below), 85);
  const n3 = computeEnding(FIXTURE, below);
  assert.ok(n3.score < ENDING_RULE.n2.score, `score ${n3.score}`);
  assert.equal(n3.nation, "N3", "below 100: N3 all the same");
  assert.equal(n3.breakdown.find((row) => row.label.startsWith("침투도"))?.value, 85 * ENDING_RULE.infiltration);
  // The same infiltration with the score at the line, or with B12b won: N2.
  const atLine = finalSave([75, 70, 70, 70, 70], ["B9", "B12a"]);
  assert.equal(finalInfiltration(atLine), 85);
  assert.ok(computeEnding(FIXTURE, atLine).score >= ENDING_RULE.n2.score);
  assert.equal(computeEnding(FIXTURE, atLine).nation, "N2");
  assert.equal(computeEnding(FIXTURE, finalSave([20, 25, 20, 35, 35], ["B9", "B12a", ENDING_RULE.n2.branch])).nation, "N2");
});

test("B12b alone guarantees N2; zeitgeist is capped at +5", () => {
  const save = finalSave([10, 10, 10, 10, 10], ["B12b"], 50);
  const ending = computeEnding(FIXTURE, save);
  assert.equal(ending.nation, "N2");
  assert.equal(ending.breakdown.at(-1)?.value, 5);
  assert.equal(finalInfiltration(save), 90);
});

test("branch effects and hand-set branch states settle the same infiltration", () => {
  const direct = finalSave([50, 50, 50, 50, 50], ["B4", "B11"]);
  const played = at(newSave(), "ch16", 1910);
  played.nation = { ...direct.nation };
  applyEffects(FIXTURE, played, BRANCH_IDS.map((id) => ({ k: "branch", id, ok: id === "B4" || id === "B11" }) as const));
  assert.equal(played.infiltration, 70, "failures are stored in the meter as they happen");
  assert.equal(direct.infiltration, 0);
  assert.equal(nationValue(played, "infiltration"), nationValue(direct, "infiltration"));
  assert.equal(finalInfiltration(played), finalInfiltration(direct));
  assert.deepEqual(computeEnding(FIXTURE, played), computeEnding(FIXTURE, direct));
  // Relief (reform/diplomacy effects) lowers the stored meter, never below 0.
  applyEffects(FIXTURE, played, [{ k: "nation", key: "infiltration", add: -15 }]);
  assert.equal(finalInfiltration(played), 55);
});

test("live infiltration shows only failures decided so far", () => {
  const save = at(newSave(), "ch15", 1890);
  save.branches.B4 = false;
  save.branches.B5 = true;
  save.infiltration = 4;
  assert.equal(nationValue(save, "infiltration"), 19);
  assert.equal(finalInfiltration(save), 94, "the remaining open branches count at the settlement");
});

test("personal endings in priority order", () => {
  const personal = (setup: (save: PlayerSave) => void) => {
    const save = finalSave([50, 50, 50, 50, 50], []);
    setup(save);
    return computeEnding(FIXTURE, save).personal;
  };
  assert.equal(personal(() => {}), "P0");
  assert.equal(personal((save) => { save.record.turncoat = 3; save.successor = { generation: 1 }; }), "P5");
  assert.equal(personal((save) => { save.successor = { generation: 1 }; save.rank = 18; save.points.honor = 99; }), "P4");
  assert.equal(personal((save) => { save.rank = 16; save.points.honor = 50; save.suspicion = 69; }), "P1");
  assert.equal(personal((save) => { save.rank = 16; save.points.honor = 50; save.suspicion = 70; }), "P0");
  const sixBonds = { a: 60, b: 70, c: 80, d: 90, han_house: 60, baek_house: 61 };
  assert.equal(personal((save) => { save.bonds = sixBonds; save.flags["school"] = true; save.flags["discipleXp"] = 4; }), "P3");
  assert.equal(personal((save) => { save.bonds = sixBonds; save.flags["school"] = true; save.flags["discipleXp"] = 3; }), "P0", "제자 세대 2");
  assert.equal(personal((save) => { save.bonds = { a: 60, b: 70, c: 80, d: 90, e: 99 }; save.flags["school"] = true; save.flags["discipleXp"] = 9; }), "P0", "five bonds");
  assert.equal(personal((save) => { save.record.washes = 4; save.rank = 6; save.points.virtue = 2500; }), "P2");
  assert.equal(
    personal((save) => { save.record.washes = 4; save.rank = 2; save.points.virtue = 0; save.flags["virtueEarned"] = 2600; }),
    "P2",
    "virtue offered for lifespan still counts as earned",
  );
  assert.equal(personal((save) => { save.record.washes = 4; save.rank = 6; save.points.virtue = 2499; }), "P0");
  assert.equal(personal((save) => { save.record.washes = 4; save.rank = 7; save.points.virtue = 3000; }), "P0");
});
