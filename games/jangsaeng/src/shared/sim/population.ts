// Chapter population: NPC visibility by step window, ambient spawn groups
// (keep `count` alive, respawn, leash) and pickups on the ground.
import { isBlocked } from "./physics.ts";
import { tickFighter } from "./fighters.ts";
import { freePoint, makeActor, removeActor, spawnEnemy, spawnFighter, atkScale } from "./entities.ts";
import { face, later, locomotion, sound, type Actor, type SpawnRuntime, type Sim } from "./state.ts";
import type { NpcDef, Offset } from "../content/schema.ts";
import type { Dir } from "../sprites.ts";

const DIRS: Readonly<Record<Dir, readonly [number, number]>> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

/** Index of a step id in the chapter, or null when unknown. */
function stepOrder(sim: Sim, id: string | undefined): number | null {
  if (id === undefined) return null;
  const i = sim.chapter.steps.findIndex((s) => s.id === id);
  return i >= 0 ? i : null;
}

/**
 * Visible when any of `steps` (the step orders the channel's members stand
 * at) lies within [from, until]; unknown bounds do not restrict.
 */
export function inWindow(sim: Sim, steps: readonly number[], from: string | undefined, until: string | undefined): boolean {
  const lo = stepOrder(sim, from);
  const hi = stepOrder(sim, until);
  return steps.some((step) => (lo === null || step >= lo) && (hi === null || step <= hi));
}

export function siteCentre(sim: Sim, siteId: string, offset?: Offset): { x: number; y: number } | null {
  const site = sim.sites.get(siteId);
  if (!site) return null;
  return { x: site.x + 0.5 + (offset?.[0] ?? 0), y: site.y + 0.5 + (offset?.[1] ?? 0) };
}

function nearNpc(sim: Sim, x: number, y: number): boolean {
  for (const id of sim.npcs.values()) {
    const n = sim.actors.get(id);
    if (n && Math.hypot(n.x - x, n.y - y) < 1) return true;
  }
  return false;
}

/** Walkable spot near (x, y) at least one tile away from every NPC. */
export function safeSpot(sim: Sim, x: number, y: number): { x: number; y: number } {
  const base = freePoint(sim, x, y, 12);
  if (!nearNpc(sim, base.x, base.y)) return base;
  for (let r = 1; r <= 5; r++)
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const px = Math.floor(base.x + Math.cos(ang) * r) + 0.5;
      const py = Math.floor(base.y + Math.sin(ang) * r) + 0.5;
      if (!isBlocked(sim.grid, Math.floor(px), Math.floor(py)) && !nearNpc(sim, px, py)) return { x: px, y: py };
    }
  return base;
}

function createNpc(sim: Sim, def: NpcDef): Actor | null {
  const at = siteCentre(sim, def.site, def.offset);
  if (!at) return null;
  const level = sim.chapter.level[1];
  const a = def.fights
    ? spawnFighter(sim, { kind: "npc", sprite: def.sprite, name: def.name, x: at.x, y: at.y, hp: 100, atk: 12 * atkScale(level), level, immortal: true })
    : (() => {
        const p = freePoint(sim, at.x, at.y, 6);
        return makeActor(sim, { kind: "npc", side: "none", x: p.x, y: p.y, sprite: def.sprite, name: def.name, hp: 100, level });
      })();
  a.immortal = true;
  a.title = def.title;
  a.hist = def.historical ?? false;
  a.npcId = def.id;
  const [dx, dy] = DIRS[def.dir ?? "down"];
  face(a, dx, dy);
  return a;
}

/**
 * Applies step windows to NPCs and spawn groups: one is present while it
 * belongs to the step of at least one member, so nobody loses an NPC or a
 * spawn their own step still needs because someone else moved on.
 */
export function refreshPopulation(sim: Sim, steps: readonly number[]): void {
  for (const def of sim.chapter.npcs) {
    const visible = inWindow(sim, steps, def.fromStep, def.untilStep);
    const id = sim.npcs.get(def.id);
    const current = id === undefined ? undefined : sim.actors.get(id);
    if (visible && !current) {
      const a = createNpc(sim, def);
      if (a) sim.npcs.set(def.id, a.id);
    } else if (!visible && current) {
      removeActor(sim, current);
      sim.npcs.delete(def.id);
    }
  }
  for (const s of sim.spawns) {
    const active = inWindow(sim, steps, s.def.fromStep, s.def.untilStep);
    if (active === s.active) continue;
    s.active = active;
    for (const slot of s.slots) {
      if (!active) {
        const a = sim.actors.get(slot.id);
        if (a) removeActor(sim, a);
      }
      slot.id = -1;
      slot.respawnAt = 0;
    }
  }
}

export function makeSpawns(sim: Sim): SpawnRuntime[] {
  const out: SpawnRuntime[] = [];
  sim.chapter.spawns.forEach((def, index) => {
    const at = siteCentre(sim, def.site, def.offset);
    if (!at || !sim.content.enemies[def.enemy]) return;
    out.push({
      def,
      index,
      cx: at.x,
      cy: at.y,
      active: false,
      slots: Array.from({ length: Math.max(0, def.count) }, () => ({ id: -1, respawnAt: 0 })),
    });
  });
  return out;
}

export function tickSpawns(sim: Sim): void {
  const t = sim.time;
  for (const s of sim.spawns) {
    if (!s.active) continue;
    const def = sim.content.enemies[s.def.enemy];
    if (!def) continue;
    for (const slot of s.slots) {
      if (slot.id >= 0) {
        const a = sim.actors.get(slot.id);
        if (a && a.alive) continue;
        slot.id = -1;
        slot.respawnAt = t + (s.def.respawnSec ?? 30);
      }
      if (t < slot.respawnAt) continue;
      const ang = sim.rng.range(0, Math.PI * 2);
      const r = s.def.radius * Math.sqrt(sim.rng.next());
      const a = spawnEnemy(sim, def, s.cx + Math.cos(ang) * r, s.cy + Math.sin(ang) * r, { level: s.def.level, spawn: s.index, leash: true });
      slot.id = a.id;
    }
  }
}

export function tickNpc(sim: Sim, a: Actor, dt: number): void {
  if (a.fi && (a.fi.active || Math.hypot(a.x - a.fi.anchorX, a.y - a.fi.anchorY) > 0.4)) {
    tickFighter(sim, a, dt);
    return;
  }
  a.moving = false;
  if (a.lookUntil <= sim.time && a.npcId) {
    const def = sim.chapter.npcs.find((d) => d.id === a.npcId);
    const [dx, dy] = DIRS[def?.dir ?? "down"];
    face(a, dx, dy);
  }
  locomotion(sim, a);
}

/** Players walking over drops collect them. */
export function tickProps(sim: Sim, a: Actor): void {
  if (!a.item) return;
  for (const p of sim.players.values()) {
    if (!p.pl || p.pl.downedAt >= 0) continue;
    if (Math.hypot(p.x - a.x, p.y - a.y) > 0.7) continue;
    const item = a.item;
    const id = p.id;
    sound(sim, "pickup", a.x, a.y);
    removeActor(sim, a);
    later(sim, () => sim.hooks.onPickup(id, item));
    return;
  }
}
