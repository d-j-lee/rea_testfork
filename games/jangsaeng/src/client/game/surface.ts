// The full-window game canvas: device-pixel-ratio aware backing store with a
// pixel budget (phones with dpr 3 render at ≤ 2× and let CSS upscale), and
// nearest-neighbour presentation for crisp pixel art.

/** Backing-store pixel budget; above it the effective pixel ratio drops. */
const PIXEL_BUDGET = 4_200_000;
const MAX_RATIO = 2;

export class GameCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Canvas pixels per CSS pixel. */
  unit = 1;
  cssWidth = 1;
  cssHeight = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("이 브라우저에서는 캔버스를 사용할 수 없습니다.");
    this.ctx = ctx;
    const style = canvas.style;
    style.position = "fixed";
    style.left = "0";
    style.top = "0";
    style.width = "100%";
    style.height = "100%";
    style.display = "block";
    style.imageRendering = "pixelated";
    style.touchAction = "none";
    style.userSelect = "none";
    style.setProperty("-webkit-tap-highlight-color", "transparent");
    this.fit();
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Matches the backing store to the window; true when it changed. */
  fit(): boolean {
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
    let unit = Math.min(MAX_RATIO, Math.max(1, window.devicePixelRatio || 1));
    if (cssW * cssH * unit * unit > PIXEL_BUDGET) unit = Math.max(1, Math.sqrt(PIXEL_BUDGET / (cssW * cssH)));
    const w = Math.max(1, Math.round(cssW * unit));
    const h = Math.max(1, Math.round(cssH * unit));
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.unit = w / cssW;
    if (w === this.canvas.width && h === this.canvas.height) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    return true;
  }

  /** Clears transform/alpha/composite state (after an exception mid-frame). */
  resetState(): void {
    const ctx = this.ctx as CanvasRenderingContext2D & { reset?: () => void };
    if (typeof ctx.reset === "function") ctx.reset();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;
  }
}
