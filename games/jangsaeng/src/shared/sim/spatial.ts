// Uniform-grid spatial index for entity proximity queries (combat targeting,
// aggro, interest management). Rebuilt or updated incrementally per tick.

export interface Positioned {
  readonly id: number;
  x: number;
  y: number;
}

export class SpatialIndex<T extends Positioned> {
  readonly #cell: number;
  readonly #buckets = new Map<number, Set<T>>();
  readonly #where = new Map<number, number>();

  constructor(cellSize = 8) {
    this.#cell = cellSize;
  }

  #key(x: number, y: number): number {
    return (
      (Math.floor(y / this.#cell) << 16) | (Math.floor(x / this.#cell) & 0xffff)
    );
  }

  insert(item: T): void {
    this.update(item);
  }

  update(item: T): void {
    const key = this.#key(item.x, item.y);
    const previous = this.#where.get(item.id);
    if (previous === key) return;
    if (previous !== undefined) this.#buckets.get(previous)?.delete(item);
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      bucket = new Set();
      this.#buckets.set(key, bucket);
    }
    bucket.add(item);
    this.#where.set(item.id, key);
  }

  remove(item: T): void {
    const previous = this.#where.get(item.id);
    if (previous === undefined) return;
    const bucket = this.#buckets.get(previous);
    bucket?.delete(item);
    if (bucket && bucket.size === 0) this.#buckets.delete(previous);
    this.#where.delete(item.id);
  }

  /** Items within `radius` of (x, y), optionally filtered. */
  query(
    x: number,
    y: number,
    radius: number,
    filter?: (item: T) => boolean,
  ): T[] {
    const found: T[] = [];
    const c = this.#cell;
    const x0 = Math.floor((x - radius) / c);
    const x1 = Math.floor((x + radius) / c);
    const y0 = Math.floor((y - radius) / c);
    const y1 = Math.floor((y + radius) / c);
    const r2 = radius * radius;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.#buckets.get((cy << 16) | (cx & 0xffff));
        if (!bucket) continue;
        for (const item of bucket) {
          const dx = item.x - x;
          const dy = item.y - y;
          if (dx * dx + dy * dy <= r2 && (!filter || filter(item)))
            found.push(item);
        }
      }
    return found;
  }

  /** Nearest item within `radius` matching the filter. */
  nearest(
    x: number,
    y: number,
    radius: number,
    filter?: (item: T) => boolean,
  ): T | undefined {
    let best: T | undefined;
    let bestD = Infinity;
    for (const item of this.query(x, y, radius, filter)) {
      const d = (item.x - x) ** 2 + (item.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  get size(): number {
    return this.#where.size;
  }
}
