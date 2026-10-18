// Boss phases (BossDef.phases by HP threshold) and their mechanics:
// charge, spin, summon, guard_front, fire_zone, volley, cannon, frenzy and
// shield_wall. Phase lines appear as FX text with a shout and a big shake.
import type { BossDef, BossPhase, EnemyDef } from "../content/schema.ts";
import { startCast, startCharge, startSpin, startVolley } from "./actions.ts";
import { arenaSpot } from "./arena.ts";
import { sourceOf } from "./combat.ts";
import { spawnEnemy } from "./entities.ts";
import { schedule } from "./projectiles.ts";
import {
  COLOR,
  delayFx,
  emit,
  floatText,
  sound,
  targetable,
  telegraph,
  type Actor,
  type BossState,
  type Sim,
} from "./state.ts";

type Mechanic = BossPhase["mechanic"];
const ACTIVE: readonly Mechanic[] = ["charge", "spin", "fire_zone", "volley", "cannon", "summon"];

export function makeBossState(def: BossDef): BossState {
  return {
    def,
    phases: [...def.phases].sort((p, q) => q.at - p.at),
    phase: -1,
    nextMechAt: 0,
    rotation: 0,
    guard: false,
    frenzy: false,
    summons: [],
  };
}

/** Enters every phase whose HP threshold has been reached. */
export function bossPhases(sim: Sim, a: Actor): void {
  const b = a.en?.boss;
  if (!b || !a.alive) return;
  const ratio = a.hp / a.maxHp;
  for (;;) {
    const next = b.phases[b.phase + 1];
    if (!next || ratio > next.at + 1e-9) break;
    b.phase++;
    enterPhase(sim, a, b, next, b.phase > 0 || next.at < 1);
  }
}

function enterPhase(sim: Sim, a: Actor, b: BossState, phase: BossPhase, transition: boolean): void {
  const e = a.en;
  if (!e) return;
  const t = sim.time;
  // The newest phase's mechanic leads the rotation.
  b.rotation = 0;
  b.guard = phase.mechanic === "guard_front";
  b.frenzy = phase.mechanic === "frenzy";
  e.speedMul = b.frenzy ? 1.35 : 1;
  e.cdMul = b.frenzy ? 0.6 : 1;
  if (phase.line) floatText(sim, a.x, a.y, phase.line, COLOR.phase, true);
  emit(sim, { k: "shout", x: a.x, y: a.y, power: 4 });
  if (transition) {
    emit(sim, { k: "hitstop", x: a.x, y: a.y, power: 140 });
    emit(sim, { k: "shake", x: a.x, y: a.y, power: 8 });
    sound(sim, "hit_heavy", a.x, a.y);
    startCast(sim, a, 0.6);
  }
  if (b.frenzy) emit(sim, { k: "fire", x: a.x, y: a.y, power: 1 });
  if (phase.mechanic === "summon") summon(sim, a, phase);
  if (phase.mechanic === "shield_wall") shieldWall(sim, a, phase);
  b.nextMechAt = t + 1.4;
}

function summonDef(sim: Sim, phase: BossPhase, fallback: EnemyDef["behavior"]): { def: EnemyDef; count: number } | null {
  if (phase.summon) {
    const def = sim.content.enemies[phase.summon.enemy];
    return def ? { def, count: phase.summon.count } : null;
  }
  const def = Object.values(sim.content.enemies).find((d) => d.behavior === fallback);
  return def ? { def, count: 4 } : null;
}

function addMinion(sim: Sim, a: Actor, def: EnemyDef, x: number, y: number): void {
  const b = a.en?.boss;
  if (!b || !a.en) return;
  // A battle boss calls its men onto the arena's ground, never into a walled pocket.
  const arena = a.en.battle ? sim.battle?.arena : undefined;
  const at = arena ? arenaSpot(arena, x, y) : { x, y };
  const m = spawnEnemy(sim, def, at.x, at.y, { level: Math.max(1, b.def.level - 1), battle: a.en.battle, leash: a.en.leash });
  if (m.en) {
    m.en.state = "chase";
    m.en.target = a.en.target;
  }
  b.summons.push(m.id);
  if (a.en.battle) sim.battle?.enemies.push(m.id);
  emit(sim, { k: "smoke", x: m.x, y: m.y });
}

function liveSummons(sim: Sim, b: BossState): number {
  b.summons = b.summons.filter((id) => sim.actors.get(id)?.alive === true);
  return b.summons.length;
}

function summon(sim: Sim, a: Actor, phase: BossPhase): void {
  const s = summonDef(sim, phase, "melee");
  if (!s) return;
  const count = Math.max(1, Math.round(s.count * (sim.battle?.countScale ?? 1)));
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + sim.rng.range(-0.3, 0.3);
    addMinion(sim, a, s.def, a.x + Math.cos(ang) * 2, a.y + Math.sin(ang) * 2);
  }
  sound(sim, "skill", a.x, a.y);
}

function shieldWall(sim: Sim, a: Actor, phase: BossPhase): void {
  const s = summonDef(sim, phase, "shield");
  if (!s) return;
  const count = Math.max(2, Math.round(s.count * (sim.battle?.countScale ?? 1)));
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * 0.9;
    addMinion(sim, a, s.def, a.x + a.fx * 1.6 - a.fy * off, a.y + a.fy * 1.6 + a.fx * off);
  }
}

/** Starts the next active mechanic when due; true when one began. */
export function bossMechanic(sim: Sim, a: Actor, tgt: Actor): boolean {
  const b = a.en?.boss;
  if (!b || sim.time < b.nextMechAt) return false;
  const list: BossPhase[] = [];
  for (let i = b.phase; i >= 0; i--) {
    const p = b.phases[i];
    if (p && ACTIVE.includes(p.mechanic) && !list.some((q) => q.mechanic === p.mechanic)) list.push(p);
  }
  const usable = list.filter((p) => p.mechanic !== "summon" || liveSummons(sim, b) < Math.max(1, p.summon?.count ?? 2));
  b.nextMechAt = sim.time + 6.5 * (b.frenzy ? 0.6 : 1);
  const phase = usable[b.rotation % Math.max(1, usable.length)];
  if (!phase) return false;
  b.rotation++;
  cast(sim, a, b, phase, tgt);
  return true;
}

function cast(sim: Sim, a: Actor, b: BossState, phase: BossPhase, tgt: Actor): void {
  const t = sim.time;
  switch (phase.mechanic) {
    case "charge":
      startCharge(sim, a, tgt, { speed: 16, coef: 2.0, n: b.frenzy ? 3 : 1, ms: 800, maxDist: 9 });
      return;
    case "spin":
      startSpin(sim, a, b.frenzy ? 3 : 2);
      return;
    case "volley":
      startVolley(sim, a, tgt);
      return;
    case "summon":
      startCast(sim, a, 0.5);
      summon(sim, a, phase);
      return;
    case "fire_zone": {
      const act = startCast(sim, a, 1.1);
      const src = sourceOf(sim, a, "plain");
      for (let i = 0; i < 3; i++) {
        const x = tgt.x + (i === 0 ? 0 : sim.rng.range(-2.5, 2.5));
        const y = tgt.y + (i === 0 ? 0 : sim.rng.range(-2.5, 2.5));
        telegraph(sim, { shape: "circle", x, y, r: 1.6, ms: 1000 });
        schedule(sim, { at: t + 1.05, src, x, y, r: 1.6, coef: 0.8, fire: 6, burn: 2, bind: act });
      }
      return;
    }
    case "cannon": {
      startCast(sim, a, 0.6);
      const src = sourceOf(sim, a, "plain");
      const points: { x: number; y: number }[] = sim.index
        .query(a.x, a.y, 14, targetable)
        .sort((p, q) => p.id - q.id)
        .slice(0, 4)
        .map((p) => ({ x: p.x + sim.rng.range(-0.5, 0.5), y: p.y + sim.rng.range(-0.5, 0.5) }));
      while (points.length < 4) points.push({ x: tgt.x + sim.rng.range(-3, 3), y: tgt.y + sim.rng.range(-3, 3) });
      for (const p of points) {
        const at = t + 1.2 + 0.05;
        telegraph(sim, { shape: "circle", x: p.x, y: p.y, r: 1.6, ms: 1200 });
        const flight = Math.max(0.3, Math.hypot(p.x - a.x, p.y - a.y) / 10.6);
        delayFx(sim, at - flight, { k: "cannonball", x: a.x, y: a.y, tx: p.x, ty: p.y });
        delayFx(sim, at - flight, { k: "sfx", sfx: "cannon", x: a.x, y: a.y });
        schedule(sim, { at, src, x: p.x, y: p.y, r: 1.6, coef: 1.6, heavy: true, fx: "explosion" });
      }
      return;
    }
    default:
      return;
  }
}
