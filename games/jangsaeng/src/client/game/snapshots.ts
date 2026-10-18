// Snapshot buffer and interpolation. Every entity keeps its last few server
// samples stamped on a smoothed timeline derived from host tick numbers, so
// arrival jitter does not distort motion. Remote entities render a little in
// the past (between two samples); the own entity renders closer to the
// newest sample and may extrapolate briefly while the player is steering.

import type { Anim, Dir } from "../../shared/sprites.ts";
import type { EntitySnap, Marker } from "../../shared/types.ts";

/** Positions further apart than this (tiles) are teleports, not motion. */
const TELEPORT_TILES = 4;
const RING = 4;
/** Fade-out for entities that died before the host dropped them. */
const DEATH_FADE_MS = 450;

/** Maps host ticks to client milliseconds with drift and jitter tracking. */
export class SnapClock {
  /** Estimated host milliseconds per tick. */
  tickMs = 50;
  /** Smoothed time between consecutive snapshots. */
  intervalMs = 50;
  /** Smoothed lateness of arrivals relative to the timeline (jitter). */
  lagMs = 0;
  #lastTick = Number.NaN;
  #lastTs = 0;
  #lastArrival = 0;

  reset(): void {
    this.#lastTick = Number.NaN;
    this.lagMs = 0;
  }

  /** Timeline timestamp for a snapshot of `tick` that arrived at `arrival`. */
  stamp(tick: number, arrival: number): number {
    const dTick = tick - this.#lastTick;
    let ts: number;
    if (!(dTick >= 0 && dTick <= 100)) {
      // First snapshot, host restart or a long stall: re-anchor.
      ts = arrival;
    } else {
      if (dTick > 0 && dTick <= 8) {
        const dA = arrival - this.#lastArrival;
        if (dA > 0) {
          const est = Math.min(500, Math.max(5, dA / dTick));
          this.tickMs += (est - this.tickMs) * 0.05;
        }
      }
      ts = this.#lastTs + dTick * this.tickMs;
      // Never ahead of reality; otherwise drift slowly towards arrivals so a
      // lasting latency change is absorbed without a visible jump.
      if (ts > arrival) ts = arrival;
      else ts += (arrival - ts) * 0.04;
      if (dTick > 0) this.intervalMs += (ts - this.#lastTs - this.intervalMs) * 0.1;
    }
    this.lagMs += (arrival - ts - this.lagMs) * 0.1;
    this.#lastTick = tick;
    this.#lastTs = ts;
    this.#lastArrival = arrival;
    return ts;
  }
}

class Sample {
  ts = 0;
  x = 0;
  y = 0;
  d: Dir = "down";
  a: Anim = "idle";
  animStart = 0;
  hp = 100;
  down = false;
  mk: Marker | undefined = undefined;
}

const LOOPING: Readonly<Record<Anim, boolean>> = {
  idle: true,
  walk: true,
  attack: false,
  shoot: false,
  cast: false,
  hurt: false,
  dead: false,
};

export class EntityTrack {
  readonly id: number;
  /** Latest raw snapshot (static fields: sprite, team, names). */
  snap: EntitySnap;
  readonly #ring: Sample[] = [];
  #head = -1;
  #count = 0;
  /** Timeline time at which the host dropped the entity. */
  goneAt = Number.POSITIVE_INFINITY;
  // Render state (tiles), recomputed every frame by EntityStore.update.
  x = 0;
  y = 0;
  dir: Dir = "down";
  anim: Anim = "idle";
  animTime = 0;
  hp = 100;
  down = false;
  mk: Marker | undefined = undefined;
  alpha = 1;
  /** Render state has been computed at least once. */
  seen = false;
  /** Client time until which the hit flash shows. */
  flashUntil = 0;
  /** Per-entity phase so idle crowds do not breathe in sync. */
  readonly phase: number;

  constructor(snap: EntitySnap) {
    this.id = snap.id;
    this.snap = snap;
    this.phase = (snap.id * 389) % 997;
    for (let i = 0; i < RING; i++) this.#ring.push(new Sample());
  }

  get newest(): { x: number; y: number } | null {
    return this.#count ? (this.#ring[this.#head] as Sample) : null;
  }

  push(snap: EntitySnap, ts: number): void {
    this.snap = snap;
    this.goneAt = Number.POSITIVE_INFINITY;
    const prev = this.#count ? (this.#ring[this.#head] as Sample) : null;
    let slot: Sample;
    if (prev && ts <= prev.ts) slot = prev; // same tick again: overwrite
    else {
      this.#head = (this.#head + 1) % RING;
      this.#count = Math.min(RING, this.#count + 1);
      slot = this.#ring[this.#head] as Sample;
    }
    let animStart: number;
    if (snap.at !== undefined && Number.isFinite(snap.at)) {
      const start = ts - Math.max(0, snap.at);
      // Keep a stable start while the same animation continues.
      animStart = prev && prev.a === snap.a && Math.abs(prev.animStart - start) < 80 ? prev.animStart : start;
    } else if (prev && prev.a === snap.a) animStart = prev.animStart;
    else animStart = LOOPING[snap.a] ? ts - this.phase : ts;
    slot.ts = ts;
    slot.x = snap.x;
    slot.y = snap.y;
    slot.d = snap.d;
    slot.a = snap.a;
    slot.animStart = animStart;
    slot.hp = snap.hp ?? 100;
    slot.down = snap.down ?? false;
    slot.mk = snap.mk;
  }

  /** The `index`-th newest sample (0 = newest). */
  #sampleAt(index: number): Sample {
    return this.#ring[(this.#head - index + RING * 2) % RING] as Sample;
  }

  /**
   * Fills the render state for timeline time `r`. `extrapolateMs` allows
   * continuing the last motion past the newest sample.
   */
  evaluate(r: number, extrapolateMs: number): void {
    if (!this.#count) return;
    let base = this.#sampleAt(0);
    let next: Sample | null = null;
    for (let i = 0; i < this.#count; i++) {
      const s = this.#sampleAt(i);
      if (s.ts <= r || i === this.#count - 1) {
        base = s;
        next = i > 0 ? this.#sampleAt(i - 1) : null;
        break;
      }
    }
    let x = base.x;
    let y = base.y;
    if (next) {
      const span = next.ts - base.ts;
      const far = Math.abs(next.x - base.x) + Math.abs(next.y - base.y) > TELEPORT_TILES;
      if (span > 0 && !far) {
        const k = Math.min(1, Math.max(0, (r - base.ts) / span));
        x += (next.x - base.x) * k;
        y += (next.y - base.y) * k;
      }
    } else if (extrapolateMs > 0 && r > base.ts && this.#count > 1) {
      const before = this.#sampleAt(1);
      const span = base.ts - before.ts;
      const dx = base.x - before.x;
      const dy = base.y - before.y;
      if (span > 0 && span < 300 && Math.abs(dx) + Math.abs(dy) < TELEPORT_TILES) {
        const ahead = Math.min(r - base.ts, extrapolateMs) / span;
        x += dx * ahead;
        y += dy * ahead;
      }
    }
    this.x = x;
    this.y = y;
    this.dir = base.d;
    this.anim = base.a;
    this.animTime = Math.max(0, r - base.animStart);
    this.down = base.down;
    this.mk = base.mk;
    this.hp = base.hp;
  }
}

export interface DelayConfig {
  /** Minimum render delay for remote entities (ms). */
  remoteMin: number;
  /** Minimum render delay for the own entity (ms). */
  selfMin: number;
}

export class EntityStore {
  readonly clock = new SnapClock();
  readonly tracks = new Map<number, EntityTrack>();
  /** Stable iteration list (same objects as `tracks`). */
  readonly list: EntityTrack[] = [];
  /** Latest raw snapshots, for the minimap. */
  readonly snaps: EntitySnap[] = [];
  selfId = -1;
  remoteDelay = 100;
  selfDelay = 50;
  #snapsDirty = false;
  /** Timeline "now" of the last update (for fx scheduling). */
  #lastStamp = 0;

  clear(): void {
    this.tracks.clear();
    this.list.length = 0;
    this.snaps.length = 0;
    this.clock.reset();
  }

  get self(): EntityTrack | undefined {
    return this.tracks.get(this.selfId);
  }

  applySnap(tick: number, ents: readonly EntitySnap[], gone: readonly number[], arrival: number): void {
    const ts = this.clock.stamp(tick, arrival);
    this.#lastStamp = ts;
    for (const snap of ents) {
      if (!snap || typeof snap.id !== "number" || !Number.isFinite(snap.x) || !Number.isFinite(snap.y)) continue;
      let track = this.tracks.get(snap.id);
      if (!track) {
        track = new EntityTrack(snap);
        this.tracks.set(snap.id, track);
        this.list.push(track);
      }
      track.push(snap, ts);
    }
    for (const id of gone) {
      const track = this.tracks.get(id);
      if (track) track.goneAt = ts;
    }
    this.#snapsDirty = true;
  }

  /** Time (client clock) at which an event that just arrived becomes visible. */
  visibleDelay(): number {
    return Math.max(0, this.remoteDelay - this.clock.lagMs);
  }

  get lastStamp(): number {
    return this.#lastStamp;
  }

  /**
   * Recomputes every entity's render state for client time `now`.
   * `selfSteering` enables a short extrapolation for the own entity.
   */
  update(now: number, cfg: DelayConfig, selfSteering: boolean): void {
    const c = this.clock;
    this.remoteDelay = Math.min(300, Math.max(cfg.remoteMin, c.intervalMs + c.lagMs * 2 + 8));
    this.selfDelay = Math.min(150, Math.max(cfg.selfMin, c.intervalMs * 0.5 + c.lagMs));
    const rRemote = now - this.remoteDelay;
    const rSelf = now - this.selfDelay;
    let removed = false;
    for (const track of this.list) {
      const isSelf = track.id === this.selfId;
      const r = isSelf ? rSelf : rRemote;
      const prevHp = track.hp;
      track.evaluate(r, isSelf ? (selfSteering ? c.intervalMs * 0.6 : 0) : 60);
      if (track.seen && track.hp < prevHp) track.flashUntil = now + 120;
      track.seen = true;
      if (r >= track.goneAt) {
        const dying = track.anim === "dead" || track.hp <= 0;
        const fade = dying ? 1 - (r - track.goneAt) / DEATH_FADE_MS : 0;
        if (fade <= 0) {
          this.tracks.delete(track.id);
          removed = true;
          continue;
        }
        track.alpha = fade;
      } else track.alpha = 1;
    }
    if (removed) {
      let w = 0;
      for (const track of this.list) if (this.tracks.get(track.id) === track) this.list[w++] = track;
      this.list.length = w;
      this.#snapsDirty = true;
    }
    if (this.#snapsDirty) {
      this.snaps.length = 0;
      for (const track of this.list) if (track.goneAt === Number.POSITIVE_INFINITY) this.snaps.push(track.snap);
      this.#snapsDirty = false;
    }
  }
}
