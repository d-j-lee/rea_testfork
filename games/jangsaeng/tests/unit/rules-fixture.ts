// Test fixture for the rules engine: a ContentIndex whose chapters are small
// hand-built ChapterDefs (years, levels and baselines from the GDD), so rules
// tests never depend on the evolving chapter content.
import { CONTENT, type ContentIndex } from "../../src/shared/content/index.ts";
import type { BattleDef, ChapterDef, ChapterId, FactionDef, NationKey } from "../../src/shared/content/schema.ts";
import { createSave, type CreateOptions } from "../../src/shared/rules/index.ts";
import type { PlayerSave } from "../../src/shared/types.ts";

type Hist = Readonly<Record<NationKey, number>>;

const hist = (defense: number, finance: number, people: number, diplomacy: number, reform: number): Hist => ({
  defense, finance, people, diplomacy, reform,
});

export const HWANGSAN: BattleDef = {
  id: "hwangsan",
  title: "황산대첩",
  site: "hwangsan",
  radius: 12,
  kind: "boss",
  waves: [],
  great: true,
  victory: [{ k: "point", point: "merit", add: 50 }],
  defeat: [{ k: "life", add: -1 }],
};

interface Spec {
  id: ChapterId;
  years: readonly [number, number];
  level: readonly [number, number];
  hist: Hist;
  factions?: readonly FactionDef[];
  ruling?: string;
  battles?: readonly BattleDef[];
  unlocks?: readonly string[];
}

const goryeo: FactionDef = { id: "court_goryeo", name: "고려 조정", power: 60 };
const yi: FactionDef = { id: "yi", name: "이성계파", power: 40 };
const choe: FactionDef = { id: "choe", name: "최영파", power: 60 };

/** Years, levels and §5.6.2 baselines; courts and factions from §5.5.2. */
const SPECS: readonly Spec[] = [
  { id: "ch01", years: [1361, 1364], level: [1, 5], hist: hist(40, 35, 35, 40, 25), factions: [goryeo, yi, choe], ruling: "court_goryeo" },
  {
    id: "ch02", years: [1365, 1387], level: [5, 10], hist: hist(42, 33, 33, 38, 30),
    factions: [goryeo, yi, choe], ruling: "court_goryeo", battles: [HWANGSAN],
  },
  {
    id: "ch03", years: [1388, 1392], level: [10, 14], hist: hist(45, 30, 30, 35, 35),
    factions: [goryeo, yi, choe, { id: "radical", name: "역성혁명파", power: 50 }], ruling: "court_goryeo",
  },
  {
    id: "ch04", years: [1393, 1418], level: [14, 16], hist: hist(50, 40, 40, 40, 45),
    factions: [
      { id: "court_ch04", name: "태조·태종 조정", power: 70, lineage: "court_goryeo" },
      { id: "jeongdojeon", name: "정도전계", power: 50, lineage: "radical" },
      { id: "bangwon", name: "이방원계", power: 50, lineage: "yi" },
    ],
    ruling: "court_ch04",
  },
  {
    id: "ch05", years: [1419, 1452], level: [16, 19], hist: hist(55, 50, 50, 50, 55),
    factions: [{ id: "court_ch05", name: "세종 조정", power: 80, lineage: "court_ch04" }], ruling: "court_ch05",
  },
  { id: "ch06", years: [1453, 1468], level: [19, 21], hist: hist(50, 50, 45, 50, 50), ruling: "court_ch06" },
  { id: "ch07", years: [1469, 1574], level: [21, 23], hist: hist(45, 50, 45, 50, 45), ruling: "court_ch07" },
  { id: "ch08", years: [1575, 1591], level: [23, 25], hist: hist(35, 40, 40, 45, 40), ruling: "court_seonjo" },
  { id: "ch09", years: [1592, 1593], level: [25, 30], hist: hist(30, 35, 40, 45, 40), ruling: "court_seonjo", battles: [HWANGSAN] },
  { id: "ch10", years: [1597, 1598], level: [30, 32], hist: hist(35, 25, 35, 45, 40), ruling: "court_seonjo" },
  { id: "ch11", years: [1608, 1658], level: [32, 34], hist: hist(35, 30, 35, 40, 40), ruling: "court_ch11" },
  { id: "ch12", years: [1659, 1775], level: [34, 35], hist: hist(40, 35, 40, 35, 40), ruling: "court_ch12" },
  { id: "ch13", years: [1776, 1862], level: [35, 36], hist: hist(45, 40, 45, 35, 45), ruling: "court_ch13" },
  { id: "ch14", years: [1863, 1881], level: [36, 37], hist: hist(30, 25, 30, 30, 30), ruling: "court_ch14" },
  { id: "ch15", years: [1882, 1895], level: [37, 39], hist: hist(25, 20, 30, 25, 35), ruling: "court_ch15" },
  { id: "ch16", years: [1896, 1910], level: [39, 40], hist: hist(20, 20, 35, 25, 35), ruling: "imperial" },
];

function chapterFrom(spec: Spec, order: number): ChapterDef {
  const def: ChapterDef = {
    id: spec.id,
    order,
    title: `시험 ${spec.id}`,
    subtitle: "",
    years: spec.years,
    level: spec.level,
    music: "peace",
    season: "spring",
    weather: "clear",
    hour: 12,
    start: { site: "gaegyeong" },
    briefing: [],
    history: [],
    hist: spec.hist,
    factions: spec.factions ?? [],
    npcs: [],
    spawns: [],
    battles: spec.battles ?? [],
    prompts: [],
    steps: [{ id: "s1", year: spec.years[0], objectives: [] }, { id: "s2", year: spec.years[1], objectives: [] }],
    companions: 0,
  };
  if (spec.ruling) def.ruling = spec.ruling;
  if (spec.unlocks) def.unlocks = spec.unlocks;
  return def;
}

const chapters = Object.fromEntries(SPECS.map((spec, index) => [spec.id, chapterFrom(spec, index + 1)])) as Record<
  ChapterId,
  ChapterDef
>;

export const FIXTURE: ContentIndex = { ...CONTENT, chapters };

export function newSave(overrides: Partial<CreateOptions> = {}): PlayerSave {
  return createSave(FIXTURE, {
    token: "tok-test",
    name: "강휘",
    variant: "m",
    origin: "northeast",
    seed: 20240601,
    ...overrides,
  });
}

/** Places a save at the start of a chapter (no other changes). */
export function at(save: PlayerSave, chapter: ChapterId, year?: number): PlayerSave {
  save.chapter = chapter;
  save.year = year ?? FIXTURE.chapters[chapter].years[0];
  return save;
}

export function approx(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon;
}
