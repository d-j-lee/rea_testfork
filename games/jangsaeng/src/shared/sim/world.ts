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
import {
  arenaOf,
  arrival,
  atBattle,
  battleView,
  endBattle,
  leaveBattle,
  rimRevival,
  startBattle,
  startRefusal,
  tickBattle,
  type StartRefusal,
} from "./battle.ts";
import { downPlayer, kill, revivePlayer, tickBurn } from "./combat.ts";
import { bodyFree, freePoint, placePlayer, releaseTokensOn, removeActor, spawnEnemy } from "./entities.ts";
import { tickFighter } from "./fighters.ts";
import { isBlocked, type CollisionGrid } from "./physics.ts";
import { applyInput, createPlayer, tickPlayer } from "./player.ts";
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
  /** Whether slot 5 (노인성 일섬) may fire; default true. The host keeps it current. */
  longevityEnabled?: boolean;
  /** Spawn position in tiles. */
  x: number;
  y: number;
}

export interface WorldHooks {
  /** An enemy died; `killers` are player ids credited (last hitter first). */
  onKill(enemy: EnemyDef, level: number, boss: boolean, killers: readonly number[]): void;
  /** A battle ended; `participants`: everyone who fought it (sim/battle.ts muster), each to be resolved. */
  onBattleEnd(battleId: string, result: "victory" | "defeat", participants: readonly number[]): void;
  /**
   * Query, answered inline: whether a player at a chapter battle (not its
   * starter) still has it to fight and so is taken in — the host's call,
   * e.g. companions always, a person while it is an open objective of theirs.
   */
  fights(playerId: number, battleId: string): boolean;
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
  /** Step orders the channel's members stand at (NPC and spawn windows). */
  #steps: readonly number[] = [0];

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
    };
    this.#sim = sim;
    sim.spawns.push(...makeSpawns(sim));
    refreshPopulation(sim, this.#steps);
    this.#query = makeQuery(sim);
  }

  /** Simulation clock in seconds. */
  get time(): number {
    return this.#sim.time;
  }

  /**
   * The story steps the channel's members stand at (one id per member; unknown
   * ids are ignored). An NPC or spawn group is present while its window holds
   * any member's step. The map shows the earliest member's year, so the shared
   * world never runs ahead of anyone's story.
   */
  setStep(...stepIds: readonly string[]): void {
    const sim = this.#sim;
    const steps = [...new Set(stepIds.map((id) => sim.chapter.steps.findIndex((step) => step.id === id)))]
      .filter((index) => index >= 0)
      .sort((m, n) => m - n);
    const earliest = steps[0];
    if (earliest === undefined) return;
    this.#steps = steps;
    const year = sim.chapter.steps[earliest]?.year;
    if (year !== undefined && year !== sim.year) this.setYear(year);
    refreshPopulation(sim, steps);
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
    this.setLongevityEnabled(spec.id, spec.longevityEnabled ?? true);
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
    const p = safeSpot(sim, x, y, id);
    placePlayer(sim, a, p.x, p.y);
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

  /**
   * Self-revive with 50% HP: a battle participant on the arena's rim, still
   * in the fight (GDD: 전투 중이면 전투 링 가장자리); anyone else at the
   * nearest post station.
   */
  selfRevive(id: number): void {
    const sim = this.#sim;
    const a = sim.players.get(id);
    if (!a?.pl || a.pl.downedAt < 0) return;
    let spot = rimRevival(sim, a);
    if (!spot) {
      let station: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const site of sim.sites.values()) {
        const d = Math.hypot(site.x + 0.5 - a.x, site.y + 0.5 - a.y);
        if (site.station && d < bestD) {
          bestD = d;
          station = site;
        }
      }
      if (station) spot = safeSpot(sim, station.x + 0.5, station.y + 0.5, id);
    }
    if (spot) placePlayer(sim, a, spot.x, spot.y);
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

  /** Starts a chapter battle for `starterId` unless it is refused (battleRefusal). */
  startBattle(battleId: string, starterId: number): boolean {
    const started = startBattle(this.#sim, battleId, starterId) !== null;
    flushEvents(this.#sim);
    return started;
  }

  /** Why `starterId` cannot start `battleId` now (unknown, downed, busy), or null when startBattle would start it. */
  battleRefusal(battleId: string, starterId: number): StartRefusal | null {
    return startRefusal(this.#sim, battleId, starterId);
  }

  /** True when a player is at a battle: close enough to its ring to start it, or to be taken into it while it runs. */
  atBattle(battleId: string, playerId: number): boolean {
    return atBattle(this.#sim, battleId, playerId);
  }

  /** Where a player carried to a battle (story start, demo skip) lands: its own ground on their side. */
  arrivalSpot(battleId: string, playerId: number): { x: number; y: number } | null {
    return arrival(this.#sim, battleId, playerId);
  }

  /** Ends any active battle without result (chapter change, demo skip). */
  abortBattle(): void {
    endBattle(this.#sim, null);
  }

  /** Takes a player out of the active battle while the others fight on (a demo skip won it for them). */
  leaveBattle(id: number): void {
    leaveBattle(this.#sim, id);
  }

  /**
   * Where a chapter battle is fought (centre and radius): the running
   * battle's arena, or the arena it would be fought on now. The one place
   * hosts read a battle's position from (the objective marker); atBattle and
   * arrivalSpot answer from it too.
   */
  arenaOf(battleId: string): { x: number; y: number; radius: number } | null {
    const arena = arenaOf(this.#sim, battleId);
    return arena ? { x: arena.x, y: arena.y, radius: arena.radius } : null;
  }

  /** Ends the active battle with a result (fires onBattleEnd). */
  endBattle(result: "victory" | "defeat"): void {
    endBattle(this.#sim, result);
    flushEvents(this.#sim);
  }

  battleView(): BattleView | null {
    return battleView(this.#sim);
  }

  /** Player ids (humans and companions) who fight the active battle: counted, and resolved when it ends. */
  battleParticipants(): number[] {
    return [...(this.#sim.battle?.participants ?? [])];
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

  /** Enables or disables slot 5; the host mirrors rules/lifespan.ts longevityBlocker here. */
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
  /** The nearest enemy within `radius` of (x, y) whose current target is one of `targets`. */
  enemyAiming(targets: readonly number[], x: number, y: number, radius: number): { id: number; x: number; y: number } | null;
  downedAllies(x: number, y: number, radius: number): { id: number; x: number; y: number }[];
  player(id: number): { x: number; y: number; hp: number; maxHp: number; downed: boolean } | null;
  battleCentre(): { x: number; y: number; radius: number } | null;
  /** The standing post a running defend battle holds, if any. */
  defendPost(): { x: number; y: number } | null;
  /** True when the tile is walkable. */
  walkable(x: number, y: number): boolean;
}

function makeQuery(sim: Sim): WorldQuery {
  /** Enemies a companion may engage: not fleeing, and not a duel's (the duel is the starter's alone). */
  const foe = (e: Actor) => hostile(e) && e.en?.state !== "flee" && !(sim.battle?.def.kind === "duel" && e.en?.battle === true);
  return {
    nearestEnemy(x, y, radius) {
      const a = sim.index.nearest(x, y, radius, foe);
      return a ? { id: a.id, x: a.x, y: a.y } : null;
    },
    enemyAiming(targets, x, y, radius) {
      const a = sim.index.nearest(x, y, radius, (e) => foe(e) && targets.includes(e.en?.target ?? -1));
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
      const ring = sim.battle?.arena;
      return ring ? { x: ring.x, y: ring.y, radius: ring.radius } : null;
    },
    defendPost() {
      const post = sim.actors.get(sim.battle?.defendId ?? -1);
      return post?.alive ? { x: post.x, y: post.y } : null;
    },
    walkable(x, y) {
      return !isBlocked(sim.grid, Math.floor(x), Math.floor(y));
    },
  };
}
