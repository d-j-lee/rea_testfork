// Enemy attack actions: wind-ups, telegraphs and their resolution. Heavy
// hits telegraph for ≥ 0.4 s and resolve 50 ms after the telegraph ends.
import { isBlocked, moveBody } from "./physics.ts";
import { hit, sourceOf } from "./combat.ts";
import { fireProjectile, hitscan } from "./projectiles.ts";
import {
  C,
  emit,
  face,
  inFront,
  playAnim,
  r6,
  setAnim,
  sound,
  targetable,
  telegraph,
  type Actor,
  type EnemyAction,
  type Sim,
} from "./state.ts";

function action(k: EnemyAction["k"], at: number, end: number): EnemyAction {
  return { k, at: r6(at), end: r6(end), done: false, x: 0, y: 0, tx: 0, ty: 0, r: 0, coef: 1, heavy: false, dx: 0, dy: 0, dist: 0, moved: 0, speed: 0, hit: [], n: 1 };
}

function begin(sim: Sim, a: Actor, act: EnemyAction, anim: "attack" | "shoot" | "cast"): void {
  if (!a.en) return;
  a.en.act = act;
  a.moving = false;
  playAnim(sim, a, anim, act.end);
}

function aimAt(a: Actor, tgt: Actor): { x: number; y: number } {
  const dx = tgt.x - a.x;
  const dy = tgt.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  face(a, dx, dy);
  return { x: dx / l, y: dy / l };
}

/** Light melee swing: no telegraph, readable wind-up. */
export function startSwing(sim: Sim, a: Actor, tgt: Actor, windup: number, coef = 1): void {
  aimAt(a, tgt);
  const t = sim.time;
  const act = action("swing", t + windup, t + windup + 0.25);
  act.r = (a.en?.def.range ?? 1.2) + 0.35;
  act.coef = coef;
  begin(sim, a, act, "attack");
}

/** Brute slam: telegraphed circle in front. */
export function startSlam(sim: Sim, a: Actor, tgt: Actor, coef = 1.6): void {
  const d = aimAt(a, tgt);
  const t = sim.time;
  const ms = 550;
  const act = action("slam", t + ms / 1000 + C.GRACE, t + ms / 1000 + 0.4);
  const reach = Math.min(0.9, Math.hypot(tgt.x - a.x, tgt.y - a.y));
  act.x = a.x + d.x * reach;
  act.y = a.y + d.y * reach;
  act.r = Math.max(1.3, (a.en?.def.range ?? 1.3) + 0.1);
  act.coef = coef;
  act.heavy = true;
  telegraph(sim, { shape: "circle", x: act.x, y: act.y, r: act.r, ms });
  begin(sim, a, act, "attack");
}

/** Boss heavy cleave: telegraphed cone. */
export function startCleave(sim: Sim, a: Actor, tgt: Actor): void {
  aimAt(a, tgt);
  const t = sim.time;
  const ms = 600;
  const act = action("cleave", t + ms / 1000 + C.GRACE, t + ms / 1000 + 0.4);
  act.r = (a.en?.def.range ?? 1.6) + 0.8;
  act.coef = 1.8;
  act.heavy = true;
  telegraph(sim, { shape: "cone", x: a.x, y: a.y, angle: Math.atan2(a.fy, a.fx), spread: Math.PI / 3, r: act.r, ms });
  begin(sim, a, act, "attack");
}

export interface ChargeOpts {
  speed: number;
  coef: number;
  n: number;
  ms: number;
  maxDist: number;
}

/** Charge / pounce: telegraphed line, then a dash that hits along the path. */
export function startCharge(sim: Sim, a: Actor, tgt: Actor, o: ChargeOpts): void {
  const d = aimAt(a, tgt);
  const t = sim.time;
  const act = action("charge", t + o.ms / 1000 + C.GRACE, Infinity);
  act.dx = d.x;
  act.dy = d.y;
  act.dist = Math.min(o.maxDist, Math.hypot(tgt.x - a.x, tgt.y - a.y) + 1.5);
  act.speed = o.speed;
  act.coef = o.coef;
  act.heavy = true;
  act.n = o.n;
  // `r` carries the telegraph duration for chained re-aims.
  act.r = o.ms;
  telegraph(sim, { shape: "line", x: a.x, y: a.y, tx: a.x + d.x * act.dist, ty: a.y + d.y * act.dist, ms: o.ms });
  begin(sim, a, act, "attack");
}

/** Archer: draw, then loose an arrow at the target's position. */
export function startShoot(sim: Sim, a: Actor, tgt: Actor): void {
  aimAt(a, tgt);
  const t = sim.time;
  const act = action("shoot", t + 0.45, t + 0.65);
  act.tx = tgt.x;
  act.ty = tgt.y;
  begin(sim, a, act, "shoot");
}

/** Gun: telegraphed line then hitscan (musket volley 1.0 s, rifles 0.45 s). */
export function startLine(sim: Sim, a: Actor, tgt: Actor, ms: number, coef: number, heavy: boolean): void {
  const d = aimAt(a, tgt);
  const t = sim.time;
  const range = (a.en?.def.range ?? 8) + 1;
  const act = action("line", t + ms / 1000 + C.GRACE, t + ms / 1000 + 0.3);
  act.x = a.x;
  act.y = a.y;
  act.tx = a.x + d.x * range;
  act.ty = a.y + d.y * range;
  act.coef = coef;
  act.heavy = heavy;
  telegraph(sim, { shape: "line", x: a.x, y: a.y, tx: act.tx, ty: act.ty, ms });
  begin(sim, a, act, "shoot");
}

/** Boss spin: telegraphed circle, then two (or more) hits while advancing. */
export function startSpin(sim: Sim, a: Actor, n: number): void {
  const t = sim.time;
  const ms = 700;
  const act = action("spin", t + ms / 1000 + C.GRACE, t + ms / 1000 + 0.35 * n + 0.3);
  act.r = 2.4;
  act.coef = 1.2;
  act.heavy = true;
  act.n = n;
  telegraph(sim, { shape: "circle", x: a.x, y: a.y, r: act.r, ms });
  begin(sim, a, act, "attack");
}

/** Boss fan volley (arrows, or bullets for gunners). */
export function startVolley(sim: Sim, a: Actor, tgt: Actor): void {
  const d = aimAt(a, tgt);
  const t = sim.time;
  const ms = 1000;
  const act = action("volley", t + ms / 1000 + C.GRACE, t + ms / 1000 + 0.4);
  act.dx = d.x;
  act.dy = d.y;
  act.coef = 0.9;
  telegraph(sim, { shape: "cone", x: a.x, y: a.y, angle: Math.atan2(d.y, d.x), spread: (25 * Math.PI) / 180, r: 9, ms });
  begin(sim, a, act, "shoot");
}

/** Rooted cast (boss mechanics whose strikes are scheduled separately). */
export function startCast(sim: Sim, a: Actor, seconds: number): EnemyAction {
  const act = action("cast", sim.time + seconds, sim.time + seconds);
  begin(sim, a, act, "cast");
  return act;
}

function friendsIn(sim: Sim, x: number, y: number, r: number): Actor[] {
  return sim.index
    .query(x, y, r + 0.5, targetable)
    .filter((b) => Math.hypot(b.x - x, b.y - y) <= r + b.radius)
    .sort((p, q) => p.id - q.id);
}

function finish(sim: Sim, a: Actor): void {
  const e = a.en;
  if (!e) return;
  const t = sim.time;
  const k = e.act?.k;
  e.act = null;
  e.nextAttackAt = t + e.def.cooldown * e.cdMul * sim.rng.range(0.85, 1.15);
  if (k === "line" && e.def.behavior === "musket") {
    e.reloadUntil = e.nextAttackAt;
    setAnim(sim, a, "cast", e.reloadUntil);
  }
  if (k === "line" && e.def.behavior === "rifle") coverMove(sim, a);
  else if (k === "swing" && e.def.behavior !== "boss" && sim.rng.chance(0.3)) {
    // Step aside after a swing so the pack reshuffles.
    const side = sim.rng.chance(0.5) ? 1 : -1;
    e.goalX = a.x - a.fy * side * 1.4 - a.fx * 0.6;
    e.goalY = a.y + a.fx * side * 1.4 - a.fy * 0.6;
    e.goalUntil = t + 0.6;
    e.state = "reposition";
  }
}

/** Rifles shift to a nearby spot, preferring tiles next to cover. */
function coverMove(sim: Sim, a: Actor): void {
  const e = a.en;
  if (!e) return;
  const tgt = sim.actors.get(e.target);
  let best = { x: a.x, y: a.y };
  let bestScore = -Infinity;
  for (let i = 0; i < 6; i++) {
    const ang = sim.rng.range(0, Math.PI * 2);
    const r = sim.rng.range(1.5, 3.5);
    const x = a.x + Math.cos(ang) * r;
    const y = a.y + Math.sin(ang) * r;
    if (isBlocked(sim.grid, Math.floor(x), Math.floor(y))) continue;
    let score = 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      if (isBlocked(sim.grid, Math.floor(x) + ox, Math.floor(y) + oy)) score += 2;
    if (tgt) score -= Math.abs(Math.hypot(tgt.x - x, tgt.y - y) - 7) * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  e.goalX = best.x;
  e.goalY = best.y;
  e.goalUntil = sim.time + 1.4;
  e.state = "reposition";
}

export function tickAction(sim: Sim, a: Actor, dt: number): void {
  const e = a.en;
  const act = e?.act;
  if (!e || !act) return;
  const t = sim.time;
  if (act.k !== "charge" && act.k !== "spin") a.moving = false;
  switch (act.k) {
    case "swing":
      if (!act.done && t >= act.at) {
        act.done = true;
        emit(sim, { k: "slash", x: a.x, y: a.y, angle: Math.atan2(a.fy, a.fx), d: a.dir, color: "#ff8a7a" });
        sound(sim, "swing", a.x, a.y);
        const src = sourceOf(sim, a, "plain");
        for (const b of friendsIn(sim, a.x, a.y, act.r))
          if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5 || inFront(a, b.x, b.y, Math.PI / 3))
            hit(sim, src, b, { coef: act.coef, knock: 0.15 });
      }
      break;
    case "slam":
    case "cleave":
      if (!act.done && t >= act.at) {
        act.done = true;
        const src = sourceOf(sim, a, "plain");
        const cx = act.k === "slam" ? act.x : a.x;
        const cy = act.k === "slam" ? act.y : a.y;
        emit(sim, act.k === "slam" ? { k: "dust", x: cx, y: cy, power: act.r } : { k: "slash", x: a.x, y: a.y, angle: Math.atan2(a.fy, a.fx), d: a.dir, color: "#ff8a7a" });
        sound(sim, "hit_heavy", cx, cy);
        for (const b of friendsIn(sim, cx, cy, act.r))
          if (act.k === "slam" || Math.hypot(b.x - a.x, b.y - a.y) < 0.5 || inFront(a, b.x, b.y, Math.PI / 3))
            hit(sim, src, b, { coef: act.coef, heavy: true, knock: 0.8 });
      }
      break;
    case "shoot":
      if (!act.done && t >= act.at) {
        act.done = true;
        const tgt = sim.actors.get(e.target);
        const tx = tgt && targetable(tgt) ? tgt.x : act.tx;
        const ty = tgt && targetable(tgt) ? tgt.y : act.ty;
        face(a, tx - a.x, ty - a.y);
        fireProjectile(sim, sourceOf(sim, a, "plain"), a.x, a.y, tx - a.x, ty - a.y, { speed: 11, range: e.def.range + 2, coef: 1, dkind: "plain" });
        sound(sim, "bow", a.x, a.y);
      }
      break;
    case "line":
      if (!act.done && t >= act.at) {
        act.done = true;
        hitscan(sim, sourceOf(sim, a, "plain"), act.x, act.y, act.tx - act.x, act.ty - act.y, Math.hypot(act.tx - act.x, act.ty - act.y), {
          coef: act.coef, width: 0.35, pierce: false, heavy: act.heavy, dkind: "plain",
        });
      }
      break;
    case "volley":
      if (!act.done && t >= act.at) {
        act.done = true;
        const src = sourceOf(sim, a, "plain");
        const base = Math.atan2(act.dy, act.dx);
        const gun = e.def.range >= 4;
        for (const off of [-20, -10, 0, 10, 20]) {
          const ang = base + (off * Math.PI) / 180;
          if (gun) hitscan(sim, src, a.x, a.y, Math.cos(ang), Math.sin(ang), e.def.range + 1, { coef: act.coef, width: 0.3, pierce: false, heavy: false, dkind: "plain" });
          else fireProjectile(sim, src, a.x, a.y, Math.cos(ang), Math.sin(ang), { speed: 11, range: 9, coef: act.coef, dkind: "plain" });
        }
        if (!gun) sound(sim, "bow", a.x, a.y);
      }
      break;
    case "spin":
      if (act.n > 0 && t >= act.at) {
        act.n--;
        act.at = r6(act.at + 0.35);
        act.done = true;
        const src = sourceOf(sim, a, "plain");
        emit(sim, { k: "slash", x: a.x, y: a.y, angle: Math.atan2(a.fy, a.fx), d: a.dir, color: "#ff8a7a" });
        emit(sim, { k: "slash", x: a.x, y: a.y, angle: Math.atan2(-a.fy, -a.fx), d: a.dir, color: "#ff8a7a" });
        sound(sim, "swing", a.x, a.y);
        for (const b of friendsIn(sim, a.x, a.y, act.r)) hit(sim, src, b, { coef: act.coef, heavy: true, knock: 0.6, fromX: a.x, fromY: a.y });
      }
      if (act.done) {
        const tgt = sim.actors.get(e.target);
        if (tgt && targetable(tgt)) {
          const dx = tgt.x - a.x;
          const dy = tgt.y - a.y;
          const l = Math.hypot(dx, dy);
          if (l > 0.8) {
            moveBody(sim.grid, a, (dx / l) * e.def.speed * 0.5 * dt, (dy / l) * e.def.speed * 0.5 * dt);
            a.moving = true;
          }
        }
      }
      break;
    case "charge":
      tickCharge(sim, a, act, dt);
      break;
    case "cast":
      break;
  }
  if (t >= act.end) finish(sim, a);
}

function tickCharge(sim: Sim, a: Actor, act: EnemyAction, dt: number): void {
  const t = sim.time;
  if (act.done || t < act.at) {
    a.moving = false;
    return;
  }
  const want = Math.min(act.dist - act.moved, act.speed * dt);
  const px = a.x;
  const py = a.y;
  moveBody(sim.grid, a, act.dx * want, act.dy * want);
  const moved = Math.hypot(a.x - px, a.y - py);
  act.moved += want;
  a.moving = true;
  const src = sourceOf(sim, a, "plain");
  for (const b of friendsIn(sim, a.x, a.y, 0.7)) {
    if (act.hit.includes(b.id)) continue;
    act.hit.push(b.id);
    hit(sim, src, b, { coef: act.coef, heavy: true, knock: 1.0, fromX: a.x - act.dx, fromY: a.y - act.dy });
  }
  if (act.moved < act.dist - 1e-6 && moved >= want * 0.3) return;
  emit(sim, { k: "dust", x: a.x, y: a.y, d: a.dir });
  const tgt = a.en ? sim.actors.get(a.en.target) : undefined;
  if (act.n > 1 && tgt && targetable(tgt)) {
    // Chained charge (frenzied bosses): re-aim with a fresh telegraph.
    const d = aimAt(a, tgt);
    act.n--;
    act.dx = d.x;
    act.dy = d.y;
    act.moved = 0;
    act.hit = [];
    act.dist = Math.min(act.dist, Math.hypot(tgt.x - a.x, tgt.y - a.y) + 1.5);
    const ms = Math.max(400, act.r * 0.75);
    act.at = r6(t + ms / 1000 + C.GRACE);
    telegraph(sim, { shape: "line", x: a.x, y: a.y, tx: a.x + d.x * act.dist, ty: a.y + d.y * act.dist, ms });
    return;
  }
  act.done = true;
  act.end = r6(t + 0.5);
  setAnim(sim, a, "idle", act.end);
}
