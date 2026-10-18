// Interest-managed snapshots: entities within 24 tiles of a viewer (always
// self and the active boss), with per-viewer `gone` tracking.
import type { EntitySnap, Team } from "../types.ts";
import { C, type Actor, type Sim } from "./state.ts";

const q = (v: number): number => Math.round(v * 100) / 100;

function teamOf(a: Actor, viewer: number): Team {
  if (a.id === viewer) return "self";
  if (a.pl) return "player";
  if (a.en) return a.en.boss ? "boss" : "enemy";
  if (a.kind === "ally" || a.defend) return "ally";
  return "npc";
}

function snap(sim: Sim, a: Actor, viewer: number): EntitySnap {
  const s: EntitySnap = {
    id: a.id,
    k: a.kind,
    s: a.sprite,
    x: q(a.x),
    y: q(a.y),
    d: a.dir,
    a: a.anim,
    at: Math.max(0, Math.round((sim.time - a.animAt) * 1000)),
    tm: teamOf(a, viewer),
  };
  if (a.kind !== "prop" || a.defend) s.hp = a.alive ? Math.max(0, Math.min(100, Math.ceil((a.hp / a.maxHp) * 100))) : 0;
  if (a.name) s.n = a.name;
  if (a.title) s.title = a.title;
  if (a.pl || a.en) s.lvl = a.level;
  if (a.variant) s.v = a.variant;
  if (a.hist) s.hist = true;
  if (a.pl?.bot) s.bot = true;
  if (a.pl && a.pl.downedAt >= 0) s.down = true;
  if (a.npcId) {
    const mk = sim.hooks.npcMarker(viewer, a.npcId);
    if (mk) s.mk = mk;
  } else if (a.en && a.alive && a.markUntil > sim.time) s.mk = "alert";
  return s;
}

export function snapshotFor(sim: Sim, viewerId: number, seen: Map<number, Set<number>>): { ents: EntitySnap[]; gone: number[] } {
  const viewer = sim.actors.get(viewerId);
  const previous = seen.get(viewerId) ?? new Set<number>();
  const current = new Set<number>();
  const list: Actor[] = [];
  if (viewer) {
    for (const a of sim.index.query(viewer.x, viewer.y, C.INTEREST)) {
      if (a.removed) continue;
      current.add(a.id);
      list.push(a);
    }
    if (!current.has(viewer.id)) {
      current.add(viewer.id);
      list.push(viewer);
    }
    const bossId = sim.battle?.bossId ?? -1;
    const boss = bossId >= 0 ? sim.actors.get(bossId) : undefined;
    if (boss && !current.has(boss.id)) {
      current.add(boss.id);
      list.push(boss);
    }
  }
  list.sort((m, n) => m.id - n.id);
  const gone: number[] = [];
  for (const id of previous) if (!current.has(id)) gone.push(id);
  gone.sort((m, n) => m - n);
  seen.set(viewerId, current);
  return { ents: list.map((a) => snap(sim, a, viewerId)), gone };
}
