// Projectiles (arrows, fire rockets), hitscan lines (muskets, rifles),
// scheduled area strikes (bombs, barrages, cannon, fire zones) and lingering
// hazards. Every hit goes through combat.hit so the formula has one owner.
import { isBlocked } from "./physics.ts";
import { hit, sourceOf } from "./combat.ts";
import {
  COLOR,
  emit,
  feel,
  floatText,
  inFront,
  isDowned,
  r6,
  sound,
  type Actor,
  type DamageKind,
  type HitSource,
  type Projectile,
  type Sim,
  type Strike,
} from "./state.ts";

const blockedAt = (sim: Sim, x: number, y: number): boolean => isBlocked(sim.grid, Math.floor(x), Math.floor(y));

/** Opposing, hittable actors for a source side. */
export function opposes(side: HitSource["side"], a: Actor): boolean {
  if (!a.alive || a.removed || a.side === "none" || a.side === side) return false;
  if (a.pl) return !isDowned(a);
  if (a.fi) return a.fi.active;
  return true;
}

/** Distance along a ray before a wall (or `range`). */
export function rayToWall(sim: Sim, x: number, y: number, dx: number, dy: number, range: number): number {
  const step = 0.25;
  for (let d = step; d <= range; d += step) if (blockedAt(sim, x + dx * d, y + dy * d)) return Math.max(0, d - step);
  return range;
}

/** Where a straight shot will likely stop: first opposing body or wall. */
export function predictEnd(
  sim: Sim,
  side: HitSource["side"],
  x: number,
  y: number,
  dx: number,
  dy: number,
  range: number,
  pierce: boolean,
): { x: number; y: number } {
  const wall = rayToWall(sim, x, y, dx, dy, range);
  if (pierce) return { x: x + dx * wall, y: y + dy * wall };
  let best = wall;
  for (const a of sim.index.query(x + (dx * wall) / 2, y + (dy * wall) / 2, wall / 2 + 1, (b) => opposes(side, b))) {
    const along = (a.x - x) * dx + (a.y - y) * dy;
    if (along < 0 || along > best) continue;
    const off = Math.abs((a.x - x) * dy - (a.y - y) * dx);
    if (off <= 0.35 + a.radius) best = along;
  }
  return { x: x + dx * best, y: y + dy * best };
}

export interface ShotOpts {
  speed: number;
  range: number;
  coef: number;
  dkind: DamageKind;
  pierce?: boolean;
  burn?: number;
  blast?: number;
  heavy?: boolean;
  forceCrit?: boolean;
  kind?: "arrow" | "rocket";
}

export function fireProjectile(sim: Sim, src: HitSource, x: number, y: number, dx: number, dy: number, o: ShotOpts): void {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const p: Projectile = {
    src,
    x,
    y,
    dx: ux,
    dy: uy,
    speed: o.speed,
    left: o.range,
    coef: o.coef,
    pierce: o.pierce ?? false,
    hit: [],
    burn: o.burn ?? 0,
    blast: o.blast ?? 0,
    heavy: o.heavy ?? false,
    forceCrit: o.forceCrit ?? false,
    kind: o.kind ?? "arrow",
    dkind: o.dkind,
  };
  sim.projectiles.push(p);
  const end = predictEnd(sim, src.side, x, y, ux, uy, o.range, p.pierce);
  emit(sim, { k: "arrow", x, y, tx: end.x, ty: end.y, angle: Math.atan2(uy, ux), color: p.kind === "rocket" ? COLOR.burn : undefined });
}

function endProjectile(sim: Sim, p: Projectile): void {
  if (p.kind === "rocket") {
    emit(sim, { k: "fire", x: p.x, y: p.y });
    if (p.blast > 0) blast(sim, p.src, p.x, p.y, p.blast, p.coef * 0.5, false);
  } else emit(sim, { k: "dust", x: p.x, y: p.y });
}

function reflect(sim: Sim, p: Projectile, by: Actor): void {
  p.dx = -p.dx;
  p.dy = -p.dy;
  p.src = { ...sourceOf(sim, by, "skill"), power: p.src.power * 1.5 };
  p.hit = [by.id];
  p.left = 9;
  emit(sim, { k: "spark", x: p.x, y: p.y, color: COLOR.block });
  sound(sim, "block", p.x, p.y);
  floatText(sim, by.x, by.y, "반사", COLOR.dodge);
  const end = predictEnd(sim, p.src.side, p.x, p.y, p.dx, p.dy, p.left, p.pierce);
  emit(sim, { k: "arrow", x: p.x, y: p.y, tx: end.x, ty: end.y, angle: Math.atan2(p.dy, p.dx) });
}

export function stepProjectiles(sim: Sim, dt: number): void {
  const list = sim.projectiles;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i] as Projectile;
    let travel = p.speed * dt;
    let alive = true;
    while (alive && travel > 0) {
      const step = Math.min(0.4, travel, p.left);
      travel -= step;
      const px = p.x;
      const py = p.y;
      p.x += p.dx * step;
      p.y += p.dy * step;
      p.left -= step;
      if (blockedAt(sim, p.x, p.y)) {
        endProjectile(sim, p);
        alive = false;
        break;
      }
      for (const target of sim.index.query(p.x, p.y, 0.8, (b) => opposes(p.src.side, b))) {
        if (p.hit.includes(target.id)) continue;
        if (Math.hypot(target.x - p.x, target.y - p.y) > 0.3 + target.radius) continue;
        const pl = target.pl;
        if (pl && pl.parryUntil > sim.time && inFront(target, px - p.dx, py - p.dy, Math.PI / 2.5)) {
          reflect(sim, p, target);
          break;
        }
        p.hit.push(target.id);
        hit(sim, p.src, target, {
          coef: p.coef,
          heavy: p.heavy,
          knock: p.heavy ? 0.4 : 0.15,
          sfx: p.kind === "rocket" ? "fire" : "arrow",
          burn: p.burn,
          forceCrit: p.forceCrit,
          fromX: px - p.dx * 2,
          fromY: py - p.dy * 2,
        });
        if (!p.pierce) {
          endProjectile(sim, p);
          alive = false;
          break;
        }
      }
      if (alive && p.left <= 0) {
        endProjectile(sim, p);
        alive = false;
      }
    }
    if (alive) list[w++] = p;
  }
  list.length = w;
}

/** Hitscan along a segment; returns the end point actually reached. */
export function hitscan(
  sim: Sim,
  src: HitSource,
  x: number,
  y: number,
  dx: number,
  dy: number,
  range: number,
  o: { coef: number; width: number; pierce: boolean; heavy: boolean; dkind: DamageKind; forceCrit?: boolean },
): { x: number; y: number } {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const reach = rayToWall(sim, x, y, ux, uy, range);
  const found: { a: Actor; along: number }[] = [];
  for (const a of sim.index.query(x + (ux * reach) / 2, y + (uy * reach) / 2, reach / 2 + 1, (b) => opposes(src.side, b))) {
    const along = (a.x - x) * ux + (a.y - y) * uy;
    if (along < 0 || along > reach) continue;
    if (Math.abs((a.x - x) * uy - (a.y - y) * ux) <= o.width + a.radius) found.push({ a, along });
  }
  found.sort((p, q) => p.along - q.along || p.a.id - q.a.id);
  let end = reach;
  for (const f of found) {
    const pl = f.a.pl;
    if (pl && pl.parryUntil > sim.time && inFront(f.a, x, y, Math.PI / 2.5)) {
      floatText(sim, f.a.x, f.a.y, "막음", COLOR.block);
      sound(sim, "block", f.a.x, f.a.y);
      end = f.along;
      break;
    }
    hit(sim, src, f.a, {
      coef: o.coef,
      heavy: o.heavy,
      knock: o.heavy ? 0.5 : 0.2,
      sfx: "bullet",
      forceCrit: o.forceCrit ?? false,
      fromX: x,
      fromY: y,
    });
    if (!o.pierce) {
      end = f.along;
      break;
    }
  }
  const ex = x + ux * end;
  const ey = y + uy * end;
  emit(sim, { k: "bullet", x, y, tx: ex, ty: ey, angle: Math.atan2(uy, ux) });
  emit(sim, { k: "smoke", x: x + ux * 0.4, y: y + uy * 0.4 });
  sound(sim, "gun", x, y);
  return { x: ex, y: ey };
}

/** Immediate circular hit on the opposing side. */
export function blast(
  sim: Sim,
  src: HitSource,
  x: number,
  y: number,
  r: number,
  coef: number,
  heavy: boolean,
  burn = 0,
): number {
  let n = 0;
  for (const a of sim.index.query(x, y, r + 0.5, (b) => opposes(src.side, b))) {
    if (Math.hypot(a.x - x, a.y - y) > r + a.radius) continue;
    if (hit(sim, src, a, { coef, heavy, knock: heavy ? 0.8 : 0.3, sfx: "blast", burn, fromX: x, fromY: y }) > 0) n++;
  }
  return n;
}

export function schedule(sim: Sim, s: Partial<Strike> & Pick<Strike, "at" | "src" | "x" | "y" | "r" | "coef">): void {
  sim.strikes.push({
    shape: "circle",
    tx: s.x,
    ty: s.y,
    heavy: false,
    knock: 0,
    burn: 0,
    fire: 0,
    fx: "none",
    pierce: true,
    dkind: "skill",
    bind: null,
    ...s,
    at: r6(s.at),
  });
}

function resolveStrike(sim: Sim, s: Strike): void {
  if (s.bind) {
    const owner = sim.actors.get(s.src.owner);
    if (!owner || !owner.alive || owner.en?.act !== s.bind) return;
  }
  if (s.shape === "line") {
    hitscan(sim, s.src, s.x, s.y, s.tx - s.x, s.ty - s.y, Math.hypot(s.tx - s.x, s.ty - s.y), {
      coef: s.coef,
      width: s.r,
      pierce: s.pierce,
      heavy: s.heavy,
      dkind: s.dkind,
    });
    return;
  }
  if (s.fx === "explosion" || s.fx === "rocket") {
    emit(sim, { k: "explosion", x: s.x, y: s.y, power: s.r });
    sound(sim, "explosion", s.x, s.y);
    feel(sim, s.src.owner, s.x, s.y, s.heavy ? 100 : 0, s.fx === "explosion" ? 4 : 1);
  }
  blast(sim, s.src, s.x, s.y, s.r, s.coef, s.heavy, s.burn);
  if (s.fire > 0) {
    sim.hazards.push({
      x: s.x,
      y: s.y,
      r: s.r,
      until: sim.time + s.fire,
      next: sim.time + 0.5,
      fxNext: sim.time,
      src: s.src,
      coef: s.coef * 0.25,
    });
  }
}

export function stepStrikes(sim: Sim): void {
  const list = sim.strikes;
  let w = 0;
  const due: Strike[] = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i] as Strike;
    if (s.at <= sim.time) due.push(s);
    else list[w++] = s;
  }
  list.length = w;
  for (const s of due) resolveStrike(sim, s);
}

export function stepHazards(sim: Sim): void {
  const list = sim.hazards;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const h = list[i] as (typeof list)[number];
    if (h.until <= sim.time) continue;
    if (sim.time >= h.fxNext) {
      h.fxNext = sim.time + 2.5;
      emit(sim, { k: "fire", x: h.x, y: h.y, power: h.r });
    }
    if (sim.time >= h.next) {
      h.next = sim.time + 0.5;
      for (const a of sim.index.query(h.x, h.y, h.r + 0.5, (b) => opposes(h.src.side, b))) {
        if (Math.hypot(a.x - h.x, a.y - h.y) > h.r + a.radius) continue;
        hit(sim, h.src, a, { coef: h.coef, sfx: "fire", quiet: true, fromX: h.x, fromY: h.y });
      }
    }
    list[w++] = h;
  }
  list.length = w;
}

export function stepDelayedFx(sim: Sim): void {
  const list = sim.delayed;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const d = list[i] as (typeof list)[number];
    if (d.at <= sim.time) emit(sim, d.e);
    else list[w++] = d;
  }
  list.length = w;
}
