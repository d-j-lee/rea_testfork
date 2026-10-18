// Enemy AI: idle → alert (sight or hit) → chase → attack → reposition, with
// per-target attack tokens (3 melee + 2 ranged); token-less enemies circle
// to flank. Behaviours: melee, brute, archer (keeps 4–7 tiles), charger
// (0.8 s telegraphed dash), shield (front −70%), musket (group volleys, 4 s
// reload), rifle (range + cover shifts), beast (pounce) and boss.
import { lineOfSight, moveBody, terrainSpeed } from "./physics.ts";
import { applyKnock } from "./combat.ts";
import { acquireToken, releaseToken, removeActor } from "./entities.ts";
import { startCharge, startCleave, startLine, startShoot, startSlam, startSwing, tickAction } from "./actions.ts";
import { bossMechanic, bossPhases } from "./boss.ts";
import { clampArena } from "./battle.ts";
import { C, face, locomotion, targetable, turnToward, type Actor, type EnemyData, type Sim } from "./state.ts";

export const isRanged = (e: EnemyData): boolean => {
  const b = e.def.behavior;
  return b === "archer" || b === "musket" || b === "rifle" || (b === "boss" && e.def.range >= 4);
};

const lunger = (e: EnemyData): boolean => e.def.behavior === "charger" || e.def.behavior === "beast";

function engageRange(e: EnemyData): number {
  if (isRanged(e)) return e.def.range + 1;
  return lunger(e) ? 8 : e.def.range + 2.5;
}

export function tickEnemy(sim: Sim, a: Actor, dt: number): void {
  const e = a.en;
  if (!e || !a.alive) return;
  const t = sim.time;
  const ox = a.x;
  const oy = a.y;
  applyKnock(sim, a, dt);
  if (a.stunUntil > t) a.moving = false;
  else {
    if (e.stunned) {
      e.stunned = false;
      e.poise = e.maxPoise;
    }
    if (t - a.lastHurt > 3 && e.poise < e.maxPoise) e.poise = Math.min(e.maxPoise, e.poise + e.maxPoise * 0.25 * dt);
    if (e.boss) bossPhases(sim, a);
    behave(sim, a, e, dt);
  }
  if (!a.removed) {
    if (e.state !== "flee") clampArena(sim, a, ox, oy);
    locomotion(sim, a);
    sim.index.update(a);
  }
}

function behave(sim: Sim, a: Actor, e: EnemyData, dt: number): void {
  const t = sim.time;
  if (e.state === "flee") {
    steer(sim, a, a.x * 2 - e.goalX, a.y * 2 - e.goalY, e.def.speed * 1.2, dt, 0, true);
    if (t >= e.fleeUntil) removeActor(sim, a);
    return;
  }
  if (e.act) {
    tickAction(sim, a, dt);
    return;
  }
  if (a.fearUntil > t) {
    steer(sim, a, a.x * 2 - a.fearX, a.y * 2 - a.fearY, e.def.speed, dt, 0, true);
    return;
  }
  if (t >= e.thinkAt) {
    e.thinkAt = t + 0.2;
    think(sim, a, e);
  }
  const speed = e.def.speed * e.speedMul;
  switch (e.state) {
    case "idle":
      if (t >= e.wanderAt) {
        e.wanderAt = t + sim.rng.range(3, 6);
        e.goalX = e.homeX + sim.rng.range(-2, 2);
        e.goalY = e.homeY + sim.rng.range(-2, 2);
      }
      steer(sim, a, e.goalX, e.goalY, speed * 0.35, dt, 0.2, true);
      break;
    case "leash":
      a.invulnUntil = t + 0.25;
      steer(sim, a, e.homeX, e.homeY, speed * 1.3, dt, 0.3, true);
      if (Math.hypot(a.x - e.homeX, a.y - e.homeY) < 0.6) {
        e.state = "idle";
        a.hp = a.maxHp;
        a.burnUntil = 0;
        e.credit = [];
        e.poise = e.maxPoise;
      }
      break;
    case "alert": {
      a.moving = false;
      const tgt = sim.actors.get(e.target);
      if (tgt) face(a, tgt.x - a.x, tgt.y - a.y);
      if (t >= e.alertUntil) e.state = "chase";
      break;
    }
    case "reposition": {
      const tgt = sim.actors.get(e.target);
      steer(sim, a, e.goalX, e.goalY, speed * 0.9, dt, 0.2, false);
      if (tgt) face(a, tgt.x - a.x, tgt.y - a.y);
      if (t >= e.goalUntil || !a.moving) e.state = "chase";
      break;
    }
    case "chase":
      engage(sim, a, e, dt);
      break;
  }
  separate(sim, a);
}

// ── Perception and targeting ─────────────────────────────────────────────

function validTarget(sim: Sim, a: Actor, e: EnemyData, id: number): Actor | null {
  const b = sim.actors.get(id);
  if (!b || !targetable(b)) return null;
  const battle = sim.battle;
  if (battle && e.battle && battle.def.kind === "duel" && b.id !== battle.starter) return null;
  if (!e.battle && Math.hypot(b.x - a.x, b.y - a.y) > e.def.sight * 2.5) return null;
  return b;
}

function pickTarget(sim: Sim, a: Actor, e: EnemyData, radius: number): Actor | null {
  const battle = sim.battle;
  if (battle && e.battle) {
    if (battle.def.kind === "duel") {
      const s = sim.actors.get(battle.starter);
      return s && targetable(s) ? s : null;
    }
    const guard = battle.defendId >= 0 ? sim.actors.get(battle.defendId) : undefined;
    if (guard?.alive) return sim.index.nearest(a.x, a.y, 3, (b) => targetable(b) && !b.defend) ?? guard;
  }
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const b of sim.index.query(a.x, a.y, radius, targetable)) {
    if (b.defend && !e.battle) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < bestD || (d === bestD && best !== null && b.id < best.id)) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function think(sim: Sim, a: Actor, e: EnemyData): void {
  const t = sim.time;
  if (e.state === "leash") return;
  if (e.leash && Math.hypot(a.x - e.homeX, a.y - e.homeY) > C.LEASH) {
    e.state = "leash";
    e.target = -1;
    releaseToken(sim, a);
    return;
  }
  const sight = e.battle ? 40 : e.def.sight;
  let tgt = validTarget(sim, a, e, e.target);
  if (!tgt) tgt = pickTarget(sim, a, e, e.state === "idle" ? sight : sight * 1.5);
  else if (e.token === 0 && !e.boss && !e.battle) {
    const d = Math.hypot(tgt.x - a.x, tgt.y - a.y);
    if (d > 3) tgt = pickTarget(sim, a, e, d - 2) ?? tgt;
  }
  if (!tgt) {
    if (e.state !== "idle") {
      e.state = "idle";
      releaseToken(sim, a);
      if (!e.leash) {
        e.homeX = a.x;
        e.homeY = a.y;
      }
    }
    e.target = -1;
    return;
  }
  if (tgt.id !== e.target) {
    releaseToken(sim, a);
    e.target = tgt.id;
  }
  if (e.state === "idle") {
    e.state = "alert";
    e.alertUntil = t + (e.battle ? 0.15 : 0.4);
    a.markUntil = t + 0.9;
    alertPack(sim, a, tgt);
  }
  const d = Math.hypot(tgt.x - a.x, tgt.y - a.y);
  e.los = d < 1.5 || lineOfSight(sim.grid, a.x, a.y, tgt.x, tgt.y);
  if (e.boss) return;
  const reach = engageRange(e);
  if (e.token === 0) {
    if (d <= reach) acquireToken(sim, a, tgt.id, isRanged(e));
  } else if (d > reach + 1.5) releaseToken(sim, a);
}

/** Nearby idle allies of an alerted enemy join in (sound radius 4). */
function alertPack(sim: Sim, a: Actor, tgt: Actor): void {
  for (const b of sim.index.query(a.x, a.y, 4)) {
    const be = b.en;
    if (!be || b === a || !b.alive || be.state !== "idle") continue;
    be.state = "alert";
    be.target = tgt.id;
    be.alertUntil = sim.time + 0.3;
    b.markUntil = sim.time + 0.9;
  }
}

// ── Behaviours ───────────────────────────────────────────────────────────

function engage(sim: Sim, a: Actor, e: EnemyData, dt: number): void {
  const tgt = validTarget(sim, a, e, e.target);
  if (!tgt) {
    a.moving = false;
    return;
  }
  const t = sim.time;
  const d = Math.hypot(tgt.x - a.x, tgt.y - a.y);
  const speed = e.def.speed * e.speedMul;
  const ready = t >= e.nextAttackAt;
  if (e.boss) {
    if (e.boss.guard) turnToward(a, tgt.x, tgt.y, 1.5 * dt);
    else face(a, tgt.x - a.x, tgt.y - a.y);
    if (bossMechanic(sim, a, tgt)) return;
    if (isRanged(e)) {
      gunner(sim, a, e, tgt, d, speed, dt, true);
      return;
    }
    const reach = e.def.range + tgt.radius;
    if (d <= reach + 0.2 && ready) {
      if (sim.rng.chance(0.4)) startCleave(sim, a, tgt);
      else startSwing(sim, a, tgt, 0.35, 1.1);
      return;
    }
    steer(sim, a, tgt.x, tgt.y, speed, dt, reach * 0.7, false);
    return;
  }
  switch (e.def.behavior) {
    case "archer":
      archer(sim, a, e, tgt, d, speed, dt, ready);
      return;
    case "musket":
      musket(sim, a, e, tgt, d, speed, dt, ready);
      return;
    case "rifle":
      gunner(sim, a, e, tgt, d, speed, dt, false);
      return;
    default:
      melee(sim, a, e, tgt, d, speed, dt, ready);
  }
}

function melee(sim: Sim, a: Actor, e: EnemyData, tgt: Actor, d: number, speed: number, dt: number, ready: boolean): void {
  const t = sim.time;
  const b = e.def.behavior;
  if (b === "shield") turnToward(a, tgt.x, tgt.y, 5 * dt);
  else face(a, tgt.x - a.x, tgt.y - a.y);
  if (e.token === 0) {
    // No token: circle to a flanking spot around the target.
    const ang = Math.atan2(a.y - tgt.y, a.x - tgt.x) + e.flank * 0.35;
    const ring = 2.6 + (a.id % 3) * 0.35;
    steer(sim, a, tgt.x + Math.cos(ang) * ring, tgt.y + Math.sin(ang) * ring, speed * 0.8, dt, 0.15, false);
    return;
  }
  if (lunger(e) && t >= e.nextSpecialAt && e.los) {
    const charger = b === "charger";
    if (d >= (charger ? 2.5 : 2) && d <= (charger ? 7.5 : 5)) {
      startCharge(sim, a, tgt, charger
        ? { speed: 14, coef: 1.8, n: 1, ms: 800, maxDist: 8 }
        : { speed: 12, coef: 1.4, n: 1, ms: 450, maxDist: 5.5 });
      e.nextSpecialAt = t + (charger ? 5 : 4) + sim.rng.range(0, 2);
      return;
    }
  }
  const reach = e.def.range + tgt.radius;
  if (d <= reach + 0.15 && ready) {
    if (b === "brute") startSlam(sim, a, tgt);
    else startSwing(sim, a, tgt, b === "beast" ? 0.25 : b === "shield" ? 0.4 : 0.32);
    return;
  }
  steer(sim, a, tgt.x, tgt.y, speed * (b === "shield" ? 0.85 : 1), dt, reach * 0.75, false);
}

function archer(sim: Sim, a: Actor, e: EnemyData, tgt: Actor, d: number, speed: number, dt: number, ready: boolean): void {
  const t = sim.time;
  face(a, tgt.x - a.x, tgt.y - a.y);
  const far = Math.min(7, e.def.range);
  if (e.token !== 0 && ready && e.los && d <= e.def.range + 0.5 && d >= 1.2) {
    startShoot(sim, a, tgt);
    return;
  }
  if (!e.los || d > far) steer(sim, a, tgt.x, tgt.y, speed, dt, far - 0.5, false);
  else if (d < 4) steer(sim, a, a.x * 2 - tgt.x, a.y * 2 - tgt.y, speed * 0.9, dt, 0, false);
  else {
    if (t >= e.goalUntil) {
      e.strafe = -e.strafe;
      e.goalUntil = t + sim.rng.range(1.2, 2.4);
    }
    const px = -(tgt.y - a.y) / d;
    const py = (tgt.x - a.x) / d;
    steer(sim, a, a.x + px * e.strafe * 2, a.y + py * e.strafe * 2, speed * 0.4, dt, 0, false);
  }
}

function musket(sim: Sim, a: Actor, e: EnemyData, tgt: Actor, d: number, speed: number, dt: number, ready: boolean): void {
  const t = sim.time;
  face(a, tgt.x - a.x, tgt.y - a.y);
  if (t < e.reloadUntil) {
    a.moving = false;
    return;
  }
  if (!e.los || d > e.def.range - 0.5) {
    steer(sim, a, tgt.x, tgt.y, speed, dt, e.def.range - 1, false);
    return;
  }
  a.moving = false;
  if (e.token === 0 || !ready) return;
  // Volley: up to four ready musketeers nearby fire together.
  const group: { m: Actor; target: Actor }[] = [{ m: a, target: tgt }];
  for (const m of sim.index.query(a.x, a.y, 6, (b) => b !== a && b.alive && b.en?.def.behavior === "musket")) {
    if (group.length >= 4) break;
    const me = m.en;
    if (!me || me.act || m.stunUntil > t || m.fearUntil > t || t < me.reloadUntil) continue;
    if (me.state === "flee" || me.state === "leash" || me.state === "idle") continue;
    const mt = validTarget(sim, m, me, me.target) ?? tgt;
    if (Math.hypot(mt.x - m.x, mt.y - m.y) > me.def.range + 1) continue;
    group.push({ m, target: mt });
  }
  for (const g of group) startLine(sim, g.m, g.target, 1000, 1, true);
}

function gunner(sim: Sim, a: Actor, e: EnemyData, tgt: Actor, d: number, speed: number, dt: number, boss: boolean): void {
  const t = sim.time;
  if (!boss) face(a, tgt.x - a.x, tgt.y - a.y);
  const far = e.def.range - 1;
  if (t >= e.nextAttackAt && (e.token !== 0 || boss) && e.los && d <= e.def.range) {
    startLine(sim, a, tgt, boss ? 500 : 450, boss ? 1.2 : 1, boss);
    return;
  }
  if (!e.los || d > far) steer(sim, a, tgt.x, tgt.y, speed, dt, far - 0.5, false);
  else if (d < 5) steer(sim, a, a.x * 2 - tgt.x, a.y * 2 - tgt.y, speed * 0.8, dt, 0, false);
  else a.moving = false;
}

// ── Locomotion ───────────────────────────────────────────────────────────

/** Moves toward a goal, sliding on walls and detouring when stuck. */
function steer(sim: Sim, a: Actor, gx: number, gy: number, speed: number, dt: number, stop: number, faceMove: boolean): void {
  const e = a.en;
  if (!e) return;
  const t = sim.time;
  let dx = gx - a.x;
  let dy = gy - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= stop + 1e-3) {
    a.moving = false;
    return;
  }
  dx /= d;
  dy /= d;
  if (e.detourUntil > t) {
    dx = e.detourX;
    dy = e.detourY;
  }
  const step = Math.min(speed * terrainSpeed(sim.grid, a.x, a.y) * dt, Math.max(0.02, d - stop));
  const px = a.x;
  const py = a.y;
  moveBody(sim.grid, a, dx * step, dy * step);
  a.moving = true;
  if (faceMove) face(a, dx, dy);
  const moved = Math.hypot(a.x - px, a.y - py);
  if (moved < step * 0.3) {
    e.stuck += dt;
    if (e.stuck > 0.35) {
      const side = sim.rng.chance(0.5) ? 1 : -1;
      e.detourX = -dy * side;
      e.detourY = dx * side;
      e.detourUntil = t + sim.rng.range(0.5, 0.9);
      e.stuck = 0;
    }
  } else e.stuck = Math.max(0, e.stuck - dt);
}

/** Soft separation between enemies so packs spread instead of stacking. */
function separate(sim: Sim, a: Actor): void {
  for (const b of sim.index.query(a.x, a.y, 0.6)) {
    if (b === a || !b.en || !b.alive) continue;
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d >= 0.55) continue;
    if (d < 1e-4) {
      const ang = (a.id * 2.399) % (Math.PI * 2);
      dx = Math.cos(ang);
      dy = Math.sin(ang);
    } else {
      dx /= d;
      dy /= d;
    }
    const push = (0.55 - d) * 0.5;
    moveBody(sim.grid, a, dx * push, dy * push);
  }
}
