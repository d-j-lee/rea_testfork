// Friendly fighters: battle allies (killable, no respawn) and story NPCs with
// fights=true (immortal, active only while a battle runs at their site).
import { moveBody, terrainSpeed } from "./physics.ts";
import { applyKnock, hit, sourceOf } from "./combat.ts";
import { fireProjectile, hitscan } from "./projectiles.ts";
import { clampArena } from "./battle.ts";
import { emit, face, hostile, locomotion, playAnim, sound, type Actor, type Sim } from "./state.ts";

function validFoe(sim: Sim, id: number): Actor | null {
  const a = sim.actors.get(id);
  if (!a || !hostile(a) || a.en?.state === "flee") return null;
  const b = sim.battle;
  if (b?.def.kind === "duel" && a.en?.battle) return null;
  return a;
}

function pickFoe(sim: Sim, a: Actor): Actor | null {
  const b = sim.battle;
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const e of sim.index.query(a.x, a.y, 10, hostile)) {
    if (e.en?.state === "flee") continue;
    if (b?.def.kind === "duel" && e.en?.battle) continue;
    if (b && Math.hypot(e.x - b.cx, e.y - b.cy) > b.radius + 3) continue;
    const d = Math.hypot(e.x - a.x, e.y - a.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function stepToward(sim: Sim, a: Actor, gx: number, gy: number, speed: number, dt: number, stop: number): void {
  const dx = gx - a.x;
  const dy = gy - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= stop) {
    a.moving = false;
    return;
  }
  const step = Math.min(speed * terrainSpeed(sim.grid, a.x, a.y) * dt, d - stop);
  moveBody(sim.grid, a, (dx / d) * step, (dy / d) * step);
  a.moving = true;
  face(a, dx, dy);
}

export function tickFighter(sim: Sim, a: Actor, dt: number): void {
  const f = a.fi;
  if (!f || !a.alive) return;
  const t = sim.time;
  const ox = a.x;
  const oy = a.y;
  applyKnock(sim, a, dt);
  if (!f.active) {
    stepToward(sim, a, f.anchorX, f.anchorY, f.speed * 0.7, dt, 0.3);
  } else {
    if (t >= f.thinkAt || !validFoe(sim, f.target)) {
      f.thinkAt = t + 0.3;
      f.target = pickFoe(sim, a)?.id ?? -1;
    }
    const foe = validFoe(sim, f.target);
    if (!foe) {
      const b = sim.battle;
      const gx = b ? b.cx + (f.anchorX - b.cx) * 0.5 : f.anchorX;
      const gy = b ? b.cy + (f.anchorY - b.cy) * 0.5 : f.anchorY;
      stepToward(sim, a, gx, gy, f.speed * 0.6, dt, 0.5);
    } else {
      const d = Math.hypot(foe.x - a.x, foe.y - a.y);
      const reach = f.range + foe.radius;
      if (t >= a.animUntil) {
        if (d > reach - 0.1) stepToward(sim, a, foe.x, foe.y, f.speed, dt, reach - 0.3);
        else if (f.ranged && d < 2.5) stepToward(sim, a, a.x * 2 - foe.x, a.y * 2 - foe.y, f.speed * 0.7, dt, 0);
        else a.moving = false;
      }
      face(a, foe.x - a.x, foe.y - a.y);
      if (d <= reach && t >= f.nextAt) strike(sim, a, foe);
    }
  }
  clampArena(sim, a, ox, oy);
  locomotion(sim, a);
  sim.index.update(a);
}

function strike(sim: Sim, a: Actor, foe: Actor): void {
  const f = a.fi;
  if (!f) return;
  const t = sim.time;
  f.nextAt = t + f.cooldown * sim.rng.range(0.85, 1.15);
  const src = sourceOf(sim, a, "plain");
  const dx = foe.x - a.x;
  const dy = foe.y - a.y;
  if (!f.ranged) {
    playAnim(sim, a, "attack", t + 0.3);
    emit(sim, { k: "slash", x: a.x, y: a.y, angle: Math.atan2(dy, dx), d: a.dir });
    sound(sim, "swing", a.x, a.y);
    hit(sim, src, foe, { coef: 1, knock: 0.15, sfx: "blade" });
    return;
  }
  playAnim(sim, a, "shoot", t + 0.3);
  if (a.sprite.includes("musketeer")) {
    hitscan(sim, src, a.x, a.y, dx, dy, 8, { coef: 1.6, width: 0.3, pierce: false, heavy: false, dkind: "plain" });
    f.nextAt = t + 2.6;
  } else {
    fireProjectile(sim, src, a.x, a.y, dx, dy, { speed: 12, range: 8, coef: 1, dkind: "plain" });
    sound(sim, "bow", a.x, a.y);
  }
}
