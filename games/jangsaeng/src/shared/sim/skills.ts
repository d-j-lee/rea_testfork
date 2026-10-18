// Player skills (slots 1-4) and 노인성 일섬 (slot 5). Energy and cooldown come
// from SkillDef; damage uses the skill multiplier through combat.hit.
import { moveBody } from "./physics.ts";
import { hit, sourceOf } from "./combat.ts";
import { freePoint } from "./entities.ts";
import { fireProjectile, hitscan, schedule } from "./projectiles.ts";
import {
  C,
  COLOR,
  delayFx,
  emit,
  face,
  feel,
  floatText,
  hostile,
  later,
  playAnim,
  r6,
  sound,
  telegraph,
  type Actor,
  type Sim,
} from "./state.ts";

export interface Aim {
  x: number;
  y: number;
}

/** Nearest hostile within range in the facing half-plane (with line of sight). */
export function autoTarget(sim: Sim, a: Actor, range: number): Actor | null {
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const b of sim.index.query(a.x, a.y, range, hostile)) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx * a.fx + dy * a.fy < -0.1) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best !== null && b.id < best.id)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** Shot direction: explicit aim, else auto-target, else facing. */
export function aimDir(sim: Sim, a: Actor, aim: Aim | null, range: number): { x: number; y: number; target: Actor | null } {
  if (aim) {
    const l = Math.hypot(aim.x, aim.y);
    return { x: aim.x / l, y: aim.y / l, target: null };
  }
  const target = autoTarget(sim, a, range);
  if (target) {
    const dx = target.x - a.x;
    const dy = target.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l, target };
  }
  return { x: a.fx, y: a.fy, target: null };
}

export function useSkill(sim: Sim, a: Actor, slot: number, aim: Aim | null): void {
  if (slot === 5) {
    longevity(sim, a);
    return;
  }
  const p = a.pl;
  if (!p || slot < 1 || slot > 4) return;
  const id = p.skills[slot - 1];
  const def = id ? sim.content.skills[id] : undefined;
  if (!def || def.kind === "longevity") return;
  const t = sim.time;
  if ((p.ready.get(def.id) ?? 0) > t + 1e-9 || p.energy < def.energy) return;
  if (p.cast?.k === "dash") return;
  p.energy -= def.energy;
  p.ready.set(def.id, t + def.cooldown);
  p.swingEnd = Math.min(p.swingEnd, t);
  p.swingHit = true;
  p.drawStart = -1;
  p.cast = null;
  p.lastCombat = t;
  sound(sim, "skill", a.x, a.y);
  const src = sourceOf(sim, a, "skill");
  switch (def.kind) {
    case "dash": {
      const range = def.range ?? 3;
      const d = aimDir(sim, a, aim, range + 1.5);
      face(a, d.x, d.y);
      p.cast = { k: "dash", end: t + 0.22, dx: d.x, dy: d.y, speed: range / 0.2, left: range, coef: def.coef, hit: [] };
      a.invulnUntil = Math.max(a.invulnUntil, t + 0.25);
      playAnim(sim, a, "attack", t + 0.25);
      emit(sim, { k: "thrust", x: a.x, y: a.y, angle: Math.atan2(d.y, d.x), d: a.dir });
      emit(sim, { k: "dust", x: a.x, y: a.y });
      sound(sim, "swing", a.x, a.y);
      return;
    }
    case "spin": {
      const total = def.id === "ssanggeom" ? 6 : 2;
      const interval = total > 2 ? 0.12 : 0.22;
      p.cast = { k: "spin", next: t + 0.05, left: total, total, interval, radius: def.radius ?? 1.8, coef: def.coef };
      playAnim(sim, a, "attack", t + total * interval + 0.1);
      return;
    }
    case "shout": {
      const r = def.radius ?? 5;
      for (const b of sim.index.query(a.x, a.y, r)) {
        if (!b.alive || b.removed) continue;
        if (b.side === "friend") b.buffUntil = t + 8;
        else if (b.side === "foe" && b.en && !b.en.boss) {
          b.fearUntil = t + 1;
          b.fearX = a.x;
          b.fearY = a.y;
          b.en.act = null;
        }
      }
      emit(sim, { k: "shout", x: a.x, y: a.y, power: r });
      floatText(sim, a.x, a.y, def.name, COLOR.phase);
      feel(sim, a.id, a.x, a.y, 0, 3);
      playAnim(sim, a, "cast", t + 0.4);
      return;
    }
    case "pierce": {
      const range = def.range ?? 12;
      const d = aimDir(sim, a, aim, range);
      face(a, d.x, d.y);
      fireProjectile(sim, src, a.x + d.x * 0.4, a.y + d.y * 0.4, d.x, d.y, {
        speed: 18, range, coef: def.coef, dkind: "skill", pierce: true, heavy: true,
      });
      sound(sim, "bow", a.x, a.y);
      playAnim(sim, a, "shoot", t + 0.25);
      return;
    }
    case "rockets": {
      const range = def.range ?? 8;
      const d = aimDir(sim, a, aim, range);
      face(a, d.x, d.y);
      const base = Math.atan2(d.y, d.x);
      for (const off of [-15, 0, 15]) {
        const ang = base + (off * Math.PI) / 180;
        fireProjectile(sim, src, a.x, a.y, Math.cos(ang), Math.sin(ang), {
          speed: 12, range, coef: def.coef, dkind: "skill", burn: 3, kind: "rocket", heavy: true,
        });
      }
      emit(sim, { k: "smoke", x: a.x, y: a.y });
      sound(sim, "bow", a.x, a.y);
      playAnim(sim, a, "shoot", t + 0.3);
      return;
    }
    case "barrage": {
      const range = def.range ?? 9;
      const radius = def.radius ?? 2.5;
      let px: number;
      let py: number;
      if (aim) {
        const l = Math.hypot(aim.x, aim.y);
        const k = Math.min(range, l) / l;
        px = a.x + aim.x * k;
        py = a.y + aim.y * k;
      } else {
        const target = autoTarget(sim, a, range);
        px = target ? target.x : a.x + a.fx * Math.min(5, range);
        py = target ? target.y : a.y + a.fy * Math.min(5, range);
      }
      face(a, px - a.x, py - a.y);
      for (let i = 0; i < 12; i++) {
        const ang = sim.rng.range(0, Math.PI * 2);
        const rr = radius * Math.sqrt(sim.rng.next());
        const rx = px + Math.cos(ang) * rr;
        const ry = py + Math.sin(ang) * rr;
        const launch = t + i * 0.07;
        const land = launch + Math.max(0.2, Math.hypot(rx - a.x, ry - a.y) / 15);
        delayFx(sim, launch, { k: "arrow", x: a.x, y: a.y, tx: rx, ty: ry, color: COLOR.burn });
        schedule(sim, { at: land, src, x: rx, y: ry, r: 0.9, coef: def.coef, fx: "rocket", burn: 2, heavy: true });
      }
      emit(sim, { k: "smoke", x: a.x, y: a.y, power: 2 });
      playAnim(sim, a, "cast", t + 0.6);
      return;
    }
    case "parry":
      p.parryUntil = t + 1.5;
      emit(sim, { k: "spark", x: a.x, y: a.y, color: COLOR.block });
      sound(sim, "block", a.x, a.y);
      playAnim(sim, a, "cast", t + 0.3);
      return;
    case "bomb": {
      const r = def.radius ?? 2.5;
      const at = freePoint(sim, a.x + a.fx * 0.8, a.y + a.fy * 0.8, 2);
      schedule(sim, { at: t + 3, src, x: at.x, y: at.y, r, coef: def.coef, heavy: true, fx: "explosion" });
      telegraph(sim, { shape: "circle", x: at.x, y: at.y, r, ms: 3000 });
      emit(sim, { k: "smoke", x: at.x, y: at.y });
      playAnim(sim, a, "cast", t + 0.3);
      return;
    }
    case "musket": {
      const range = def.range ?? 10;
      const d = aimDir(sim, a, aim, range);
      face(a, d.x, d.y);
      p.cast = { k: "aim", fireAt: r6(t + 1.2), dx: d.x, dy: d.y, range, coef: def.coef };
      telegraph(sim, { shape: "line", x: a.x, y: a.y, tx: a.x + d.x * range, ty: a.y + d.y * range, ms: 1200 });
      playAnim(sim, a, "cast", t + 1.2);
      return;
    }
    case "rifle": {
      const range = def.range ?? 14;
      const d = aimDir(sim, a, aim, range);
      face(a, d.x, d.y);
      hitscan(sim, src, a.x, a.y, d.x, d.y, range, { coef: def.coef, width: 0.35, pierce: true, heavy: true, dkind: "skill" });
      feel(sim, a.id, a.x, a.y, 0, 2);
      playAnim(sim, a, "shoot", t + 0.2);
      return;
    }
  }
}

/** Advances a channelled skill; returns the movement multiplier. */
export function tickCast(sim: Sim, a: Actor, dt: number): number {
  const p = a.pl;
  const cast = p?.cast;
  if (!p || !cast) return 1;
  const t = sim.time;
  if (cast.k === "dash") {
    const step = Math.min(cast.left, cast.speed * dt);
    const ox = a.x;
    const oy = a.y;
    moveBody(sim.grid, a, cast.dx * step, cast.dy * step);
    cast.left -= step;
    const moved = Math.hypot(a.x - ox, a.y - oy);
    const src = sourceOf(sim, a, "skill");
    for (const b of sim.index.query(a.x, a.y, 1.2, hostile)) {
      if (cast.hit.includes(b.id) || Math.hypot(b.x - a.x, b.y - a.y) > 0.9 + b.radius) continue;
      cast.hit.push(b.id);
      hit(sim, src, b, { coef: cast.coef, heavy: true, knock: 0.5, sfx: "blade" });
      emit(sim, { k: "slash", x: a.x, y: a.y, angle: Math.atan2(cast.dy, cast.dx), d: a.dir });
    }
    a.moving = true;
    if (t >= cast.end || cast.left <= 1e-6 || moved < step * 0.2) p.cast = null;
    return 0;
  }
  if (cast.k === "spin") {
    if (t >= cast.next) {
      const src = sourceOf(sim, a, "skill");
      const i = cast.total - cast.left;
      const ang = (i * Math.PI * 2) / Math.max(2, cast.total) + Math.atan2(a.fy, a.fx);
      emit(sim, { k: "slash", x: a.x, y: a.y, angle: ang, d: a.dir });
      emit(sim, { k: "slash", x: a.x, y: a.y, angle: ang + Math.PI, d: a.dir });
      sound(sim, "swing", a.x, a.y);
      for (const b of sim.index.query(a.x, a.y, cast.radius + 0.5, hostile)) {
        if (Math.hypot(b.x - a.x, b.y - a.y) > cast.radius + b.radius) continue;
        hit(sim, src, b, { coef: cast.coef, heavy: true, knock: 0.25, sfx: "blade", fromX: a.x, fromY: a.y });
      }
      cast.left--;
      cast.next += cast.interval;
      if (cast.left <= 0) p.cast = null;
    }
    return 0.6;
  }
  face(a, cast.dx, cast.dy);
  if (t >= cast.fireAt) {
    hitscan(sim, sourceOf(sim, a, "skill"), a.x, a.y, cast.dx, cast.dy, cast.range, {
      coef: cast.coef, width: 0.45, pierce: true, heavy: true, dkind: "skill",
    });
    feel(sim, a.id, a.x, a.y, 100, 3);
    playAnim(sim, a, "shoot", t + 0.2);
    p.cast = null;
  }
  return 0;
}

/** 노인성 일섬: coef 8.0 to every enemy within 12 tiles, 5 s invulnerability. */
function longevity(sim: Sim, a: Actor): void {
  const p = a.pl;
  if (!p || !p.longevityEnabled || sim.time < p.longevityAt - 1e-9) return;
  const t = sim.time;
  const def = sim.content.longevity;
  p.longevityAt = t + def.cooldown;
  p.cast = null;
  p.drawStart = -1;
  const src = sourceOf(sim, a, "skill");
  const targets = sim.index
    .query(a.x, a.y, C.LONGEVITY_RADIUS, hostile)
    .sort((m, n) => Math.hypot(m.x - a.x, m.y - a.y) - Math.hypot(n.x - a.x, n.y - a.y) || m.id - n.id);
  for (const b of targets) {
    emit(sim, { k: "slash", x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x), d: b.dir });
    hit(sim, src, b, { coef: def.coef, heavy: true, knock: 0.6, poiseBreak: b.en?.boss !== null, sfx: "blade", fromX: a.x, fromY: a.y });
  }
  a.invulnUntil = t + C.LONGEVITY_INVULN;
  emit(sim, { k: "levelup", x: a.x, y: a.y });
  emit(sim, { k: "shout", x: a.x, y: a.y, power: C.LONGEVITY_RADIUS });
  floatText(sim, a.x, a.y, def.name, COLOR.phase, true);
  feel(sim, a.id, a.x, a.y, 150, 10);
  sound(sim, "skill", a.x, a.y);
  sound(sim, "hit_heavy", a.x, a.y);
  playAnim(sim, a, "cast", t + 0.6);
  const id = a.id;
  later(sim, () => sim.hooks.onLongevity(id));
}
