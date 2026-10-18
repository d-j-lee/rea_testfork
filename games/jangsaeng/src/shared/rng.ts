// Deterministic, serializable PRNG (sfc32). Simulation code must draw all
// randomness from an Rng so server, offline host and tests agree for a seed.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Current internal state; feed to createRng's `state` to resume. */
  state(): RngState;
}

export type RngState = readonly [number, number, number, number];

export function hashString(text: string): number {
  // FNV-1a 32-bit.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed: number | string, state?: RngState): Rng {
  const base = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  let [a, b, c, d] = state ?? [0x9e3779b9, 0x243f6a88, 0xb7e15162, base];
  if (!state) for (let index = 0; index < 15; index++) raw();

  function raw(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  return {
    next: raw,
    int: (min, max) => min + Math.floor(raw() * (max - min + 1)),
    range: (min, max) => min + raw() * (max - min),
    chance: (probability) => raw() < probability,
    pick: (items) => {
      if (items.length === 0) throw new RangeError("pick from empty list");
      return items[Math.floor(raw() * items.length)] as (typeof items)[number];
    },
    state: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
}
