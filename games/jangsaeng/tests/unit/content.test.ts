// Referential integrity of all game content: every id a chapter mentions must
// exist, every objective must be completable, and texts must stay respectful.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS, CONTENT } from "../../src/shared/content/index.ts";
import {
  BRANCH_IDS,
  CHAPTER_IDS,
  NATION_KEYS,
  STAT_KEYS,
  type ChapterDef,
  type Cond,
  type Effect,
} from "../../src/shared/content/schema.ts";
import { SITES } from "../../src/shared/map/geo.ts";
import { CHARACTER_SPRITES, PROP_SPRITES } from "../../src/shared/sprites.ts";

const siteIds = new Set(SITES.map((site) => site.id));
const characterSprites = new Set<string>(CHARACTER_SPRITES);
const spriteKeys = new Set<string>([...CHARACTER_SPRITES, ...PROP_SPRITES]);
const branchIds = new Set<string>(BRANCH_IDS);
const statKeys = new Set<string>(STAT_KEYS);
const nationMeters = new Set<string>([...NATION_KEYS, "infiltration"]);

/** Words that must never appear in player-facing text (ethnic slurs). */
const BANNED = ["쪽바리", "왜놈", "되놈", "오랑캐놈", "양놈", "짱깨", "쪽발이", "왜노"];

function chapterFactionIds(): Set<string> {
  const ids = new Set<string>();
  for (const chapter of Object.values(CHAPTERS)) for (const faction of chapter.factions) ids.add(faction.id);
  return ids;
}
const allFactions = chapterFactionIds();
for (const origin of Object.values(CONTENT.origins))
  for (const faction of Object.keys(origin.favor ?? {})) allFactions.add(faction);

function* walkEffects(effects: readonly Effect[] | undefined): Generator<Effect> {
  for (const effect of effects ?? []) {
    yield effect;
    if (effect.k === "check") {
      yield* walkEffects(effect.success);
      yield* walkEffects(effect.failure);
    }
    if (effect.k === "if") {
      yield* walkEffects(effect.then);
      yield* walkEffects(effect.else);
    }
  }
}

function* walkConds(cond: Cond | undefined): Generator<Cond> {
  if (!cond) return;
  yield cond;
  if (cond.k === "all" || cond.k === "any") for (const inner of cond.of) yield* walkConds(inner);
  if (cond.k === "not") yield* walkConds(cond.of);
}

function checkChapter(chapter: ChapterDef): string[] {
  const problems: string[] = [];
  const where = (what: string) => `${chapter.id}: ${what}`;
  const npcIds = new Set(chapter.npcs.map((npc) => npc.id));
  const promptIds = new Set(chapter.prompts.map((prompt) => prompt.id));
  const battleIds = new Set(chapter.battles.map((battle) => battle.id));
  const stepIds = new Set(chapter.steps.map((step) => step.id));
  const objectiveIds = new Set(chapter.steps.flatMap((step) => step.objectives.map((o) => o.id)));
  const unique = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(where(`duplicate ${label} id ${id}`));
      seen.add(id);
    }
  };
  unique("npc", chapter.npcs.map((npc) => npc.id));
  unique("prompt", chapter.prompts.map((prompt) => prompt.id));
  unique("battle", chapter.battles.map((battle) => battle.id));
  unique("step", chapter.steps.map((step) => step.id));
  unique("objective", [...objectiveIds]);
  if (chapter.steps.length === 0) problems.push(where("no steps"));
  if (!siteIds.has(chapter.start.site)) problems.push(where(`start site ${chapter.start.site}`));
  if (chapter.briefing.length === 0) problems.push(where("empty briefing"));
  if (chapter.history.length === 0) problems.push(where("empty history note"));
  for (const npc of chapter.npcs) {
    if (!siteIds.has(npc.site)) problems.push(where(`npc ${npc.id} site ${npc.site}`));
    if (!characterSprites.has(npc.sprite)) problems.push(where(`npc ${npc.id} sprite ${npc.sprite}`));
    for (const step of [npc.fromStep, npc.untilStep])
      if (step && !stepIds.has(step)) problems.push(where(`npc ${npc.id} step ${step}`));
  }
  for (const spawn of chapter.spawns) {
    if (!siteIds.has(spawn.site)) problems.push(where(`spawn ${spawn.id} site ${spawn.site}`));
    if (!CONTENT.enemies[spawn.enemy]) problems.push(where(`spawn ${spawn.id} enemy ${spawn.enemy}`));
    for (const step of [spawn.fromStep, spawn.untilStep])
      if (step && !stepIds.has(step)) problems.push(where(`spawn ${spawn.id} step ${step}`));
  }
  for (const battle of chapter.battles) {
    if (!siteIds.has(battle.site)) problems.push(where(`battle ${battle.id} site ${battle.site}`));
    for (const wave of battle.waves)
      for (const group of wave.enemies)
        if (!CONTENT.enemies[group.enemy]) problems.push(where(`battle ${battle.id} enemy ${group.enemy}`));
    if (battle.boss && !CONTENT.enemies[battle.boss.enemy])
      problems.push(where(`battle ${battle.id} boss ${battle.boss.enemy}`));
    for (const phase of battle.boss?.phases ?? [])
      if (phase.summon && !CONTENT.enemies[phase.summon.enemy])
        problems.push(where(`battle ${battle.id} summon ${phase.summon.enemy}`));
    if (battle.kind === "boss" && !battle.boss) problems.push(where(`battle ${battle.id} boss kind without boss`));
    if (battle.kind === "defend" && !battle.defend) problems.push(where(`battle ${battle.id} defend without target`));
    if (["survive", "escape", "defend"].includes(battle.kind) && !battle.timeLimit)
      problems.push(where(`battle ${battle.id} ${battle.kind} needs timeLimit`));
    if (battle.defend && !spriteKeys.has(battle.defend.sprite))
      problems.push(where(`battle ${battle.id} defend sprite ${battle.defend.sprite}`));
    for (const ally of battle.allies ?? [])
      if (!characterSprites.has(ally.sprite)) problems.push(where(`battle ${battle.id} ally sprite ${ally.sprite}`));
  }
  const allEffects: Effect[] = [];
  const allConds: Cond[] = [];
  for (const prompt of chapter.prompts) {
    if (prompt.options.length === 0) problems.push(where(`prompt ${prompt.id} has no options`));
    if (prompt.speaker?.sprite && !characterSprites.has(prompt.speaker.sprite))
      problems.push(where(`prompt ${prompt.id} speaker sprite`));
    for (const option of prompt.options) {
      allEffects.push(...walkEffects(option.effects));
      allConds.push(...walkConds(option.requires));
      if (option.risk && !allFactionsOk(option.risk.winner, option.risk.loser))
        problems.push(where(`prompt ${prompt.id} risk factions`));
    }
  }
  for (const battle of chapter.battles) allEffects.push(...walkEffects(battle.victory), ...walkEffects(battle.defeat));
  for (const step of chapter.steps) {
    if (step.year < chapter.years[0] || step.year > chapter.years[1])
      problems.push(where(`step ${step.id} year ${step.year} outside chapter`));
    allEffects.push(...walkEffects(step.onEnter));
    for (const objective of step.objectives) {
      allEffects.push(...walkEffects(objective.onComplete));
      allConds.push(...walkConds(objective.requires));
      const target = objective.target;
      if (objective.site && !siteIds.has(objective.site)) problems.push(where(`objective ${objective.id} site`));
      switch (objective.kind) {
        case "talk":
          if (!target || !npcIds.has(target)) problems.push(where(`objective ${objective.id} talk target ${target}`));
          if (objective.prompt && !promptIds.has(objective.prompt))
            problems.push(where(`objective ${objective.id} prompt ${objective.prompt}`));
          break;
        case "reach":
          if (!target || !siteIds.has(target)) problems.push(where(`objective ${objective.id} reach ${target}`));
          break;
        case "defeat":
          if (!target || !CONTENT.enemies[target]) problems.push(where(`objective ${objective.id} defeat ${target}`));
          break;
        case "battle":
          if (!target || !battleIds.has(target)) problems.push(where(`objective ${objective.id} battle ${target}`));
          break;
        case "prompt":
          if (!target || !promptIds.has(target)) problems.push(where(`objective ${objective.id} prompt ${target}`));
          break;
        case "collect":
          if (!target || !CONTENT.items[target]) problems.push(where(`objective ${objective.id} item ${target}`));
          break;
        case "auto":
          break;
      }
    }
  }
  for (const effect of allEffects) {
    switch (effect.k) {
      case "prompt":
        if (!promptIds.has(effect.prompt)) problems.push(where(`effect prompt ${effect.prompt}`));
        break;
      case "battle":
        if (!battleIds.has(effect.battle)) problems.push(where(`effect battle ${effect.battle}`));
        break;
      case "objective":
        if (!objectiveIds.has(effect.objective)) problems.push(where(`effect objective ${effect.objective}`));
        break;
      case "goto":
      case "exile":
        if (!siteIds.has(effect.site)) problems.push(where(`effect ${effect.k} site ${effect.site}`));
        break;
      case "item":
        if (!CONTENT.items[effect.item]) problems.push(where(`effect item ${effect.item}`));
        break;
      case "skill":
        if (!CONTENT.skills[effect.skill]) problems.push(where(`effect skill ${effect.skill}`));
        break;
      case "branch":
        if (!branchIds.has(effect.id)) problems.push(where(`effect branch ${effect.id}`));
        break;
      case "favor":
      case "align":
        if (effect.faction !== null && !allFactions.has(effect.faction))
          problems.push(where(`effect ${effect.k} faction ${effect.faction}`));
        break;
      case "stat":
        if (!statKeys.has(effect.stat)) problems.push(where(`effect stat ${effect.stat}`));
        break;
      case "nation":
        if (!nationMeters.has(effect.key)) problems.push(where(`effect nation ${effect.key}`));
        break;
      case "purge":
        if (!allFactionsOk(effect.spec.winner, effect.spec.loser)) problems.push(where(`purge factions`));
        if (effect.spec.exileSite && !siteIds.has(effect.spec.exileSite)) problems.push(where(`purge exile site`));
        break;
      default:
        break;
    }
  }
  for (const cond of allConds) {
    if (cond.k === "favor" && !allFactions.has(cond.faction)) problems.push(where(`cond faction ${cond.faction}`));
    if (cond.k === "battleWon" && !Object.values(CHAPTERS).some((c) => c.battles.some((b) => b.id === cond.battle)))
      problems.push(where(`cond battle ${cond.battle}`));
    if (cond.k === "item" && !CONTENT.items[cond.item]) problems.push(where(`cond item ${cond.item}`));
  }
  for (const skill of chapter.unlocks ?? [])
    if (!CONTENT.skills[skill]) problems.push(where(`unlock skill ${skill}`));
  const texts = JSON.stringify(chapter);
  for (const word of BANNED) if (texts.includes(word)) problems.push(where(`banned word ${word}`));
  return problems;
}

function allFactionsOk(...ids: (string | null)[]): boolean {
  return ids.every((id) => id === null || allFactions.has(id));
}

test("chapters are ordered and cover 1361–1910", () => {
  const chapters = CHAPTER_IDS.map((id) => CHAPTERS[id]);
  chapters.forEach((chapter, index) => assert.equal(chapter.order, index + 1, chapter.id));
  for (let i = 1; i < chapters.length; i++) {
    const previous = chapters[i - 1] as ChapterDef;
    const current = chapters[i] as ChapterDef;
    assert.ok(current.years[0] >= previous.years[1], `${current.id} starts before ${previous.id} ends`);
  }
});

for (const id of CHAPTER_IDS) {
  test(`chapter ${id} references resolve`, () => {
    const problems = checkChapter(CHAPTERS[id]);
    assert.deepEqual(problems, []);
  });
}

test("enemy and skill tables are well-formed", () => {
  for (const enemy of Object.values(CONTENT.enemies)) {
    assert.ok(characterSprites.has(enemy.sprite), enemy.id);
    assert.ok(enemy.hp > 0 && enemy.speed > 0 && enemy.range > 0, enemy.id);
    for (const word of BANNED) assert.ok(!enemy.name.includes(word), enemy.id);
  }
  for (const skill of Object.values(CONTENT.skills)) assert.ok(CHAPTER_IDS.includes(skill.unlock), skill.id);
});

test("companions and endings exist", () => {
  assert.ok(CONTENT.companions.personas.length >= 12, "need at least 12 companion personas");
  for (const persona of CONTENT.companions.personas) assert.ok(characterSprites.has(persona.sprite), persona.name);
  const lines = CONTENT.companions.lines;
  for (const key of ["greet", "battle", "victory", "revive", "downed", "idle"] as const)
    assert.ok(lines[key].length >= 4, `companion lines ${key}`);
  for (const id of ["N1", "N2", "N3"] as const) assert.ok(CONTENT.endings.nation[id].body.length > 0, id);
  for (const id of ["P0", "P1", "P2", "P3", "P4", "P5"] as const)
    assert.ok(CONTENT.endings.personal[id].body.length > 0, id);
  assert.ok(CONTENT.endings.historyNote.length > 0);
});
