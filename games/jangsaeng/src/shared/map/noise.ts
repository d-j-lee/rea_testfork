import { hashString } from "../rng.ts";

/** Seeded 2D value noise with smooth interpolation and fBm layering. */
export function createNoise(seed: number | string) {
  const base = typeof seed === "string" ? hashString(seed) : seed >>> 0;

  const lattice = (ix: number, iy: number): number => {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ base;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);

  /** Single octave in [0, 1). */
  const value = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };

  /** Fractal sum of octaves, normalised to [0, 1). */
  const fbm = (x: number, y: number, octaves = 4): number => {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    for (let octave = 0; octave < octaves; octave++) {
      sum += value(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / total;
  };

  return { value, fbm };
}

export type Noise = ReturnType<typeof createNoise>;
