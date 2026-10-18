// New characters and demo-mode chapter presets.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterDef, ChapterId, OriginDef, OriginId, StatKey, WashMethod } from "../content/schema.ts";
import { CHAPTER_IDS, POINT_KEYS, STAT_KEYS } from "../content/schema.ts";
import type { BodyVariant } from "../sprites.ts";
import { AWAKENING_AGE, AWAKENING_YEAR, BASE_LIFESPAN, SAVE_VERSION, type PlayerSave } from "../types.ts";
import { apparentAge, suggestName } from "./life.ts";
import { meritSubjectTitle } from "./effects.ts";
import { DEFAULT_ARMOR, DEFAULT_WEAPON, LEVEL_CAP, SKILL_SLOTS } from "./progression.ts";
import { FAMILY_BONDS } from "./util.ts";

export interface CreateOptions {
  token: string;
  name: string;
  variant: BodyVariant;
  origin: OriginId;
  seed: number;
  /** Demo mode: start at this chapter with a balanced preset build. */
  demoChapter?: ChapterId;
}

export const BASE_STAT = 5;
export const START_MONEY = 50;
export const START_LIFE_END = AWAKENING_YEAR + BASE_LIFESPAN;
export const DEMO_SUSPICION = 15;
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

export function eraGear(content: ContentIndex, year: number): { weapon: string; armor: string } {
  let gear = { weapon: DEFAULT_WEAPON, armor: DEFAULT_ARMOR };
  for (const entry of content.eraGear) if (year >= entry.from) gear = { weapon: entry.weapon, armor: entry.armor };
  return gear;
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
  if (demo) applyDemoPreset(content, save, demo);
  return save;
}

/** Years of past washes for a demo identity history: every ~120 years, last one 15 years ago. */
function demoWashYears(startYear: number): number[] {
  const years: number[] = [];
  for (let year = startYear - DEMO_LAST_WASH_AGO; year >= 1401; year -= DEMO_WASH_SPACING) years.unshift(year);
  return years;
}

function applyDemoPreset(content: ContentIndex, save: PlayerSave, chapter: ChapterDef): void {
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
  }
  save.lifeEnd = Math.max(START_LIFE_END + 4 * (order - 1), chapter.years[0] + 30);
  save.record.lifeGained = save.lifeEnd - START_LIFE_END;
  save.year = chapter.years[0];
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
  save.suspicion = DEMO_SUSPICION;
  save.chronicle.push({ year: save.year, text: `시연 모드로 「${chapter.title}」에서 시작하다 (${save.year}년).`, tone: "info" });
}
