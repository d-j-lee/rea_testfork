// Name-plate policy, free of the canvas so it can be tested: who a plate
// belongs to (from the host's snapshot facts), the placement order, which
// plates may be dropped in a crowd, and the placement pass itself.

import type { EntitySnap, Marker } from "../../shared/types.ts";

/**
 * Plate roles. Simulated companions (◇) share the "player" team with real
 * people in snapshots; their entity kind ("bot") sets them apart, and in a
 * crowd they give way like allies.
 */
export type PlateRole = "self" | "player" | "boss" | "story" | "companion" | "ally" | "npc" | "enemy";

/**
 * The static snapshot facts a role reads. The marker is not one of them:
 * the raw snapshot runs ahead of the render delay, so the caller passes the
 * marker it draws this frame (EntityTrack.mk).
 */
type PlateFacts = Pick<EntitySnap, "k" | "tm" | "hist">;

/** Placement order: lower places first and keeps its spot. */
const PRIORITY: Readonly<Record<PlateRole, number>> = {
  self: 0,
  player: 1,
  boss: 2,
  story: 3,
  companion: 4,
  ally: 4,
  npc: 5,
  enemy: 6,
};

const MAX_NUDGES = 2;
/** Companion and ally titles show only while at most this many are on screen. */
export const PARTY_TITLES_MAX = 3;

export function plateRole(facts: PlateFacts, marker: Marker | undefined, isSelf: boolean): PlateRole {
  if (isSelf || facts.tm === "self") return "self";
  switch (facts.tm) {
    case "player":
      return facts.k === "bot" ? "companion" : "player";
    case "boss":
      return "boss";
    case "enemy":
      return "enemy";
    case "ally":
      return "ally";
    case "npc":
      return marker || facts.hist ? "story" : "npc";
  }
}

/** Companions and allies: the party around the player, decluttered together. */
export const isParty = (role: PlateRole): boolean => role === "companion" || role === "ally";

/** Plates that still overlap after the nudges are dropped (the HP bar stays). */
const droppable = (role: PlateRole): boolean => PRIORITY[role] >= PRIORITY.companion;

/** A plate rectangle in world px; y1 is the plate's bottom. */
export interface PlateBox {
  role: PlateRole;
  /** Distance from the player (tiles), the tie-break inside one priority. */
  dist: number;
  plate: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const byPlacement = (a: PlateBox, b: PlateBox): number =>
  PRIORITY[a.role] - PRIORITY[b.role] || a.dist - b.dist;

/**
 * Places plates in `order` (already sorted by byPlacement): a plate that
 * overlaps one placed before it is nudged up, at most MAX_NUDGES times;
 * a droppable plate that still overlaps is hidden (`plate = false`).
 */
export function placePlates(order: readonly PlateBox[]): void {
  for (let i = 0; i < order.length; i++) {
    const s = order[i] as PlateBox;
    if (!s.plate) continue;
    for (let nudge = 0; ; nudge++) {
      const hit = overlap(order, s, i);
      if (!hit) break;
      if (nudge >= MAX_NUDGES) {
        if (droppable(s.role)) s.plate = false;
        break;
      }
      const dy = s.y1 - hit.y0 + 0.5;
      s.y0 -= dy;
      s.y1 -= dy;
    }
  }
}

/** First already-placed plate (index < upto) overlapping `s`. */
function overlap(order: readonly PlateBox[], s: PlateBox, upto: number): PlateBox | null {
  for (let j = 0; j < upto; j++) {
    const o = order[j] as PlateBox;
    if (!o.plate) continue;
    if (o.x0 < s.x1 && o.x1 > s.x0 && o.y0 < s.y1 && o.y1 > s.y0) return o;
  }
  return null;
}
