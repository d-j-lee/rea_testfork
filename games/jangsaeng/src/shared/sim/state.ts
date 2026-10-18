// Shared simulation state: actor records, timing constants, the FX buffer and
// the deferred hook queue. Every sim module operates on one Sim value owned
// by the World facade. Units are tiles and seconds; all randomness comes from
// sim.rng so a seed plus the same inputs replays identically.
import type { ContentIndex } from "../content/index.ts";
import type { BossDef, BossPhase, ChapterDef, EnemyDef, SpawnDef } from "../content/schema.ts";
import type { GameMap, Site } from "../map/generate.ts";
import type { Rng } from "../rng.ts";
import type { Derived } from "../rules/index.ts";
import type { Anim, BodyVariant, Dir, SpriteKey } from "../sprites.ts";
import type { EntityKind, FxEvent, Telegraph } from "../types.ts";
import type { CollisionGrid } from "./physics.ts";
import type { SpatialIndex } from "./spatial.ts";
import type { BattleRuntime } from "./battle.ts";
import type { PlayerInput, WorldHooks } from "./world.ts";

/** Binding combat numbers (design §4.2). */
export const C = {
  BODY: 0.3,
  INTEREST: 24,
  CORPSE: 1.2,
  MELEE_TIME: [0.3, 0.3, 0.45] as const,
  MELEE_COEF: [1.0, 1.0, 1.6] as const,
  MELEE_HIT_DELAY: [0.1, 0.1, 0.15] as const,
  MELEE_RANGE: 1.3,
  MELEE_HALF_ARC: (55 * Math.PI) / 180,
  COMBO_WINDOW: 0.35,
  BOW_RANGE: 9,
  ARROW_SPEED: 14,
  QUICK_SHOT: 0.25,
  FULL_DRAW: 1.0,
  BOW_MIN: 0.6,
  BOW_MAX: 1.5,
  PERFECT_SHOT: [0.65, 0.8] as const,
  PERFECT_SHOT_COEF: 2.0,
  BOW_REARM: 0.3,
  ROLL_TIME: 0.32,
  ROLL_DIST: 3.5,
  IFRAME_FROM: 0.04,
  IFRAME_TO: 0.22,
  PERFECT_DODGE: 0.12,
  ROLL_COST: 25,
  STAMINA_MAX: 100,
  STAMINA_REGEN: 30,
  STAMINA_DELAY: 0.5,
  ENERGY_PER_HIT: 4,
  LONGEVITY_RADIUS: 12,
  LONGEVITY_INVULN: 5,
  REVIVE_RANGE: 1.3,
  REVIVE_TIME: 2,
  REVIVE_HP: 0.4,
  SELF_REVIVE_HP: 0.5,
  TALK_RANGE: 1.6,
  LEASH: 12,
  STUN: 2,
  STUN_BONUS: 1.3,
  GRACE: 0.05,
  TOKENS_MELEE: 3,
  TOKENS_RANGED: 2,
  CREDIT_SECONDS: 10,
  CRIT: 1.6,
  /** World-internal ids stay below the host's player id range. */
  MAX_INTERNAL_ID: 999_999,
} as const;

export const COLOR = {
  normal: "#ffffff",
  crit: "#ffd84a",
  hurt: "#ff5a4a",
  heal: "#7dff8a",
  burn: "#ff9a3c",
  block: "#b8c0c8",
  dodge: "#9ad8ff",
  perfect: "#e2b23a",
  phase: "#ffe7a0",
} as const;

export type Side = "friend" | "foe" | "none";
export type DamageKind = "melee" | "bow" | "skill" | "plain";
export type SfxName =
  | "swing" | "hit" | "hit_heavy" | "crit" | "bow" | "arrow_hit" | "gun" | "cannon"
  | "explosion" | "hurt" | "death" | "enemy_death" | "block" | "pickup" | "skill" | "heal";

export type PlayerCast =
  | { k: "dash"; end: number; dx: number; dy: number; speed: number; left: number; coef: number; hit: number[] }
  | { k: "spin"; next: number; left: number; total: number; interval: number; radius: number; coef: number }
  | { k: "aim"; fireAt: number; dx: number; dy: number; range: number; coef: number };

export interface PlayerData {
  bot: boolean;
  derived: Derived;
  skills: string[];
  input: PlayerInput;
  tapAttack: boolean;
  tapShot: boolean;
  dodgeHeld: boolean;
  pendingDodge: boolean;
  pendingSkill: number;
  pendingInteract: boolean;
  energy: number;
  stamina: number;
  staminaAt: number;
  combo: number;
  swingStart: number;
  swingEnd: number;
  swingHitAt: number;
  swingHit: boolean;
  comboUntil: number;
  drawStart: number;
  bowReadyAt: number;
  rollStart: number;
  rollEnd: number;
  rollLeft: number;
  rollX: number;
  rollY: number;
  perfectUsed: boolean;
  /** Next landed hit is a guaranteed crit (perfect dodge). */
  critNext: boolean;
  ready: Map<string, number>;
  longevityAt: number;
  longevityEnabled: boolean;
  cast: PlayerCast | null;
  parryUntil: number;
  downedAt: number;
  downEnd: number;
  revive: number;
  lastCombat: number;
}

export type AiState = "idle" | "alert" | "chase" | "reposition" | "leash" | "flee";

export interface EnemyAction {
  k: "swing" | "slam" | "cleave" | "shoot" | "line" | "charge" | "spin" | "cast" | "volley";
  end: number;
  at: number;
  done: boolean;
  x: number;
  y: number;
  tx: number;
  ty: number;
  r: number;
  coef: number;
  heavy: boolean;
  dx: number;
  dy: number;
  dist: number;
  moved: number;
  speed: number;
  hit: number[];
  /** Remaining repeats (charge chains, spin hits). */
  n: number;
}

export interface BossState {
  def: BossDef;
  phases: BossPhase[];
  phase: number;
  nextMechAt: number;
  rotation: number;
  guard: boolean;
  frenzy: boolean;
  summons: number[];
}

export interface EnemyData {
  def: EnemyDef;
  level: number;
  atk: number;
  state: AiState;
  target: number;
  homeX: number;
  homeY: number;
  leash: boolean;
  thinkAt: number;
  nextAttackAt: number;
  nextSpecialAt: number;
  act: EnemyAction | null;
  poise: number;
  maxPoise: number;
  stunned: boolean;
  /** 0 none, 1 melee, 2 ranged. */
  token: 0 | 1 | 2;
  tokenTarget: number;
  flank: number;
  goalX: number;
  goalY: number;
  goalUntil: number;
  alertUntil: number;
  wanderAt: number;
  /** Player ids with the time of their last hit, most recent first. */
  credit: { id: number; at: number }[];
  spawn: number;
  battle: boolean;
  wave: number;
  boss: BossState | null;
  fleeUntil: number;
  speedMul: number;
  cdMul: number;
  reloadUntil: number;
  lastX: number;
  lastY: number;
  stuck: number;
  detourUntil: number;
  detourX: number;
  detourY: number;
  strafe: number;
  /** Line of sight to the target at the last think. */
  los: boolean;
}

export interface FighterData {
  anchorX: number;
  anchorY: number;
  atk: number;
  range: number;
  ranged: boolean;
  cooldown: number;
  nextAt: number;
  thinkAt: number;
  target: number;
  speed: number;
  /** NPC fighters only fight while their site's battle is active. */
  active: boolean;
}

export interface Actor {
  readonly id: number;
  readonly kind: EntityKind;
  side: Side;
  x: number;
  y: number;
  radius: number;
  fx: number;
  fy: number;
  dir: Dir;
  anim: Anim;
  animAt: number;
  animUntil: number;
  moving: boolean;
  hp: number;
  maxHp: number;
  def: number;
  alive: boolean;
  removed: boolean;
  diedAt: number;
  removeAt: number;
  sprite: SpriteKey;
  name: string;
  title: string | undefined;
  level: number;
  variant: BodyVariant | undefined;
  hist: boolean;
  invulnUntil: number;
  stunUntil: number;
  fearUntil: number;
  fearX: number;
  fearY: number;
  buffUntil: number;
  burnUntil: number;
  burnDps: number;
  burnNext: number;
  burnOwner: number;
  kx: number;
  ky: number;
  immortal: boolean;
  lastHurt: number;
  markUntil: number;
  /** NPCs face their talker until this time. */
  lookUntil: number;
  pl: PlayerData | null;
  en: EnemyData | null;
  fi: FighterData | null;
  npcId: string | null;
  item: string | null;
  defend: boolean;
}

export interface HitSource {
  owner: number;
  side: Side;
  power: number;
  crit: number;
  player: boolean;
  x: number;
  y: number;
}

export interface Projectile {
  src: HitSource;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  left: number;
  coef: number;
  pierce: boolean;
  hit: number[];
  burn: number;
  blast: number;
  heavy: boolean;
  forceCrit: boolean;
  kind: "arrow" | "rocket";
  dkind: DamageKind;
}

export interface Strike {
  at: number;
  src: HitSource;
  shape: "circle" | "line";
  x: number;
  y: number;
  r: number;
  tx: number;
  ty: number;
  coef: number;
  heavy: boolean;
  knock: number;
  burn: number;
  /** Seconds of lingering fire left behind (0 none). */
  fire: number;
  fx: "none" | "explosion" | "rocket" | "bullet";
  pierce: boolean;
  dkind: DamageKind;
  /** Cancelled when the owner's current action is no longer this one. */
  bind: EnemyAction | null;
}

export interface Hazard {
  x: number;
  y: number;
  r: number;
  until: number;
  next: number;
  fxNext: number;
  src: HitSource;
  coef: number;
}

export interface SpawnRuntime {
  def: SpawnDef;
  index: number;
  cx: number;
  cy: number;
  active: boolean;
  slots: { id: number; respawnAt: number }[];
}

export interface Sim {
  readonly content: ContentIndex;
  readonly chapter: ChapterDef;
  readonly map: GameMap;
  grid: CollisionGrid;
  year: number;
  readonly rng: Rng;
  readonly hooks: WorldHooks;
  time: number;
  nextId: number;
  readonly actors: Map<number, Actor>;
  readonly index: SpatialIndex<Actor>;
  readonly projectiles: Projectile[];
  readonly strikes: Strike[];
  readonly hazards: Hazard[];
  readonly delayed: { at: number; e: FxEvent }[];
  readonly fx: FxEvent[];
  readonly events: (() => void)[];
  /** Per-tick strongest hitstop/shake per source, flushed into fx. */
  readonly feel: Map<number, { x: number; y: number; stop: number; shake: number }>;
  readonly tokens: Map<number, { melee: number[]; ranged: number[] }>;
  readonly spawns: SpawnRuntime[];
  readonly npcs: Map<string, number>;
  readonly sites: Map<string, Site>;
  readonly players: Map<number, Actor>;
  battle: BattleRuntime | null;
  stepIndex: number;
}

// ── Geometry ─────────────────────────────────────────────────────────────

export function dirOf(x: number, y: number): Dir {
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y < 0 ? "up" : "down";
}

export function face(a: Actor, dx: number, dy: number): void {
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return;
  a.fx = dx / length;
  a.fy = dy / length;
  a.dir = dirOf(a.fx, a.fy);
}

/** Turns facing toward a point by at most `maxRad` radians. */
export function turnToward(a: Actor, tx: number, ty: number, maxRad: number): void {
  const want = Math.atan2(ty - a.y, tx - a.x);
  const have = Math.atan2(a.fy, a.fx);
  let delta = want - have;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const step = Math.max(-maxRad, Math.min(maxRad, delta));
  face(a, Math.cos(have + step), Math.sin(have + step));
}

/** True when (sx, sy) lies within `half` radians of the actor's facing. */
export function inFront(a: Actor, sx: number, sy: number, half: number): boolean {
  const dx = sx - a.x;
  const dy = sy - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return true;
  return (dx * a.fx + dy * a.fy) / length >= Math.cos(half);
}

export const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const angleOf = (x: number, y: number): number => Math.atan2(y, x);

// ── Animation ────────────────────────────────────────────────────────────

export function setAnim(sim: Sim, a: Actor, anim: Anim, until = 0): void {
  if (a.anim !== anim) {
    a.anim = anim;
    a.animAt = sim.time;
  }
  a.animUntil = until;
}

/** Restarts an animation even if it is already playing (combo swings). */
export function playAnim(sim: Sim, a: Actor, anim: Anim, until: number): void {
  a.anim = anim;
  a.animAt = sim.time;
  a.animUntil = until;
}

/** Idle/walk once any timed animation has finished. */
export function locomotion(sim: Sim, a: Actor): void {
  if (a.anim === "dead" || sim.time < a.animUntil) return;
  setAnim(sim, a, a.moving ? "walk" : "idle");
}

// ── FX ───────────────────────────────────────────────────────────────────

const q = (v: number): number => Math.round(v * 100) / 100;

export function emit(sim: Sim, e: FxEvent): void {
  e.x = q(e.x);
  e.y = q(e.y);
  if (e.tx !== undefined) e.tx = q(e.tx);
  if (e.ty !== undefined) e.ty = q(e.ty);
  if (e.angle !== undefined) e.angle = q(e.angle);
  sim.fx.push(e);
}

export function sound(sim: Sim, name: SfxName, x: number, y: number): void {
  emit(sim, { k: "sfx", sfx: name, x, y });
}

export function floatText(sim: Sim, x: number, y: number, text: string, color: string, crit = false): void {
  const e: FxEvent = { k: "text", x, y, text, color };
  if (crit) e.crit = true;
  emit(sim, e);
}

export function telegraph(sim: Sim, tg: Telegraph): void {
  const shape: Telegraph =
    tg.shape === "line"
      ? { ...tg, x: q(tg.x), y: q(tg.y), tx: q(tg.tx), ty: q(tg.ty) }
      : tg.shape === "circle"
        ? { ...tg, x: q(tg.x), y: q(tg.y), r: q(tg.r) }
        : { ...tg, x: q(tg.x), y: q(tg.y), angle: q(tg.angle), r: q(tg.r) };
  emit(sim, { k: "telegraph", x: tg.x, y: tg.y, tg: shape });
}

/** Queues hitstop/shake; only the strongest per source and tick is sent. */
export function feel(sim: Sim, source: number, x: number, y: number, stopMs: number, shakePx: number): void {
  const current = sim.feel.get(source);
  if (!current) sim.feel.set(source, { x, y, stop: stopMs, shake: shakePx });
  else {
    current.stop = Math.max(current.stop, stopMs);
    current.shake = Math.max(current.shake, shakePx);
  }
}

export function flushFeel(sim: Sim): void {
  for (const f of sim.feel.values()) {
    if (f.stop > 0) emit(sim, { k: "hitstop", x: f.x, y: f.y, power: f.stop });
    if (f.shake > 0) emit(sim, { k: "shake", x: f.x, y: f.y, power: f.shake });
  }
  sim.feel.clear();
}

export function delayFx(sim: Sim, at: number, e: FxEvent): void {
  if (at <= sim.time) emit(sim, e);
  else sim.delayed.push({ at, e });
}

/** Defers a hook call to the end of the current tick (re-entrancy safety). */
export function later(sim: Sim, call: () => void): void {
  sim.events.push(call);
}

export function flushEvents(sim: Sim): void {
  // Hooks may enqueue more work (e.g. start a battle); drain until empty.
  for (let i = 0; i < sim.events.length; i++) (sim.events[i] as () => void)();
  sim.events.length = 0;
}

// ── Queries ──────────────────────────────────────────────────────────────

export const isDowned = (a: Actor): boolean => a.pl !== null && a.pl.downedAt >= 0;

/** Friendly actor enemies may target (alive, standing, actually fighting). */
export function targetable(a: Actor): boolean {
  if (!a.alive || a.removed || a.side !== "friend") return false;
  if (a.pl) return a.pl.downedAt < 0;
  if (a.fi) return a.fi.active;
  return a.defend;
}

/** Hostile actor players may hit. */
export const hostile = (a: Actor): boolean => a.alive && !a.removed && a.side === "foe";

export const isRolling = (sim: Sim, a: Actor): boolean => a.pl !== null && sim.time < a.pl.rollEnd;
