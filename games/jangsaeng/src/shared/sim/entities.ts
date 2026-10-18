// Actor factories. Ids for world-made actors come from sim.nextId (1 upward,
// below the host's player id range); players keep their host-assigned ids.
import type { EnemyDef } from "../content/schema.ts";
import type { CharacterSprite, PropSprite, SpriteKey } from "../sprites.ts";
import type { EntityKind } from "../types.ts";
import { isBlocked, nearestFree } from "./physics.ts";
import { C, emit, type Actor, type BossState, type EnemyData, type FighterData, type Side, type Sim } from "./state.ts";

export function allocId(sim: Sim): number {
  // Wrap inside the internal range, skipping ids still in use.
  for (;;) {
    const id = sim.nextId;
    sim.nextId = id >= C.MAX_INTERNAL_ID ? 1 : id + 1;
    if (!sim.actors.has(id)) return id;
  }
}

export interface ActorInit {
  id?: number;
  kind: EntityKind;
  side: Side;
  x: number;
  y: number;
  sprite: SpriteKey;
  name: string;
  hp: number;
  level?: number;
}

export function makeActor(sim: Sim, init: ActorInit): Actor {
  const id = init.id ?? allocId(sim);
  const a: Actor = {
    id,
    kind: init.kind,
    side: init.side,
    x: init.x,
    y: init.y,
    radius: C.BODY,
    fx: 0,
    fy: 1,
    dir: "down",
    anim: "idle",
    animAt: sim.time,
    animUntil: 0,
    moving: false,
    hp: init.hp,
    maxHp: init.hp,
    def: 0,
    alive: true,
    removed: false,
    diedAt: 0,
    removeAt: Infinity,
    sprite: init.sprite,
    name: init.name,
    title: undefined,
    level: init.level ?? 1,
    variant: undefined,
    hist: false,
    invulnUntil: 0,
    stunUntil: 0,
    fearUntil: 0,
    fearX: 0,
    fearY: 0,
    buffUntil: 0,
    burnUntil: 0,
    burnDps: 0,
    burnNext: 0,
    burnOwner: -1,
    kx: 0,
    ky: 0,
    immortal: false,
    lastHurt: -99,
    markUntil: 0,
    lookUntil: 0,
    pl: null,
    en: null,
    fi: null,
    npcId: null,
    item: null,
    defend: false,
  };
  sim.actors.set(id, a);
  sim.index.insert(a);
  return a;
}

export function removeActor(sim: Sim, a: Actor): void {
  if (a.removed) return;
  a.removed = true;
  a.alive = false;
  sim.actors.delete(a.id);
  sim.index.remove(a);
  sim.players.delete(a.id);
  releaseToken(sim, a);
}

/** True when a body of half-size `r` at (x, y) overlaps no blocked tile. */
export function bodyFree(sim: Sim, x: number, y: number, r: number = C.BODY): boolean {
  const g = sim.grid;
  return (
    !isBlocked(g, Math.floor(x - r), Math.floor(y - r)) &&
    !isBlocked(g, Math.floor(x + r), Math.floor(y - r)) &&
    !isBlocked(g, Math.floor(x - r), Math.floor(y + r)) &&
    !isBlocked(g, Math.floor(x + r), Math.floor(y + r))
  );
}

/** Walkable point near (x, y); falls back to the input when nothing is free. */
export function freePoint(sim: Sim, x: number, y: number, radius = 12): { x: number; y: number } {
  if (bodyFree(sim, x, y)) return { x, y };
  return nearestFree(sim.grid, x, y, radius) ?? { x, y };
}

export const hpScale = (level: number): number => 1 + 0.1 * (level - 1);
export const atkScale = (level: number): number => 1 + 0.08 * (level - 1);

export interface EnemyOptions {
  level: number;
  hpMul?: number;
  battle?: boolean;
  wave?: number;
  spawn?: number;
  boss?: BossState | null;
  leash?: boolean;
}

export function spawnEnemy(sim: Sim, def: EnemyDef, x: number, y: number, o: EnemyOptions): Actor {
  const p = freePoint(sim, x, y, 8);
  const level = Math.max(1, Math.round(o.level));
  const hp = Math.max(1, Math.round(def.hp * hpScale(level) * (o.hpMul ?? 1)));
  const boss = o.boss ?? null;
  const a = makeActor(sim, {
    kind: "enemy",
    side: "foe",
    x: p.x,
    y: p.y,
    sprite: def.sprite,
    name: boss ? boss.def.name : def.name,
    hp,
    level,
  });
  a.def = def.def;
  a.title = boss?.def.title;
  if (def.behavior === "boss" || def.elite) a.radius = 0.38;
  const en: EnemyData = {
    def,
    level,
    atk: def.atk * atkScale(level),
    state: "idle",
    target: -1,
    homeX: p.x,
    homeY: p.y,
    leash: o.leash ?? !o.battle,
    thinkAt: sim.time + (a.id % 4) * 0.05,
    nextAttackAt: sim.time + 0.4 + sim.rng.range(0, 0.6),
    nextSpecialAt: sim.time + (def.behavior === "charger" ? 0.3 : 1) + sim.rng.range(0, 1.5),
    act: null,
    poise: def.poise,
    maxPoise: def.poise,
    stunned: false,
    token: 0,
    tokenTarget: -1,
    flank: sim.rng.range(-1.4, 1.4),
    goalX: p.x,
    goalY: p.y,
    goalUntil: 0,
    alertUntil: 0,
    wanderAt: sim.time + sim.rng.range(1, 4),
    credit: [],
    spawn: o.spawn ?? -1,
    battle: o.battle ?? false,
    wave: o.wave ?? -1,
    boss,
    fleeUntil: 0,
    speedMul: 1,
    cdMul: 1,
    reloadUntil: 0,
    lastX: p.x,
    lastY: p.y,
    stuck: 0,
    detourUntil: 0,
    detourX: 0,
    detourY: 0,
    strafe: sim.rng.chance(0.5) ? 1 : -1,
    los: false,
  };
  a.en = en;
  return a;
}

export function spawnProp(sim: Sim, sprite: PropSprite, item: string | null, x: number, y: number, name = ""): Actor {
  const p = freePoint(sim, x, y, 4);
  const a = makeActor(sim, { kind: "prop", side: "none", x: p.x, y: p.y, sprite, name, hp: 1 });
  a.item = item;
  a.removeAt = item ? sim.time + 90 : Infinity;
  return a;
}

export interface FighterInit {
  kind: "ally" | "npc";
  sprite: CharacterSprite;
  name: string;
  x: number;
  y: number;
  hp: number;
  atk: number;
  level: number;
  immortal: boolean;
}

export function spawnFighter(sim: Sim, init: FighterInit): Actor {
  const p = freePoint(sim, init.x, init.y, 8);
  const a = makeActor(sim, {
    kind: init.kind,
    side: "friend",
    x: p.x,
    y: p.y,
    sprite: init.sprite,
    name: init.name,
    hp: init.hp,
    level: init.level,
  });
  a.def = 4;
  a.immortal = init.immortal;
  const ranged = init.sprite.includes("archer") || init.sprite.includes("musketeer");
  const fi: FighterData = {
    anchorX: p.x,
    anchorY: p.y,
    atk: init.atk,
    range: ranged ? 6 : 1.3,
    ranged,
    cooldown: ranged ? 2.2 : 1.1,
    nextAt: sim.time + sim.rng.range(0.2, 1),
    thinkAt: sim.time,
    target: -1,
    speed: 3.6,
    active: init.kind === "ally",
  };
  a.fi = fi;
  return a;
}

/** Drop sprite for an item. */
export function dropSprite(sim: Sim, item: string): PropSprite {
  if (item === "ginseng") return "ginseng";
  const def = sim.content.items[item];
  if (!def) return "chest";
  if (def.kind === "treasure") return "coin";
  if (def.kind === "consumable") return "herb";
  return "chest";
}

export function spawnDrops(sim: Sim, a: Actor): void {
  const drops = a.en?.def.drops;
  if (!drops) return;
  for (const drop of drops) {
    if (!sim.rng.chance(drop.chance)) continue;
    const x = a.x + sim.rng.range(-0.5, 0.5);
    const y = a.y + sim.rng.range(-0.5, 0.5);
    const name = sim.content.items[drop.item]?.name ?? drop.item;
    spawnProp(sim, dropSprite(sim, drop.item), drop.item, x, y, name);
    emit(sim, { k: "spark", x, y, color: "#ffd84a" });
  }
}

// ── Attack tokens (per target: 3 melee + 2 ranged) ──────────────────────

export function acquireToken(sim: Sim, a: Actor, target: number, ranged: boolean): boolean {
  const en = a.en;
  if (!en) return false;
  if (en.token !== 0 && en.tokenTarget === target) return true;
  releaseToken(sim, a);
  let slot = sim.tokens.get(target);
  if (!slot) {
    slot = { melee: [], ranged: [] };
    sim.tokens.set(target, slot);
  }
  const list = ranged ? slot.ranged : slot.melee;
  if (list.length >= (ranged ? C.TOKENS_RANGED : C.TOKENS_MELEE)) return false;
  list.push(a.id);
  en.token = ranged ? 2 : 1;
  en.tokenTarget = target;
  return true;
}

export function releaseToken(sim: Sim, a: Actor): void {
  const en = a.en;
  if (!en || en.token === 0) return;
  const slot = sim.tokens.get(en.tokenTarget);
  if (slot) {
    const list = en.token === 2 ? slot.ranged : slot.melee;
    const i = list.indexOf(a.id);
    if (i >= 0) list.splice(i, 1);
    if (slot.melee.length === 0 && slot.ranged.length === 0) sim.tokens.delete(en.tokenTarget);
  }
  en.token = 0;
  en.tokenTarget = -1;
}

/** Frees every token held against a target (target downed or removed). */
export function releaseTokensOn(sim: Sim, target: number): void {
  const slot = sim.tokens.get(target);
  if (!slot) return;
  for (const id of [...slot.melee, ...slot.ranged]) {
    const holder = sim.actors.get(id);
    if (holder?.en) {
      holder.en.token = 0;
      holder.en.tokenTarget = -1;
    }
  }
  sim.tokens.delete(target);
}
