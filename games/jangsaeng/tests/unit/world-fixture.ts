// Shared fixture for world*.test.ts: a hand-made chapter on the real
// generated map, a fake Derived and recording hooks. Content chapters are
// written concurrently, so only the stable rosters (enemies, items, skills)
// are imported.
import type { ContentIndex } from "../../src/shared/content/index.ts";
import { ENEMIES } from "../../src/shared/content/enemies.ts";
import { ITEMS } from "../../src/shared/content/items.ts";
import type { ChapterDef, EnemyDef } from "../../src/shared/content/schema.ts";
import { LONGEVITY_SKILL, SKILLS } from "../../src/shared/content/skills.ts";
import { generateMap, type GameMap } from "../../src/shared/map/generate.ts";
import type { Derived } from "../../src/shared/rules/index.ts";
import type { Marker } from "../../src/shared/types.ts";
import { World, type PlayerInput, type PlayerSpec, type WorldHooks } from "../../src/shared/sim/world.ts";

export const CONTENT = { enemies: ENEMIES, items: ITEMS, skills: SKILLS, longevity: LONGEVITY_SKILL } as unknown as ContentIndex;

let cached: GameMap | null = null;
export function map(): GameMap {
  cached ??= generateMap("jangsaeng");
  return cached;
}

export const DERIVED: Derived = {
  maxHp: 115,
  maxEnergy: 100,
  energyRegen: 3.5,
  moveSpeed: 4,
  critChance: 0.065,
  melee: 1.125,
  bow: 1.125,
  skill: 1.1,
  weaponAtk: 10,
  armorDef: 2,
  downSeconds: 10.5,
};

export const BOSS = {
  enemy: "boss_wokou_captain",
  name: "아지발도",
  title: "왜구 소년 장수",
  historical: true,
  level: 8,
  hpScale: 1,
  phases: [
    { at: 1, mechanic: "spin" as const, line: "덤벼라!" },
    { at: 0.5, mechanic: "summon" as const, line: "나와라, 늑대들아!", summon: { enemy: "wolf", count: 2 } },
  ],
};

export const CHAPTER: ChapterDef = {
  id: "ch02",
  order: 2,
  title: "시험 장",
  subtitle: "",
  years: [1380, 1380],
  level: [5, 10],
  music: "war",
  season: "autumn",
  weather: "clear",
  hour: 12,
  start: { site: "hwangsan" },
  briefing: [],
  history: [],
  hist: { defense: 40, finance: 35, people: 35, diplomacy: 40, reform: 25 },
  factions: [],
  npcs: [
    { id: "elder", name: "마을 노인", sprite: "elder", site: "jeonju", offset: [0, 3], talk: ["어서 오게."], untilStep: "s2" },
    { id: "taejo", name: "이성계", title: "동북면 원수", sprite: "general_goryeo", site: "hwangsan", offset: [-3, 3], historical: true, fights: true, talk: [] },
    { id: "late", name: "전령", sprite: "messenger", site: "jeonju", offset: [3, 3], talk: [], fromStep: "s3" },
  ],
  spawns: [
    { id: "wolves", enemy: "wolf", site: "jeonju", offset: [6, 8], radius: 2, count: 3, level: 1, respawnSec: 5, fromStep: "s2" },
  ],
  battles: [
    {
      id: "waves", title: "도적 소탕", site: "hwangsan", offset: [4, 0], radius: 8, kind: "waves",
      waves: [
        { enemies: [{ enemy: "bandit", count: 3, level: 1 }], from: "east" },
        { enemies: [{ enemy: "bandit", count: 2, level: 1 }], from: "north", line: "증원이다!" },
      ],
      victory: [], defeat: [],
    },
    {
      id: "defend", title: "봉수대 사수", site: "hwangsan", offset: [4, 0], radius: 8, kind: "defend", timeLimit: 120,
      defend: { name: "봉수대", sprite: "banner", hp: 40 },
      waves: [{ enemies: [{ enemy: "wokou_raider", count: 4, level: 3 }], from: "east" }],
      victory: [], defeat: [],
    },
    { id: "boss", title: "황산", site: "hwangsan", offset: [4, 0], radius: 9, kind: "boss", boss: BOSS, waves: [], victory: [], defeat: [] },
  ],
  prompts: [],
  steps: [
    { id: "s1", year: 1380, objectives: [] },
    { id: "s2", year: 1380, objectives: [] },
    { id: "s3", year: 1380, objectives: [] },
  ],
  companions: 2,
};

export interface HookLog {
  kills: { enemy: EnemyDef; level: number; boss: boolean; killers: readonly number[] }[];
  battles: { id: string; result: "victory" | "defeat"; participants: readonly number[] }[];
  talks: { player: number; npc: string }[];
  pickups: { player: number; item: string }[];
  downed: number[];
  revived: { player: number; by: number | null }[];
  longevity: number[];
  /** `player:battle` for every victory resolved: the `fights` query answers from it as a host does. */
  won: Set<string>;
}

export function recorder(marker?: (player: number, npc: string) => Marker | undefined): { log: HookLog; hooks: WorldHooks } {
  const log: HookLog = { kills: [], battles: [], talks: [], pickups: [], downed: [], revived: [], longevity: [], won: new Set() };
  const hooks: WorldHooks = {
    onKill: (enemy, level, boss, killers) => void log.kills.push({ enemy, level, boss, killers }),
    onBattleEnd: (id, result, participants) => {
      log.battles.push({ id, result, participants });
      if (result === "victory") for (const player of participants) log.won.add(`${player}:${id}`);
    },
    fights: (player, battle) => !log.won.has(`${player}:${battle}`),
    onTalk: (player, npc) => void log.talks.push({ player, npc }),
    onPickup: (player, item) => void log.pickups.push({ player, item }),
    onDowned: (player) => void log.downed.push(player),
    onRevived: (player, by) => void log.revived.push({ player, by }),
    onLongevity: (player) => void log.longevity.push(player),
    npcMarker: (player, npc) => marker?.(player, npc),
  };
  return { log, hooks };
}

export function makeWorld(seed = "test", chapter: ChapterDef = CHAPTER): { world: World; log: HookLog } {
  const { log, hooks } = recorder((_, npc) => (npc === "elder" ? "quest" : undefined));
  const world = new World({ content: CONTENT, chapter, map: map(), year: 1380, seed, hooks });
  return { world, log };
}

/** Battle centre for the fixture battles (hwangsan + [4, 0]). */
export function arena(): { x: number; y: number } {
  const site = map().sites.find((s) => s.id === "hwangsan");
  if (!site) throw new Error("hwangsan missing");
  return { x: site.x + 4.5, y: site.y + 0.5 };
}

export function siteCentre(id: string): { x: number; y: number } {
  const site = map().sites.find((s) => s.id === id);
  if (!site) throw new Error(`${id} missing`);
  return { x: site.x + 0.5, y: site.y + 0.5 };
}

let nextId = 1_000_000;
export function spec(x: number, y: number, patch: Partial<PlayerSpec> = {}): PlayerSpec {
  return {
    id: nextId++,
    kind: "player",
    name: "시험",
    title: "",
    sprite: "hero_youth",
    variant: "m",
    level: 1,
    derived: DERIVED,
    skills: ["dash_slash", "whirlwind", "war_cry", "pyeonjeon"],
    x,
    y,
    ...patch,
  };
}

export function input(patch: Partial<PlayerInput> = {}): PlayerInput {
  return { mx: 0, my: 0, attack: false, shoot: false, dodge: false, skill: 0, interact: false, ...patch };
}

export const DT = 0.05;

export function run(world: World, seconds: number, each?: (t: number) => void): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    each?.(i * DT);
    world.tick(DT);
  }
}

/** Steers a player toward the nearest enemy and attacks (a crude bot). */
export function fightNearest(world: World, id: number, radius = 30): void {
  const me = world.query().player(id);
  if (!me || me.downed) {
    world.setInput(id, input());
    return;
  }
  const foe = world.query().nearestEnemy(me.x, me.y, radius);
  if (!foe) {
    world.setInput(id, input());
    return;
  }
  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const d = Math.hypot(dx, dy);
  world.setInput(id, input({ mx: d > 0.9 ? dx / d : 0, my: d > 0.9 ? dy / d : 0, attack: d < 1.6, ax: dx, ay: dy }));
}
