// New characters and demo-mode chapter presets.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterDef, ChapterId, Effect, FlagValue, NationKey, OriginDef, OriginId, StatKey, WashMethod } from "../content/schema.ts";
import { CHAPTER_IDS, DISCIPLE_XP_FLAG, NATION_KEYS, POINT_KEYS, SCHOOL_FLAG, STAT_KEYS } from "../content/schema.ts";
import type { BodyVariant } from "../sprites.ts";
import { AWAKENING_AGE, AWAKENING_YEAR, BASE_LIFESPAN, DEFAULT_DEMO_PATH, SAVE_VERSION, type DemoPath, type PlayerSave } from "../types.ts";
import { apparentAge, cleanName, suggestName, WASH_METHODS } from "./identity.ts";
import { meritSubjectTitle } from "./effects.ts";
import { chapterBranches, closeChapterBranches, setBranch, setLongFlag } from "./nation.ts";
import { DEFAULT_ARMOR, DEFAULT_WEAPON, eraGear, LEVEL_CAP, SKILL_SLOTS } from "./progression.ts";
import { clamp, FAMILY_BONDS, hashRoll, josa } from "./util.ts";

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
 * Reform demo path: the story flags a well-played run carries out of each
 * chapter for later chapters to read, with the value those reads reward. The
 * other gains of that run come from content itself: every branch an earlier
 * chapter owns is won (nation.ts BRANCH_CHAPTER) and every long flag it offers
 * is held at its best value (bestLongFlags).
 */
const REFORM_STORY_FLAGS: readonly { chapter: ChapterId; flags: Readonly<Record<string, FlagValue>> }[] = [
  // 화통도감에 보탠 재물: ch05 shows the 화차 it grew into.
  { chapter: "ch02", flags: { gunpowder_patron: true } },
  // 살려 보낸 강휘 returns the favour in ch04's 1398 alley.
  { chapter: "ch03", flags: { kanghwi_spared: true } },
  // 사민을 아낀 축성: ch06's 투항 권유 is easier among the old settlers.
  { chapter: "ch05", flags: { samin: "gentle" } },
  // 세손 맹세 opens ch13's oath; 정계비 기록 opens ch16's 1909 간도 option.
  { chapter: "ch12", flags: { ch12_vow_seson: true, ch12_jeonggye_record: true } },
  // 체불 장부 prepares ch15's B5 audit.
  { chapter: "ch14", flags: { ch14_pay_gap_noted: true } },
  // 거중조정 문구 lowers ch16's B12a bar.
  { chapter: "ch15", flags: { ch15_geojung: true } },
];
/** Demo preset rank by chapter order (ch04 = 정3품 당상 2등 공신). */
const DEMO_RANK: readonly number[] = [0, 2, 5, 14, 12, 13, 10, 11, 12, 13, 12, 11, 12, 13, 14, 15];
/** Demo stat spread: a front-line officer who can still argue at court. */
const DEMO_ROLE_ORDER: readonly StatKey[] = [
  "power", "body", "agility", "wit", "tact", "power", "spirit", "body", "agility", "tact", "wit", "power",
];
/** Demo identity history: a wash every 30–40 years, as a played run needs (README: 30~40년마다 신분 세탁). */
const DEMO_WASH_KINDS: readonly WashMethod[] = ["descendant", "exam", "merchant"];
const DEMO_WASH_EVERY = 35;
const DEMO_WASH_JITTER = 3;
/** The shortest history that has a wash: the birth name is kept at least this long. */
const DEMO_WASH_GAP = 30;
const DEMO_LAST_WASH_AGO = 15;
/**
 * Demo record per chapter already lived, beside what content gives (its
 * battles, field spawns and purges): allies raised, the chapter's free
 * self-revive, and 천수 spent on two 노인성 일섬.
 */
const DEMO_RECORD_PER_CHAPTER = { revivesGiven: 4, selfRevives: 1, lifeSpent: 2 } as const;

export function originOf(content: ContentIndex, origin: string): OriginDef {
  return content.origins[origin] ?? (Object.values(content.origins)[0] as OriginDef);
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
  const name = cleanName(options.name) || "무명";
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
    pending: [],
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
  if (demo) applyDemoPreset(content, save, demo, options.demoPath ?? DEFAULT_DEMO_PATH);
  return save;
}

/**
 * Years of past washes for a demo identity history: the last one 15 years
 * before the chapter, the others spread evenly from 1361 about every 35 years
 * and moved up to 4 years either way (stable per save), so the names last
 * 30–40 years over a long history. None before CH04's own 호패법 wash.
 */
function demoWashYears(seed: number, startYear: number): number[] {
  const last = startYear - DEMO_LAST_WASH_AGO;
  const span = last - AWAKENING_YEAR;
  const count = span >= DEMO_WASH_GAP ? Math.round(span / DEMO_WASH_EVERY) : 0;
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) return last;
    const jitter = (hashRoll(seed, `demo:wash:${index}`) % (2 * DEMO_WASH_JITTER + 1)) - DEMO_WASH_JITTER;
    return AWAKENING_YEAR + Math.round((span * (index + 1)) / count) + jitter;
  });
}

/** The kind of the `index`-th demo wash in `year`: 후손 행세, 무과 재응시 (once there is a 무과), 상인 행세 in turn. */
function demoWashKind(index: number, year: number): WashMethod {
  const kind = DEMO_WASH_KINDS[index % DEMO_WASH_KINDS.length] as WashMethod;
  const from = WASH_METHODS[kind].minYear;
  return from !== undefined && year < from ? "descendant" : kind;
}

/** Every effect a chapter's story can run: on entering a step, completing an objective, answering a card or winning a battle. */
function* chapterEffects(chapter: ChapterDef): Generator<Effect> {
  function* walk(effects: readonly Effect[]): Generator<Effect> {
    for (const effect of effects) {
      yield effect;
      if (effect.k === "check") {
        yield* walk(effect.success);
        yield* walk(effect.failure);
      } else if (effect.k === "if") {
        yield* walk(effect.then);
        yield* walk(effect.else ?? []);
      }
    }
  }
  for (const step of chapter.steps) {
    yield* walk(step.onEnter ?? []);
    for (const objective of step.objectives) yield* walk(objective.onComplete ?? []);
  }
  for (const prompt of chapter.prompts) for (const option of prompt.options) yield* walk(option.effects);
  for (const battle of chapter.battles) yield* walk(battle.victory);
}

/**
 * The record of the chapters a demo preset has already lived, so its ending
 * reads like a run: the enemies of their battles (counterfactual ones only on
 * the reform path) and their field spawns, their bosses and purges, and per
 * chapter the allies raised, self-revives and 천수 spent (DEMO_RECORD_PER_CHAPTER).
 */
function applyDemoRecord(content: ContentIndex, save: PlayerSave, chapter: ChapterDef, path: DemoPath): void {
  const earlier = CHAPTER_IDS.slice(0, CHAPTER_IDS.indexOf(chapter.id));
  const record = save.record;
  for (const id of earlier) {
    const def = content.chapters[id];
    if (!def) continue;
    for (const battle of def.battles) {
      if (battle.alt && path !== "reform") continue;
      for (const wave of battle.waves) for (const group of wave.enemies) record.kills += group.count;
      if (battle.boss) {
        record.kills += 1;
        record.bossKills += 1;
      }
    }
    for (const spawn of def.spawns) record.kills += spawn.count;
    const purges = new Set<string>();
    for (const effect of chapterEffects(def)) if (effect.k === "purge") purges.add(effect.spec.id);
    record.purgesSurvived += purges.size;
  }
  record.revivesGiven += DEMO_RECORD_PER_CHAPTER.revivesGiven * earlier.length;
  record.selfRevives += DEMO_RECORD_PER_CHAPTER.selfRevives * earlier.length;
  record.lifeSpent += DEMO_RECORD_PER_CHAPTER.lifeSpent * earlier.length;
}

/**
 * The preset is the character at the chapter's start, like any other entry.
 * With ChapterDef.demoStart naming a later step, save.demoEntry tells the
 * session to play the steps before it with its own 건너뛰기 on first entry, so
 * the demo opens there holding exactly what a presenter skipping from the
 * first step would.
 */
function applyDemoPreset(content: ContentIndex, save: PlayerSave, chapter: ChapterDef, path: DemoPath): void {
  const order = chapter.order;
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
  // §3.5: lifespan = chapter start + 60 (never below the natural 1861 track);
  // the years gained cover what the lived chapters spent (applyDemoRecord).
  save.lifeEnd = Math.max(START_LIFE_END + 4 * (order - 1), chapter.years[0] + DEMO_LIFE_AHEAD);
  applyDemoRecord(content, save, chapter, path);
  save.record.lifeGained = save.lifeEnd - START_LIFE_END + save.record.lifeSpent;
  save.year = chapter.years[0];
  save.chapter = chapter.id;
  save.step = 0;
  save.suspicion = DEMO_SUSPICION;
  const entry = chapter.steps.find((step, index) => index > 0 && step.id === chapter.demoStart);
  if (entry) save.demoEntry = entry.id;

  const gear = eraGear(content, save.year);
  save.equipment = gear;
  save.inventory = { [gear.weapon]: 1, [gear.armor]: 1 };
  if (content.items.rice_ball) save.inventory["rice_ball"] = 5;
  if (content.items.herb_tonic) save.inventory["herb_tonic"] = 2;

  save.skills = skillsUnlockedBy(content, chapter.id);
  save.skillSlots = save.skills.slice(-SKILL_SLOTS);
  save.nation = { ...chapter.hist };
  save.infiltration = 0;
  applyEarlierChapters(content, save, chapter, path);
  if (chapter.ruling) save.favor[chapter.ruling] = Math.max(save.favor[chapter.ruling] ?? 0, 20);
  if (order >= 3) for (const family of FAMILY_BONDS) save.bonds[family] = Math.min(48, 4 * order);

  // Plausible identity history: a wash every 30–40 years with suggested names,
  // written to the chronicle as washIdentity writes a played one.
  const washYears = demoWashYears(save.seed, chapter.years[0]);
  const playerName = save.name;
  if (washYears.length > 0) {
    save.name = "";
    save.birthName = suggestName(save, "demo:birth");
    save.identities = [{ name: save.birthName, kind: "birth", from: AWAKENING_YEAR }];
    washYears.forEach((year, index) => {
      const kind = demoWashKind(index, year);
      const last = index === washYears.length - 1;
      const previous = save.identities[save.identities.length - 1];
      if (previous) previous.to = year;
      const alias = last ? playerName : suggestName(save, `demo:${index}`);
      save.chronicle.push({
        year,
        text: `${previous?.name ?? save.birthName}의 이름을 버리고 ${josa(alias, "으로/로")} 살아가다 (${WASH_METHODS[kind].name}).`,
      });
      save.identities.push({ name: alias, kind, from: year });
      save.identity = { kind, startYear: year, startAge: Math.round(apparentAge(year)) };
    });
    save.name = playerName;
    save.record.washes = washYears.length;
  }
  const entryNote = entry ? `, ${entry.year}년 장면부터` : "";
  const pathNote = path === "reform" ? ", 개혁 누적 경로" : "";
  save.chronicle.push({ year: save.year, text: `시연 모드로 「${chapter.title}」에서 시작하다 (${save.year}년${entryNote}${pathNote}).`, tone: "info" });
}

/**
 * The earlier chapters the path assumes. History: every branch they own
 * failed, as it did, so save.infiltration already holds what the ending
 * charges. Reform: every one of them won, with the best carry-over, every
 * long flag at its best value and the story flags later chapters reward.
 */
function applyEarlierChapters(content: ContentIndex, save: PlayerSave, chapter: ChapterDef, path: DemoPath): void {
  const earlier = CHAPTER_IDS.slice(0, CHAPTER_IDS.indexOf(chapter.id));
  if (path !== "reform") {
    for (const id of earlier) closeChapterBranches(save, id);
    return;
  }
  for (const key of NATION_KEYS) save.nation[key] = clamp(chapter.hist[key] + REFORM_DRIFT, 0, 100);
  for (const id of earlier) {
    for (const branch of chapterBranches(id)) setBranch(save, branch, true);
    const def = content.chapters[id];
    if (def) for (const [flag, { key, add }] of bestLongFlags(def)) setLongFlag(save, flag, key, add);
  }
  for (const gain of REFORM_STORY_FLAGS) if (earlier.includes(gain.chapter)) Object.assign(save.flags, gain.flags);
}

/**
 * Every long flag (§5.6.3) the chapter's story can set — on entering a step,
 * completing an objective, answering a card or winning a battle — at the best
 * value it offers (장용영: the petition's +8 over the 외영's +5).
 */
function bestLongFlags(chapter: ChapterDef): Map<string, { key: NationKey; add: number }> {
  const best = new Map<string, { key: NationKey; add: number }>();
  for (const effect of chapterEffects(chapter)) {
    if (effect.k !== "longFlag") continue;
    const known = best.get(effect.flag);
    if (effect.add > 0 && (!known || effect.add > known.add)) best.set(effect.flag, { key: effect.key, add: effect.add });
  }
  return best;
}
