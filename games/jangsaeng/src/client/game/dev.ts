// Frame timing and the F3 developer overlay (screen space).

const WINDOW = 120;

export class FrameStats {
  readonly #work = new Float32Array(WINDOW);
  readonly #gap = new Float32Array(WINDOW);
  #i = 0;
  #n = 0;
  #fpsAcc = 0;
  #fpsFrames = 0;
  fps = 60;

  /** `gapMs`: time since the previous frame; `workMs`: time spent in it. */
  record(gapMs: number, workMs: number): void {
    this.#work[this.#i] = workMs;
    this.#gap[this.#i] = gapMs;
    this.#i = (this.#i + 1) % WINDOW;
    this.#n = Math.min(WINDOW, this.#n + 1);
    this.#fpsAcc += gapMs;
    this.#fpsFrames++;
    if (this.#fpsAcc >= 500) {
      this.fps = Math.round((this.#fpsFrames * 1000) / this.#fpsAcc);
      this.#fpsAcc = 0;
      this.#fpsFrames = 0;
    }
  }

  summary(): { workAvg: number; workP95: number; workMax: number; gapAvg: number; gapMax: number; frames: number } {
    const n = this.#n;
    if (!n) return { workAvg: 0, workP95: 0, workMax: 0, gapAvg: 0, gapMax: 0, frames: 0 };
    const work = Array.from(this.#work.subarray(0, n)).sort((a, b) => a - b);
    let sum = 0;
    let gapSum = 0;
    let gapMax = 0;
    for (let i = 0; i < n; i++) {
      sum += this.#work[i] as number;
      gapSum += this.#gap[i] as number;
      gapMax = Math.max(gapMax, this.#gap[i] as number);
    }
    return {
      workAvg: sum / n,
      workP95: work[Math.min(n - 1, Math.floor(n * 0.95))] as number,
      workMax: work[n - 1] as number,
      gapAvg: gapSum / n,
      gapMax,
      frames: n,
    };
  }
}

export function drawDevOverlay(ctx: CanvasRenderingContext2D, lines: readonly string[], unit: number): void {
  const fs = Math.round(11 * unit);
  const lh = Math.round(fs * 1.3);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
  const x = Math.round(8 * unit);
  const y = Math.round(8 * unit);
  ctx.fillStyle = "rgba(10,8,12,0.72)";
  ctx.fillRect(x - 4 * unit, y - 4 * unit, w + 8 * unit, lines.length * lh + 6 * unit);
  ctx.fillStyle = "#c8f0b0";
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i] as string, x, y + i * lh);
}
