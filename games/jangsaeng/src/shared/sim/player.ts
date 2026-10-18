// Player and companion-bot bodies: input latching, movement, the 3-hit melee
// chain, the charged bow, rolling with i-frames, interaction and the downed
// (사경) state with ally revives.
import { moveBody, terrainSpeed } from "./physics.ts";
import { applyKnock, hit, revivePlayer, sourceOf } from "./combat.ts";
import { makeActor } from "./entities.ts";
import { fireProjectile } from "./projectiles.ts";
import { aimDir, tickCast, useSkill, type Aim } from "./skills.ts";
import { clampArena } from "./battle.ts";
import { safeSpot } from "./population.ts";
import {
  C,
  emit,
  face,
  hostile,
  later,
  locomotion,
  playAnim,
  setAnim,
  sound,
  type Actor,
  type PlayerData,
  type Sim,
} from "./state.ts";
import type { PlayerInput, PlayerSpec } from "./world.ts";

const IDLE_INPUT: PlayerInput = { mx: 0, my: 0, attack: false, shoot: false, dodge: false, skill: 0, interact: false };

export function createPlayer(sim: Sim, spec: PlayerSpec): Actor {
  const at = safeSpot(sim, spec.x, spec.y);
  const a = makeActor(sim, {
    id: spec.id,
    kind: spec.kind,
    side: "friend",
    x: at.x,
    y: at.y,
    sprite: spec.sprite,
    name: spec.name,
    hp: spec.derived.maxHp,
    level: spec.level,
  });
  a.title = spec.title;
  a.variant = spec.variant;
  a.def = spec.derived.armorDef;
  const pl: PlayerData = {
    bot: spec.kind === "bot",
    derived: spec.derived,
    skills: [...spec.skills],
    input: IDLE_INPUT,
    tapAttack: false,
    tapShot: false,
    dodgeHeld: false,
    pendingDodge: false,
    pendingSkill: 0,
    pendingInteract: false,
    energy: spec.derived.maxEnergy,
    stamina: C.STAMINA_MAX,
    staminaAt: -99,
    combo: 0,
    swingStart: -99,
    swingEnd: -99,
    swingHitAt: -99,
    swingHit: true,
    comboUntil: -99,
    drawStart: -1,
    bowReadyAt: 0,
    rollStart: -99,
    rollEnd: -99,
    rollLeft: 0,
    rollX: 0,
    rollY: 1,
    perfectUsed: false,
    critNext: false,
    ready: new Map(),
    longevityAt: 0,
    longevityEnabled: true,
    cast: null,
    parryUntil: 0,
    downedAt: -1,
    downEnd: 0,
    revive: 0,
    lastCombat: -99,
  };
  a.pl = pl;
  sim.players.set(a.id, a);
  return a;
}

/** Latches edges so taps between ticks are never lost. */
export function applyInput(a: Actor, input: PlayerInput): void {
  const p = a.pl;
  if (!p) return;
  const prev = p.input;
  if (input.attack && !prev.attack) p.tapAttack = true;
  if (input.shoot && !prev.shoot && p.drawStart < 0) p.tapShot = true;
  if (input.dodge && !p.dodgeHeld) p.pendingDodge = true;
  p.dodgeHeld = input.dodge;
  if (input.skill !== 0) p.pendingSkill = input.skill;
  if (input.interact) p.pendingInteract = true;
  p.input = input;
}

/** Cancels in-flight actions (teleport, restore). */
export function resetActions(sim: Sim, a: Actor): void {
  const p = a.pl;
  if (!p) return;
  p.cast = null;
  p.drawStart = -1;
  p.swingEnd = Math.min(p.swingEnd, sim.time);
  p.swingHit = true;
  p.rollEnd = 0;
  p.tapAttack = false;
  p.tapShot = false;
  p.pendingDodge = false;
  p.pendingSkill = 0;
  p.pendingInteract = false;
  a.kx = 0;
  a.ky = 0;
}

function readAim(input: PlayerInput): Aim | null {
  const ax = input.ax;
  const ay = input.ay;
  if (ax === undefined || ay === undefined || !Number.isFinite(ax) || !Number.isFinite(ay)) return null;
  return Math.hypot(ax, ay) > 0.05 ? { x: ax, y: ay } : null;
}

export function tickPlayer(sim: Sim, a: Actor, dt: number): void {
  const p = a.pl;
  if (!p || !a.alive) return;
  const t = sim.time;
  if (p.downedAt >= 0) {
    tickDowned(sim, a, p, dt);
    return;
  }
  const d = p.derived;
  p.energy = Math.min(d.maxEnergy, p.energy + d.energyRegen * dt);
  if (t - p.staminaAt >= C.STAMINA_DELAY) p.stamina = Math.min(C.STAMINA_MAX, p.stamina + C.STAMINA_REGEN * dt);
  if (a.hp < a.maxHp && t - p.lastCombat > 10 && t - a.lastHurt > 10 && !sim.battle?.participants.includes(a.id))
    a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.01 * dt);
  const input = p.input;
  let mx = Number.isFinite(input.mx) ? Math.max(-1, Math.min(1, input.mx)) : 0;
  let my = Number.isFinite(input.my) ? Math.max(-1, Math.min(1, input.my)) : 0;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  const aim = readAim(input);
  const ox = a.x;
  const oy = a.y;
  applyKnock(sim, a, dt);

  if (p.pendingDodge) {
    p.pendingDodge = false;
    if (t >= p.rollEnd && p.cast?.k !== "dash") startRoll(sim, a, p, mx, my);
  }
  if (t < p.rollEnd) {
    const step = Math.min(p.rollLeft, (C.ROLL_DIST / C.ROLL_TIME) * dt);
    moveBody(sim.grid, a, p.rollX * step, p.rollY * step);
    p.rollLeft -= step;
    a.moving = true;
    finish(sim, a, ox, oy);
    return;
  }
  if (p.pendingSkill !== 0) {
    const slot = p.pendingSkill;
    p.pendingSkill = 0;
    useSkill(sim, a, slot, aim);
  }
  if (p.pendingInteract) {
    p.pendingInteract = false;
    interact(sim, a);
  }
  let speedMul = 1;
  if (p.cast) speedMul = tickCast(sim, a, dt);
  else {
    tickMelee(sim, a, p, aim);
    tickBow(sim, a, p, aim);
  }
  const swinging = t < p.swingEnd;
  if (swinging) speedMul = Math.min(speedMul, 0.35);
  if (p.drawStart >= 0) speedMul = Math.min(speedMul, 0.5);
  if (p.parryUntil > t) speedMul = Math.min(speedMul, 0.5);
  const speed = d.moveSpeed * terrainSpeed(sim.grid, a.x, a.y) * speedMul;
  const moving = ml > 0.05 && speed > 0;
  if (moving) moveBody(sim.grid, a, mx * speed * dt, my * speed * dt);
  if (p.cast?.k !== "dash") a.moving = moving;
  if (!swinging && !p.cast) {
    if (aim) face(a, aim.x, aim.y);
    else if (moving) face(a, mx, my);
  }
  if (p.drawStart >= 0) setAnim(sim, a, "shoot", t + 0.1);
  finish(sim, a, ox, oy);
}

function finish(sim: Sim, a: Actor, ox: number, oy: number): void {
  clampArena(sim, a, ox, oy);
  locomotion(sim, a);
  sim.index.update(a);
}

function startRoll(sim: Sim, a: Actor, p: PlayerData, mx: number, my: number): void {
  if (p.stamina < C.ROLL_COST) return;
  const t = sim.time;
  p.stamina -= C.ROLL_COST;
  p.staminaAt = t;
  p.swingEnd = Math.min(p.swingEnd, t);
  p.swingHit = true;
  p.drawStart = -1;
  if (p.cast && p.cast.k !== "dash") p.cast = null;
  let rx = mx;
  let ry = my;
  if (Math.hypot(rx, ry) < 0.1) {
    rx = a.fx;
    ry = a.fy;
  }
  const l = Math.hypot(rx, ry) || 1;
  p.rollX = rx / l;
  p.rollY = ry / l;
  face(a, p.rollX, p.rollY);
  p.rollStart = t;
  p.rollEnd = t + C.ROLL_TIME;
  p.rollLeft = C.ROLL_DIST;
  p.perfectUsed = false;
  setAnim(sim, a, "walk", p.rollEnd);
  emit(sim, { k: "dust", x: a.x, y: a.y, d: a.dir });
}

function tickMelee(sim: Sim, a: Actor, p: PlayerData, aim: Aim | null): void {
  const t = sim.time;
  if (t >= p.swingEnd && p.drawStart < 0 && (p.input.attack || p.tapAttack)) {
    p.tapAttack = false;
    const step = t <= p.comboUntil ? (p.combo + 1) % 3 : 0;
    // Soft lock: without an aim vector, turn toward the nearest close enemy.
    if (aim) face(a, aim.x, aim.y);
    else {
      const near = sim.index.nearest(a.x, a.y, 2.2, hostile);
      if (near) face(a, near.x - a.x, near.y - a.y);
    }
    p.combo = step;
    p.swingStart = t;
    p.swingEnd = t + (C.MELEE_TIME[step] ?? 0.3);
    p.swingHitAt = t + (C.MELEE_HIT_DELAY[step] ?? 0.1);
    p.swingHit = false;
    p.comboUntil = p.swingEnd + C.COMBO_WINDOW;
    p.lastCombat = t;
    playAnim(sim, a, "attack", p.swingEnd);
    sound(sim, "swing", a.x, a.y);
  }
  if (!p.swingHit && t >= p.swingHitAt) {
    p.swingHit = true;
    const step = p.combo;
    const heavy = step === 2;
    const coef = C.MELEE_COEF[step] ?? 1;
    const angle = Math.atan2(a.fy, a.fx);
    emit(sim, { k: heavy ? "thrust" : "slash", x: a.x, y: a.y, angle, d: a.dir });
    moveBody(sim.grid, a, a.fx * (heavy ? 0.25 : 0.1), a.fy * (heavy ? 0.25 : 0.1));
    const src = sourceOf(sim, a, "melee");
    const reach = C.MELEE_RANGE;
    const cos = Math.cos(C.MELEE_HALF_ARC);
    for (const b of sim.index.query(a.x, a.y, reach + 0.6, hostile)) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dd = Math.hypot(dx, dy);
      if (dd > reach + b.radius) continue;
      if (dd > 0.5 && (dx * a.fx + dy * a.fy) / dd < cos) continue;
      hit(sim, src, b, { coef, heavy, knock: heavy ? 0.4 : 0.12, sfx: "blade" });
    }
  }
}

function tickBow(sim: Sim, a: Actor, p: PlayerData, aim: Aim | null): void {
  const t = sim.time;
  if (p.drawStart < 0) {
    if ((p.input.shoot || p.tapShot) && t >= p.swingEnd && t >= p.bowReadyAt) {
      p.tapShot = false;
      p.drawStart = t;
      p.lastCombat = t;
      setAnim(sim, a, "shoot", t + 0.1);
    } else return;
  }
  if (p.input.shoot) return;
  const held = t - p.drawStart;
  p.drawStart = -1;
  p.tapShot = false;
  const perfect = held >= C.PERFECT_SHOT[0] - 1e-9 && held <= C.PERFECT_SHOT[1] + 1e-9;
  const charge = Math.max(0, Math.min(1, (held - C.QUICK_SHOT) / (C.FULL_DRAW - C.QUICK_SHOT)));
  const coef = perfect ? C.PERFECT_SHOT_COEF : held < C.QUICK_SHOT ? C.BOW_MIN : C.BOW_MIN + (C.BOW_MAX - C.BOW_MIN) * charge;
  const dir = aimDir(sim, a, aim, C.BOW_RANGE);
  face(a, dir.x, dir.y);
  fireProjectile(sim, sourceOf(sim, a, "bow"), a.x + dir.x * 0.4, a.y + dir.y * 0.4, dir.x, dir.y, {
    speed: C.ARROW_SPEED,
    range: C.BOW_RANGE,
    coef,
    dkind: "bow",
    heavy: coef >= 1.4,
    forceCrit: perfect,
  });
  sound(sim, perfect ? "crit" : "bow", a.x, a.y);
  p.bowReadyAt = t + C.BOW_REARM;
  playAnim(sim, a, "shoot", t + 0.15);
}

function tickDowned(sim: Sim, a: Actor, p: PlayerData, dt: number): void {
  a.moving = false;
  if (sim.time >= p.downEnd) return;
  let helper: Actor | null = null;
  let best: number = C.REVIVE_RANGE;
  for (const b of sim.players.values()) {
    if (b === a || !b.alive || !b.pl || b.pl.downedAt >= 0) continue;
    const dd = Math.hypot(b.x - a.x, b.y - a.y);
    if (dd <= best) {
      best = dd;
      helper = b;
    }
  }
  if (helper) {
    p.revive += dt;
    if (p.revive >= C.REVIVE_TIME - 1e-6) revivePlayer(sim, a, C.REVIVE_HP, helper.id);
  } else p.revive = Math.max(0, p.revive - dt);
}

function interact(sim: Sim, a: Actor): void {
  let best: Actor | null = null;
  let bestD: number = C.TALK_RANGE;
  for (const id of sim.npcs.values()) {
    const n = sim.actors.get(id);
    if (!n || !n.npcId) continue;
    const dd = Math.hypot(n.x - a.x, n.y - a.y);
    if (dd <= bestD) {
      bestD = dd;
      best = n;
    }
  }
  if (!best || !best.npcId) return;
  face(best, a.x - best.x, a.y - best.y);
  best.lookUntil = sim.time + 4;
  const npcId = best.npcId;
  const id = a.id;
  later(sim, () => sim.hooks.onTalk(id, npcId));
}
