export interface Vec2 {
  x: number;
  y: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

export const distance = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const distanceSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function normalize(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y);
  return length > 1e-9 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

/** Rounds to a fixed number of decimals for compact network payloads. */
export const quantize = (value: number, decimals = 2): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};
