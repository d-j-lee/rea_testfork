// New characters and demo-mode chapter presets.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterDef, ChapterId, Effect, NationKey, ObjectiveDef, OriginDef, OriginId, StatKey, WashMethod } from "../content/schema.ts";
import { CHAPTER_IDS, DISCIPLE_XP_FLAG, NATION_KEYS, POINT_KEYS, SCHOOL_FLAG, STAT_KEYS } from "../content/schema.ts";
import type { BodyVariant } from "../sprites.ts";
import { AWAKENING_AGE, AWAKENING_YEAR, BASE_LIFESPAN, SAVE_VERSION, type DemoPath, type PlayerSave } from "../types.ts";
import { apparentAge, suggestName } from "./identity.ts";
import { applyEffects, battleResult, evalCond, meritSubjectTitle, type EffectOutcome } from "./effects.ts";
import { chapterBranches, closeChapterBranches, setBranch, setLongFlag } from "./nation.ts";
import { DEFAULT_ARMOR, DEFAULT_WEAPON, eraGear, LEVEL_CAP, SKILL_SLOTS } from "./progression.ts";
import { clamp, FAMILY_BONDS } from "./util.ts";

export interface CreateOptions {
  token: string;
  name: string;
  variant: BodyVariant;
  origin: OriginId;
  seed: number;
  /** Demo mode: start at this chapter with a balanced preset build. */
  demoChapter?: ChapterId;
  /** Demo mode: the history the preset assumes (default history). */
  demoPath?: DemoPath;
}

export const BASE_STAT = 5;
export const START_MONEY = 50;
export const START_LIFE_END = AWAKENING_YEAR + BASE_LIFESPAN;
export const DEMO_SUSPICION = 15;
export const DEMO_LIFE_AHEAD = 60;
/** Reform path: the largest carry-over a chapter can pass on (0.8 × the ±20 drift cap, §5.6.2). */
export const REFORM_DRIFT = 16;

/**
 * What a well-played run holds besides its won branches by the end of each
 * chapter (reform demo path): long flags (§5.6.3) and the story flags later
 * chapters read. Every branch an earlier chapter owns counts as won
 * (nation.ts BRANCH_CHAPTER).
 */
const REFORM_GAINS: readonly {
  chapter: ChapterId;
  longFlags?: readonly (readonly [flag: string, key: NationKey, add: number])[];
  flags?: readonly string[];
}[] = [
  { chapter: "ch09", longFlags: [["hullyeon_dogam", "defense", 3]] },
  { chapter: "ch11", longFlags: [["sokhwan", "people", 2]] },
  // 세손 맹세 opens ch13's oath; 정계비 기록 opens ch16's 1909 간도 option.
  { chapter: "ch12", longFlags: [["jeonggye_record", "diplomacy", 1]], flags: ["ch12_vow_seson", "ch12_jeonggye_record"] },
  { chapter: "ch13", longFlags: [["jangyongyeong", "defense", 8], ["samjeong", "finance", 3]] },
  // 체불 장부 prepares ch15's B5 audit.
  { chapter: "ch14", longFlags: [["b4_clauses", "finance", 3]], flags: ["ch14_pay_gap_noted"] },
  { chapter: "ch15", longFlags: [["neutral_policy", "diplomacy", 3]], flags: ["ch15_geojung"] },
];
/** Demo preset rank by chapter order (ch04 = 정3품 당상 2등 공신). */
const DEMO_RANK: readonly number[] = [0, 2, 5, 14, 12, 13, 10, 11, 12, 13, 12, 11, 12, 13, 14, 15];
/** Demo stat spread: a front-line officer who can still argue at court. */
const DEMO_ROLE_ORDER: readonly StatKey[] = [
  "power", "body", "agility", "wit", "tact", "power", "spirit", "body", "agility", "tact", "wit", "power",
];
const DEMO_WASH_KINDS: readonly WashMethod[] = ["descendant", "exam"];
const DEMO_WASH_SPACING = 120;
const DEMO_LAST_WASH_AGO = 15;

export function originOf(content: ContentIndex, origin: string): OriginDef {
  return content.origins[origin] ?? (Object.values(content.origins)[0] as OriginDef);
}

function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16) || "무명";
}

/** Skills unlocked by chapters up to and including `chapter`, in unlock order. */
export function skillsUnlockedBy(content: ContentIndex, chapter: ChapterId): string[] {
  const limit = content.chapters[chapter]?.order ?? 1;
  const ids: string[] = [];
  const add = (id: string) => {
    if (content.skills[id] && !ids.includes(id)) ids.push(id);
  };
  for (const id of CHAPTER_IDS) {
    const def = content.chapters[id];
    if (!def || def.order > limit) continue;
    for (const skill of def.unlocks ?? []) add(skill);
    for (const skill of Object.values(content.skills)) if (skill.unlock === id) add(skill.id);
  }
  return ids;
}

export function createSave(content: ContentIndex, options: CreateOptions): PlayerSave {
  const origin = originOf(content, options.origin);
  const name = cleanName(options.name);
  const stats = {} as Record<StatKey, number>;
  for (const stat of STAT_KEYS) stats[stat] = BASE_STAT + (origin.stats[stat] ?? 0);
  const points = {} as PlayerSave["points"];
  for (const point of POINT_KEYS) points[point] = (origin.points?.[point] ?? 0) + (point === "money" ? START_MONEY : 0);
  const first = content.chapters.ch01;
  const skills = skillsUnlockedBy(content, "ch01");
  const save: PlayerSave = {
    version: SAVE_VERSION,
    token: options.token,
    seed: options.seed >>> 0,
    demo: false,
    birthName: name,
    name,
    variant: options.variant === "f" ? "f" : "m",
    origin: origin.id,
    identity: { kind: "birth", startYear: AWAKENING_YEAR, startAge: AWAKENING_AGE },
    identities: [{ name, kind: "birth", from: AWAKENING_YEAR }],
    level: 1,
    exp: 0,
    stats,
    freePoints: 0,
    points,
    lifeEnd: START_LIFE_END,
    graceUsed: false,
    longevityUses: 0,
    offeredThisChapter: 0,
    suspicion: 0,
    rank: 0,
    titles: [],
    favor: { ...(origin.favor ?? {}) },
    aligned: null,
    nation: { ...first.hist },
    infiltration: 0,
    longFlags: {},
    branches: {},
    flags: {},
    bonds: {},
    inventory: { [DEFAULT_WEAPON]: 1, [DEFAULT_ARMOR]: 1, rice_ball: 3 },
    equipment: { weapon: DEFAULT_WEAPON, armor: DEFAULT_ARMOR },
    skills,
    skillSlots: skills.slice(0, SKILL_SLOTS),
    chapter: "ch01",
    step: 0,
    year: first.years[0],
    objectives: {},
    promptsDone: [],
    battlesWon: [],
    chronicle: [{ year: AWAKENING_YEAR, text: "노인성 아래에서 깨어나다. 오백 년의 천수가 시작되었다.", tone: "epic" }],
    record: {
      kills: 0, bossKills: 0, selfRevives: 0, revivesGiven: 0, washes: 0,
      purgesSurvived: 0, turncoat: 0, lifeGained: 0, lifeSpent: 0,
    },
  };
  if (!content.items.rice_ball) delete save.inventory["rice_ball"];
  const demo = options.demoChapter ? content.chapters[options.demoChapter] : undefined;
  if (demo) applyDemoPreset(content, save, demo, options.demoPath ?? "history");
  return save;
}

/** Years of past washes for a demo identity history: every ~120 years, last one 15 years ago. */
function demoWashYears(startYear: number): number[] {
  const years: number[] = [];
  for (let year = startYear - DEMO_LAST_WASH_AGO; year >= 1401; year -= DEMO_WASH_SPACING) years.unshift(year);
  return years;
}

/** Index of the step a demo of this chapter starts at (ChapterDef.demoStart, else the first). */
export function demoStartIndex(chapter: ChapterDef): number {
  if (chapter.demoStart === undefined) return 0;
  return Math.max(0, chapter.steps.findIndex((step) => step.id === chapter.demoStart));
}

function applyDemoPreset(content: ContentIndex, save: PlayerSave, chapter: ChapterDef, path: DemoPath): void {
  const order = chapter.order;
  const entry = demoStartIndex(chapter);
  const level = Math.max(1, Math.min(LEVEL_CAP, chapter.level[0]));
  save.demo = true;
  save.level = level;
  for (let index = 0; index < 2 * (level - 1); index++) {
    const stat = DEMO_ROLE_ORDER[index % DEMO_ROLE_ORDER.length] as StatKey;
    save.stats[stat] += 1;
  }
  save.rank = DEMO_RANK[order - 1] ?? 12;
  save.points.money += 150 * order - START_MONEY;
  save.points.merit += 25 * save.rank;
  save.points.virtue += 60 * order;
  save.points.fame += Math.min(45, 3 * order);
  save.points.honor += 3 * order;
  save.flags["virtueEarned"] = save.points.virtue;
  if (chapter.id === "ch04") {
    save.meritSubject = 2;
    save.titles.push(meritSubjectTitle(2));
    save.flags["renowned"] = true;
  }
  // 역사 순응 defaults: the ch04 tutorial wash and school are behind a later preset.
  if (order > 4) {
    save.flags["tutorialWashUsed"] = true;
    save.flags[SCHOOL_FLAG] = true;
    save.flags[DISCIPLE_XP_FLAG] = Math.floor((order - 4) / 3);
  }
  // §3.5: lifespan = chapter start + 60 (never below the natural 1861 track).
  save.lifeEnd = Math.max(START_LIFE_END + 4 * (order - 1), chapter.years[0] + DEMO_LIFE_AHEAD);
  save.record.lifeGained = save.lifeEnd - START_LIFE_END;
  save.year = entry > 0 ? (chapter.steps[entry]?.year ?? chapter.years[0]) : chapter.years[0];
  save.chapter = chapter.id;
  save.step = 0;

  const gear = eraGear(content, save.year);
  save.equipment = gear;
  save.inventory = { [gear.weapon]: 1, [gear.armor]: 1 };
  if (content.items.rice_ball) save.inventory["rice_ball"] = 5;
  if (content.items.herb_tonic) save.inventory["herb_tonic"] = 2;

  save.skills = skillsUnlockedBy(content, chapter.id);
  save.skillSlots = save.skills.slice(-SKILL_SLOTS);
  save.nation = { ...chapter.hist };
  save.infiltration = 0;
  applyEarlierChapters(save, chapter, path);
  if (chapter.ruling) save.favor[chapter.ruling] = Math.max(save.favor[chapter.ruling] ?? 0, 20);
  if (order >= 3) for (const family of FAMILY_BONDS) save.bonds[family] = Math.min(48, 4 * order);

  // Plausible identity history: one wash per ~120 years with suggested names.
  const washYears = demoWashYears(chapter.years[0]);
  const playerName = save.name;
  if (washYears.length > 0) {
    save.name = "";
    save.birthName = suggestName(save, "demo:birth");
    save.identities = [{ name: save.birthName, kind: "birth", from: AWAKENING_YEAR }];
    washYears.forEach((year, index) => {
      const kind = DEMO_WASH_KINDS[index % DEMO_WASH_KINDS.length] as WashMethod;
      const last = index === washYears.length - 1;
      const previous = save.identities[save.identities.length - 1];
      if (previous) previous.to = year;
      const alias = last ? playerName : suggestName(save, `demo:${index}`);
      save.chronicle.push({ year, text: `${previous?.name ?? save.birthName}의 이름을 버리고 ${alias}(으)로 살아가다.` });
      save.identities.push({ name: alias, kind, from: year });
      save.identity = { kind, startYear: year, startAge: Math.round(apparentAge(year)) };
    });
    save.name = playerName;
    save.record.washes = washYears.length;
  }
  playSkippedSteps(content, save, chapter, entry);
  save.suspicion = DEMO_SUSPICION;
  const pathNote = path === "reform" ? ", 개혁 누적 경로" : "";
  save.chronicle.push({ year: save.year, text: `시연 모드로 「${chapter.title}」에서 시작하다 (${save.year}년${pathNote}).`, tone: "info" });
}

/**
 * The earlier chapters the path assumes. History: every branch they own
 * failed, as it did, so save.infiltration already holds what the ending
 * charges. Reform: every one of them won, with the best carry-over and the
 * long and story flags a well-played run holds.
 */
function applyEarlierChapters(save: PlayerSave, chapter: ChapterDef, path: DemoPath): void {
  const earlier = CHAPTER_IDS.slice(0, CHAPTER_IDS.indexOf(chapter.id));
  if (path !== "reform") {
    for (const id of earlier) closeChapterBranches(save, id);
    return;
  }
  for (const key of NATION_KEYS) save.nation[key] = clamp(chapter.hist[key] + REFORM_DRIFT, 0, 100);
  for (const id of earlier) for (const branch of chapterBranches(id)) setBranch(save, branch, true);
  for (const gain of REFORM_GAINS) {
    if (!earlier.includes(gain.chapter)) continue;
    for (const [flag, key, add] of gain.longFlags ?? []) setLongFlag(save, flag, key, add);
    for (const flag of gain.flags ?? []) save.flags[flag] = true;
  }
}

/** Upper bound on objectives resolved per skipped step (guards malformed content). */
const SKIP_STEP_BUDGET = 64;

/**
 * Plays the steps before ChapterDef.demoStart the way 건너뛰기 resolves them:
 * every visible required objective in order, the first enabled option of each
 * card it opens, every battle won. The save keeps what that skip run leaves
 * behind (branches, nation, flags, chronicle); the cards are never shown. A
 * death-sentence crisis is not played here: the session owns that card.
 */
function playSkippedSteps(content: ContentIndex, save: PlayerSave, chapter: ChapterDef, entry: number): void {
  if (entry === 0) return;
  const entryYear = save.year;
  const objectivesOf = (step: number): readonly ObjectiveDef[] => chapter.steps[step]?.objectives ?? [];
  const done = (objective: ObjectiveDef): boolean => (save.objectives[objective.id] ?? 0) >= (objective.count ?? 1);
  const visible = (step: number): ObjectiveDef[] =>
    objectivesOf(step).filter((objective) => evalCond(content, save, objective.requires));

  const follow = (step: number, out: EffectOutcome): void => {
    for (const id of out.objectives) complete(step, id);
    for (const id of out.prompts) choose(step, id);
    for (const id of out.battles) win(step, id);
  };
  const run = (step: number, effects: readonly Effect[]): void => {
    if (effects.length > 0) follow(step, applyEffects(content, save, effects));
  };
  const complete = (step: number, id: string): void => {
    const objective = objectivesOf(step).find((candidate) => candidate.id === id);
    if (!objective || done(objective)) return;
    save.objectives[id] = objective.count ?? 1;
    run(step, objective.onComplete ?? []);
  };
  const opening = new Set<string>();
  const choose = (step: number, promptId: string): void => {
    const prompt = chapter.prompts.find((candidate) => candidate.id === promptId);
    const option = prompt?.options.find((candidate) => evalCond(content, save, candidate.requires));
    // A card that reopens itself (malformed content) is resolved once per chain.
    if (!prompt || !option || opening.has(prompt.id)) return;
    if (!save.promptsDone.includes(prompt.id)) save.promptsDone.push(prompt.id);
    opening.add(prompt.id);
    run(step, option.effects);
    opening.delete(prompt.id);
  };
  const win = (step: number, battleId: string): void => {
    const battle = chapter.battles.find((candidate) => candidate.id === battleId);
    if (!battle) return;
    follow(step, battleResult(content, save, battle, true));
    for (const objective of visible(step))
      if (objective.kind === "battle" && objective.target === battleId) complete(step, objective.id);
  };

  for (let step = 0; step < entry; step++) {
    const def = chapter.steps[step];
    if (!def) break;
    save.step = step;
    save.year = def.year;
    save.objectives = {};
    run(step, def.onEnter ?? []);
    for (let budget = SKIP_STEP_BUDGET; budget > 0; budget--) {
      const next = visible(step).find((objective) => !objective.optional && !done(objective));
      if (!next) break;
      const prompt = next.kind === "talk" ? next.prompt : next.kind === "prompt" ? next.target : undefined;
      if (prompt) choose(step, prompt);
      else if (next.kind === "battle" && next.target) win(step, next.target);
      complete(step, next.id);
    }
  }
  save.step = entry;
  save.year = entryYear;
  save.objectives = {};
}
