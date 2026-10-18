// Tiny pixel-art toolkit: sprites are authored as rows of characters, each
// character naming a palette slot. Templates are compiled once into canvases
// and cached; palette swaps produce variants (ranks, eras, factions) from one
// drawing so the art stays consistent.

export type PixelRows = readonly string[];
/** Palette slot → CSS colour; slots missing from the map are transparent. */
export type PixelPalette = Readonly<Record<string, string>>;

export type Surface = HTMLCanvasElement;

export function createSurface(width: number, height: number): Surface {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

export function context2d(surface: Surface): CanvasRenderingContext2D {
  const ctx = surface.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Draws pixel rows onto `ctx` at (x, y); '.' and unknown slots are skipped. */
export function paintPixels(
  ctx: CanvasRenderingContext2D,
  rows: PixelRows,
  palette: PixelPalette,
  x = 0,
  y = 0,
): void {
  for (let row = 0; row < rows.length; row++) {
    const line = rows[row] as string;
    let run = 0;
    let runColor: string | undefined;
    let runStart = 0;
    const flush = (end: number) => {
      if (runColor && run > 0) {
        ctx.fillStyle = runColor;
        ctx.fillRect(x + runStart, y + row, end - runStart, 1);
      }
    };
    for (let column = 0; column <= line.length; column++) {
      const color =
        column < line.length ? palette[line[column] as string] : undefined;
      if (color !== runColor) {
        flush(column);
        runColor = color;
        runStart = column;
        run = 0;
      }
      run++;
    }
  }
}

export function compilePixels(rows: PixelRows, palette: PixelPalette): Surface {
  const width = Math.max(...rows.map((row) => row.length));
  const surface = createSurface(width, rows.length);
  paintPixels(context2d(surface), rows, palette);
  return surface;
}

export function mirrorSurface(source: Surface): Surface {
  const surface = createSurface(source.width, source.height);
  const ctx = context2d(surface);
  ctx.translate(source.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return surface;
}

/** Solid-colour silhouette of a sprite (hit flashes, shadows, outlines). */
export function silhouette(source: Surface, color: string): Surface {
  const surface = createSurface(source.width, source.height);
  const ctx = context2d(surface);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, surface.width, surface.height);
  return surface;
}

/** Adds a 1px dark outline around opaque pixels for legibility on terrain. */
export function outlined(
  source: Surface,
  color = "rgba(20,16,14,0.85)",
): Surface {
  const surface = createSurface(source.width + 2, source.height + 2);
  const ctx = context2d(surface);
  const edge = silhouette(source, color);
  for (const [dx, dy] of [
    [0, 1],
    [2, 1],
    [1, 0],
    [1, 2],
  ] as const)
    ctx.drawImage(edge, dx, dy);
  ctx.drawImage(source, 1, 1);
  return surface;
}

/** Memoises surfaces by key; build runs once per key. */
export class SurfaceCache {
  readonly #entries = new Map<string, Surface>();

  get(key: string, build: () => Surface): Surface {
    let surface = this.#entries.get(key);
    if (!surface) {
      surface = build();
      this.#entries.set(key, surface);
    }
    return surface;
  }

  get size(): number {
    return this.#entries.size;
  }
}
