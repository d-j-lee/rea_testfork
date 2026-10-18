// Contracts between render modules. All world drawing happens in world pixels
// (1 tile = TILE_PX); the frame renderer applies the camera transform once.

export interface Camera {
  /** Centre of the view in world pixels. */
  x: number;
  y: number;
  /** Integer device-pixel scale (world px → device px). */
  scale: number;
  /** Viewport size in device pixels. */
  width: number;
  height: number;
}

/** Visible world rectangle derived from a camera, in tiles (inclusive). */
export interface TileView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Anything drawn in the depth-sorted pass (structures, characters, props). */
export interface Drawable {
  /** World-pixel y of the object's ground contact; larger draws later. */
  sortY: number;
  draw(ctx: CanvasRenderingContext2D, timeMs: number): void;
}

export function tileViewOf(
  camera: Camera,
  tilePx: number,
  margin = 2,
): TileView {
  const halfW = camera.width / camera.scale / 2;
  const halfH = camera.height / camera.scale / 2;
  return {
    x0: Math.floor((camera.x - halfW) / tilePx) - margin,
    y0: Math.floor((camera.y - halfH) / tilePx) - margin,
    x1: Math.ceil((camera.x + halfW) / tilePx) + margin,
    y1: Math.ceil((camera.y + halfH) / tilePx) + margin,
  };
}
