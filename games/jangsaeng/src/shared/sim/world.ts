// One World is one era channel instance: the shared map at a year, the
// chapter's NPCs, ambient spawns, battles, players (humans and simulated
// companions), projectiles. Units are tiles and seconds. Deterministic given
// seed and inputs: the host calls tick(0.05) at a fixed step and all
// randomness comes from a seeded Rng. Hooks fire at the end of the tick (or
// of the public call) that caused them, so hosts may call back into the world.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterDef, EnemyDef } from "../content/schema.ts";
import { collisionFor, type GameMap } from "../map/generate.ts";
import type { Derived } from "../rules/index.ts";
import { createRng } from "../rng.ts";
import type { BodyVariant, CharacterSprite } from "../sprites.ts";
import type { BattleView, EntitySnap, FxEvent, Marker } from "../types.ts";
import { tickEnemy } from "./ai.ts";
import { battleView, endBattle, startBattle, tickBattle } from "./battle.ts";
import { downPlayer, kill, revivePlayer, tickBurn } from "./combat.ts";
import { bodyFree, freePoint, releaseTokensOn, removeActor, spawnEnemy } from "./entities.ts";
import { tickFighter } from "./fighters.ts";
import { isBlocked, type CollisionGrid } from "./physics.ts";
import { applyInput, createPlayer, resetActions, tickPlayer } from "./player.ts";
import { makeSpawns, refreshPopulation, safeSpot, siteCentre, tickNpc, tickProps, tickSpawns } from "./population.ts";
import { stepDelayedFx, stepHazards, stepProjectiles, stepStrikes } from "./projectiles.ts";
import { snapshotFor } from "./snapshot.ts";
import { SpatialIndex } from "./spatial.ts";
import {
  C,
  COLOR,
  emit,
  floatText,
  flushEvents,
  flushFeel,
  hostile,
  setAnim,
  sound,
  type Actor,
  type Side,
  type Sim,
} from "./state.ts";

export interface PlayerInput {
  mx: number;
  my: number;
  attack: boolean;
  shoot: boolean;
  dodge: boolean;
  /** 1-4 skill slots, 5 = 노인성 일섬, 0 none (edge-triggered). */
  skill: number;
  interact: boolean;
  /** Aim direction in tiles (optional). */
  ax?: number;
  ay?: number;
}

export interface PlayerSpec {
  id: number;
  kind: "player" | "bot";
  name: string;
  title: string;
  sprite: CharacterSprite;
  variant: BodyVariant;
  level: number;
  derived: Derived;
  /** Equipped skill ids by slot (index 0 = slot 1). */
  skills: readonly string[];
  /** Spawn position in tiles. */
  x: number;
  y: number;
}

export interface WorldHooks {
  /** An enemy died; `killers` are player ids credited (last hitter first). */
  onKill(enemy: EnemyDef, level: number, boss: boolean, killers: readonly number[]): void;
  onBattleEnd(battleId: string, result: "victory" | "defeat", participants: readonly number[]): void;
  /** Player pressed interact near an NPC. */
  onTalk(playerId: number, npcId: string): void;
  onPickup(playerId: number, item: string): void;
  onDowned(playerId: number): void;
  /** Revived by an ally (`by`) or by self-revive (by = null). */
  onRevived(playerId: number, by: number | null): void;
  /** 노인성 일섬 fired (session charges one lifespan year). */
  onLongevity(playerId: number): void;
  /** Per-viewer marker over an NPC (quest giver "!" etc.). */
  npcMarker(playerId: number, npcId: string): Marker | undefined;
}

export interface PlayerStatus {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  stamina: number;
  downed: number | null;
  /** Seconds until each equipped skill is ready (slot order). */
  cooldowns: number[];
  longevityReady: number;
}

export interface WorldOptions {
  content: ContentIndex;
  chapter: ChapterDef;
  map: GameMap;
  year: number;
  seed: string;
  hooks: WorldHooks;
}

/** Read-only view of one entity (debug tools, tests, host checks). */
export interface EntityInfo {
  id: number;
  kind: EntitySnap["k"];
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  downed: boolean;
  boss: boolean;
  /** Enemy AI state, when an enemy. */
  state?: string;
  /** Enemy current target id (-1 none). */
  target?: number;
  /** 1 melee / 2 ranged attack token held, 0 none. */
  token?: number;
  sprite: string;
  name: string;
}

const gridFor = (map: GameMap, year: number): CollisionGrid => ({
  width: map.width,
  height: map.height,
  blocked: collisionFor(map, year),
  tiles: map.tiles,
});

const r2 = (v: number): number => Math.round(v * 100) / 100;

export class World {
  readonly #sim: Sim;
  readonly #seen = new Map<number, Set<number>>();
  readonly #query: WorldQuery;

  constructor(options: WorldOptions) {
    const { content, chapter, map, year, seed, hooks } = options;
    const sim: Sim = {
      content,
      chapter,
      map,
      grid: gridFor(map, year),
      year,
      rng: createRng(`world:${seed}:${chapter.id}`),
      hooks,
      time: 0,
      nextId: 1,
      actors: new Map(),
      index: new SpatialIndex<Actor>(8),
      projectiles: [],
      strikes: [],
      hazards: [],
      delayed: [],
      fx: [],
      events: [],
      feel: new Map(),
      tokens: new Map(),
      spawns: [],
      npcs: new Map(),
      sites: new Map(map.sites.map((site) => [site.id, site])),
      players: new Map(),
      battle: null,
      stepIndex: 0,
    };
    this.#sim = sim;
    sim.spawns.push(...makeSpawns(sim));
    refreshPopulation(sim);
    this.#query = makeQuery(sim);
  }

  /** Simulation clock in seconds. */
  get time(): number {
    return this.#sim.time;
  }

  /** Chapter step changed for this channel's story phase (NPC/spawn windows). */
  setStep(stepId: string): void {
    const sim = this.#sim;
    const index = sim.chapter.steps.findIndex((step) => step.id === stepId);
    if (index < 0) return;
    sim.stepIndex = index;
    const year = sim.chapter.steps[index]?.year;
    if (year !== undefined && year !== sim.year) this.setYear(year);
    refreshPopulation(sim);
    flushEvents(sim);
  }

  /** Rebuilds collision for a year (structures appear or fall). */
  setYear(year: number): void {
    const sim = this.#sim;
    sim.year = year;
    sim.grid = gridFor(sim.map, year);
    for (const a of sim.actors.values()) {
      if (bodyFree(sim, a.x, a.y, a.radius)) continue;
      const p = freePoint(sim, a.x, a.y, 12);
      a.x = p.x;
      a.y = p.y;
      sim.index.update(a);
    }
  }

  addPlayer(spec: PlayerSpec): void {
    const sim = this.#sim;
    const existing = sim.actors.get(spec.id);
    if (existing) removeActor(sim, existing);
    this.#seen.delete(spec.id);
    createPlayer(sim, spec);
  }

  /** Refresh level/derived/sprite/skills after progression changes. */
  updatePlayer(id: number, patch: Partial<Omit<PlayerSpec, "id" | "kind" | "x" | "y">>): void {
    const a = this.#sim.players.get(id);
    const p = a?.pl;
    if (!a || !p) return;
    if (patch.name !== undefined) a.name = patch.name;
    if (patch.title !== undefined) a.title = patch.title;
    if (patch.sprite !== undefined) a.sprite = patch.sprite;
    if (patch.variant !== undefined) a.variant = patch.variant;
    if (patch.level !== undefined) a.level = patch.level;
    if (patch.skills !== undefined) p.skills = [...patch.skills];
    if (patch.derived !== undefined) {
      const ratio = a.maxHp > 0 ? a.hp / a.maxHp : 1;
      p.derived = patch.derived;
      a.maxHp = patch.derived.maxHp;
      a.def = patch.derived.armorDef;
      if (p.downedAt < 0) a.hp = Math.max(1, Math.min(a.maxHp, ratio * a.maxHp));
      p.energy = Math.min(p.energy, patch.derived.maxEnergy);
    }
  }

  removePlayer(id: number): void {
    const sim = this.#sim;
    const a = sim.players.get(id);
    if (a) removeActor(sim, a);
    releaseTokensOn(sim, id);
    this.#seen.delete(id);
  }

  setInput(id: number, input: PlayerInput): void {
    const a = this.#sim.players.get(id);
    if (a) applyInput(a, input);
  }

  teleport(id: number, x: number, y: number): void {
    const sim = this.#sim;
    const a = sim.players.get(id);
    if (!a) return;
    const p = safeSpot(sim, x, y);
    a.x = p.x;
    a.y = p.y;
    resetActions(sim, a);
    sim.index.update(a);
  }

  /** Heals to full (chapter start, rest). */
  restore(id: number): void {
    const sim = this.#sim;
    const a = sim.players.get(id);
    const p = a?.pl;
    if (!a || !p) return;
    a.hp = a.maxHp;
    a.burnUntil = 0;
    p.energy = p.derived.maxEnergy;
    p.stamina = C.STAMINA_MAX;
    if (p.downedAt >= 0) {
      p.downedAt = -1;
      p.revive = 0;
      setAnim(sim, a, "idle");
    }
  }

  /** Self-revive at the nearest post station with 50% HP. */
  selfRevive(id: number): void {
    const sim = this.#sim;
    const a = sim.players.get(id);
    if (!a?.pl || a.pl.downedAt < 0) return;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const site of sim.sites.values()) {
      if (!site.station) continue;
      const d = Math.hypot(site.x + 0.5 - a.x, site.y + 0.5 - a.y);
      if (d < bestD) {
        bestD = d;
        best = { x: site.x + 0.5, y: site.y + 0.5 };
      }
    }
    if (best) {
      const p = safeSpot(sim, best.x, best.y);
      a.x = p.x;
      a.y = p.y;
      resetActions(sim, a);
      sim.index.update(a);
    }
    revivePlayer(sim, a, C.SELF_REVIVE_HP, null);
    flushEvents(sim);
  }

  heal(id: number, amount: number): void {
    const sim = this.#sim;
    const a = sim.players.get(id);
    if (!a?.pl || a.pl.downedAt >= 0 || !(amount > 0)) return;
    const before = a.hp;
    a.hp = Math.min(a.maxHp, a.hp + amount);
    emit(sim, { k: "heal", x: a.x, y: a.y });
    floatText(sim, a.x, a.y, `+${Math.round(a.hp - before)}`, COLOR.heal);
    sound(sim, "heal", a.x, a.y);
  }

  /** Starts a battle from the chapter's battles if none is active. */
  startBattle(battleId: string, starterId: number): boolean {
    const started = startBattle(this.#sim, battleId, starterId) !== null;
    flushEvents(this.#sim);
    return started;
  }

  /** Ends any active battle without result (chapter change, demo skip). */
  abortBattle(): void {
    endBattle(this.#sim, null);
  }

  /** Ends the active battle with a result (fires onBattleEnd). */
  endBattle(result: "victory" | "defeat"): void {
    endBattle(this.#sim, result);
    flushEvents(this.#sim);
  }

  battleView(): BattleView | null {
    return battleView(this.#sim);
  }

  tick(dt: number): void {
    const sim = this.#sim;
    sim.time = Math.round((sim.time + dt) * 1e6) / 1e6;
    const list = [...sim.actors.values()];
    for (const a of list) {
      if (a.removed) continue;
      if (a.pl) tickPlayer(sim, a, dt);
      else if (a.en) tickEnemy(sim, a, dt);
      else if (a.npcId) tickNpc(sim, a, dt);
      else if (a.fi) tickFighter(sim, a, dt);
      else if (a.item) tickProps(sim, a);
    }
    for (const a of list) if (!a.removed && a.burnUntil > 0) tickBurn(sim, a);
    stepProjectiles(sim, dt);
    stepStrikes(sim);
    stepHazards(sim);
    stepDelayedFx(sim);
    tickBattle(sim);
    tickSpawns(sim);
    for (const a of list) if (!a.removed && !a.pl && sim.time >= a.removeAt) removeActor(sim, a);
    flushFeel(sim);
    flushEvents(sim);
  }

  /** Entities within the interest radius of a player, plus removed ids. */
  snapshotFor(id: number): { ents: EntitySnap[]; gone: number[] } {
    return snapshotFor(this.#sim, id, this.#seen);
  }

  /** Effects produced since the last call, with world positions. */
  drainFx(): FxEvent[] {
    return this.#sim.fx.splice(0);
  }

  playerStatus(id: number): PlayerStatus | null {
    const sim = this.#sim;
    const a = sim.players.get(id);
    const p = a?.pl;
    if (!a || !p) return null;
    const t = sim.time;
    return {
      x: r2(a.x),
      y: r2(a.y),
      hp: Math.ceil(a.hp),
      maxHp: a.maxHp,
      energy: Math.floor(p.energy),
      maxEnergy: p.derived.maxEnergy,
      stamina: Math.floor(p.stamina),
      downed: p.downedAt >= 0 ? r2(Math.max(0, p.downEnd - t)) : null,
      cooldowns: p.skills.map((s) => r2(Math.max(0, (p.ready.get(s) ?? 0) - t))),
      longevityReady: r2(Math.max(0, p.longevityAt - t)),
    };
  }

  /** Site id whose rectangle contains the player, if any. */
  siteOf(id: number): string | null {
    const a = this.#sim.players.get(id);
    if (!a) return null;
    const x = Math.floor(a.x);
    const y = Math.floor(a.y);
    let best: string | null = null;
    let bestArea = Infinity;
    for (const site of this.#sim.sites.values()) {
      const r = site.rect;
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
      if (r.w * r.h < bestArea) {
        bestArea = r.w * r.h;
        best = site.id;
      }
    }
    return best;
  }

  /** Positions for UI markers. */
  npcPosition(npcId: string): { x: number; y: number } | null {
    const sim = this.#sim;
    const id = sim.npcs.get(npcId);
    const a = id === undefined ? undefined : sim.actors.get(id);
    return a ? { x: r2(a.x), y: r2(a.y) } : null;
  }

  sitePosition(siteId: string): { x: number; y: number } | null {
    return siteCentre(this.#sim, siteId);
  }

  /** Read-only queries used by companion bots. */
  query(): WorldQuery {
    return this.#query;
  }

  // ── Additions: tools for hosts, demos and tests ─────────────────────────

  /** Spawns an ambient enemy (leashed to its spawn point); returns its id. */
  spawnEnemy(enemyId: string, x: number, y: number, level: number): number | null {
    const sim = this.#sim;
    const def = sim.content.enemies[enemyId];
    if (!def) return null;
    return spawnEnemy(sim, def, x, y, { level, leash: true }).id;
  }

  /** Raw damage that ignores defence (environment, scripted events). */
  damage(id: number, amount: number): void {
    const sim = this.#sim;
    const a = sim.actors.get(id);
    if (!a || !a.alive || !(amount > 0) || a.immortal) return;
    if (a.pl && a.pl.downedAt >= 0) return;
    a.hp -= amount;
    a.lastHurt = sim.time;
    floatText(sim, a.x, a.y, String(Math.round(amount)), a.pl ? COLOR.hurt : COLOR.normal);
    if (a.hp <= 0) {
      if (a.pl) downPlayer(sim, a);
      else kill(sim, a, null);
    }
    flushEvents(sim);
  }

  /** Enables or disables slot 5 (the host enforces 3 uses per chapter). */
  setLongevityEnabled(id: number, enabled: boolean): void {
    const p = this.#sim.players.get(id)?.pl;
    if (p) p.longevityEnabled = enabled;
  }

  inspect(id: number): EntityInfo | null {
    const a = this.#sim.actors.get(id);
    if (!a) return null;
    const info: EntityInfo = {
      id: a.id,
      kind: a.kind,
      side: a.side,
      x: a.x,
      y: a.y,
      hp: a.hp,
      maxHp: a.maxHp,
      alive: a.alive,
      downed: a.pl !== null && a.pl.downedAt >= 0,
      boss: a.en?.boss != null,
      sprite: a.sprite,
      name: a.name,
    };
    if (a.en) {
      info.state = a.en.state;
      info.target = a.en.target;
      info.token = a.en.token;
    }
    return info;
  }

  /** Every live entity id, sorted (debug overlays, tests). */
  entityIds(): number[] {
    return [...this.#sim.actors.keys()].sort((m, n) => m - n);
  }
}

export interface WorldQuery {
  nearestEnemy(x: number, y: number, radius: number): { id: number; x: number; y: number } | null;
  downedAllies(x: number, y: number, radius: number): { id: number; x: number; y: number }[];
  player(id: number): { x: number; y: number; hp: number; maxHp: number; downed: boolean } | null;
  battleCentre(): { x: number; y: number; radius: number } | null;
  /** True when the tile is walkable. */
  walkable(x: number, y: number): boolean;
}

function makeQuery(sim: Sim): WorldQuery {
  return {
    nearestEnemy(x, y, radius) {
      const duel = sim.battle?.def.kind === "duel";
      const a = sim.index.nearest(x, y, radius, (e) => hostile(e) && e.en?.state !== "flee" && !(duel && e.en?.battle === true));
      return a ? { id: a.id, x: a.x, y: a.y } : null;
    },
    downedAllies(x, y, radius) {
      const out: { id: number; x: number; y: number; d: number }[] = [];
      for (const a of sim.players.values()) {
        const p = a.pl;
        if (!p || p.downedAt < 0 || sim.time >= p.downEnd) continue;
        const d = Math.hypot(a.x - x, a.y - y);
        if (d <= radius) out.push({ id: a.id, x: a.x, y: a.y, d });
      }
      return out.sort((m, n) => m.d - n.d || m.id - n.id).map(({ id, x: ax, y: ay }) => ({ id, x: ax, y: ay }));
    },
    player(id) {
      const a = sim.players.get(id);
      if (!a?.pl) return null;
      return { x: a.x, y: a.y, hp: a.hp, maxHp: a.maxHp, downed: a.pl.downedAt >= 0 };
    },
    battleCentre() {
      const b = sim.battle;
      return b ? { x: b.cx, y: b.cy, radius: b.radius } : null;
    },
    walkable(x, y) {
      return !isBlocked(sim.grid, Math.floor(x), Math.floor(y));
    },
  };
}
