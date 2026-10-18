// Frame-cost benchmark for the world renderer (logs to the console).
//   node scripts/preview.mjs tools/preview/world-perf.ts out.png 1280 720 20000
// Measures cold chunk builds, then warm frames while panning: drawGround and
// the structure pass (cull + sort + draw) separately, at several viewports.
import { drawAtmosphere } from "../../src/client/render/lighting.ts";
import type { Camera } from "../../src/client/render/types.ts";
import { WorldRenderer, applyCamera, type Season } from "../../src/client/render/world.ts";
import { viewCentre, worldMap } from "./world-lib.ts";

interface Case {
  name: string;
  site: string;
  width: number;
  height: number;
  scale: number;
  season: Season;
}

const cases: Case[] = [
  { name: "desktop 1280×720 ×3 한양", site: "hanyang", width: 1280, height: 720, scale: 3, season: "summer" },
  { name: "desktop 1280×720 ×3 부산 coast", site: "dongnae", width: 1280, height: 720, scale: 3, season: "summer" },
  { name: "desktop 1920×1080 ×2 한양", site: "hanyang", width: 1920, height: 1080, scale: 2, season: "autumn" },
  { name: "phone 1080×2340 ×3 전주", site: "jeonju", width: 1080, height: 2340, scale: 3, season: "spring" },
];

const canvas = document.getElementById("preview") as HTMLCanvasElement;
// (A plain 2D context, as the game uses; readbacks below only force a flush.)
const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  return `avg ${avg.toFixed(2)}ms p95 ${p95.toFixed(2)}ms max ${(sorted[sorted.length - 1] ?? 0).toFixed(2)}ms`;
};

// Run after the page's load event so the preview harness does not time out.
setTimeout(run, 0);

function run(): void {
const map = worldMap();
for (const c of cases) {
  canvas.width = c.width;
  canvas.height = c.height;
  const ctx = canvas.getContext("2d")!;
  const renderer = new WorldRenderer(map);
  renderer.setSeason(c.season);
  const centre = viewCentre(map, { label: "", site: c.site, scale: c.scale, season: c.season, year: 1450 });
  const camera: Camera = { x: centre.x, y: centre.y, scale: c.scale, width: c.width, height: c.height };
  const t0 = performance.now();
  renderer.warm(camera);
  const cold = performance.now() - t0;
  const built = renderer.stats.totalBuilt;
  // First structure pass builds sprites lazily.
  const s0 = performance.now();
  for (const d of renderer.structureDrawables(camera, 0)) d.draw(ctx, 0);
  const coldStructures = performance.now() - s0;
  const ground: number[] = [];
  const structures: number[] = [];
  const atmosphere: number[] = [];
  const full: number[] = [];
  const bare: number[] = [];
  const frames = 240;
  for (let f = 0; f < frames; f++) {
    const t = f * 16.7;
    // Pan slowly back and forth across a few tiles (stays within warm chunks).
    camera.x = centre.x + Math.sin(f / 40) * 48;
    camera.y = centre.y + Math.cos(f / 55) * 32;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const a = performance.now();
    applyCamera(ctx, camera);
    renderer.drawGround(ctx, camera, t);
    const b = performance.now();
    const list = renderer.structureDrawables(camera, t);
    list.sort((p, q) => p.sortY - q.sortY);
    for (const d of list) d.draw(ctx, t);
    const e = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Even frames: night + rain overlay; odd frames: clear noon (no overlay cost).
    if (f % 2 === 0) drawAtmosphere(ctx, c.width, c.height, { hour: 20, weather: "rain", timeMs: t, pixelScale: c.scale });
    const g = performance.now();
    // Force the canvas to finish rasterising this frame's commands.
    ctx.getImageData(0, 0, 1, 1);
    const h = performance.now();
    if (f >= 20) {
      (f % 2 === 0 ? full : bare).push(h - a);
      ground.push(b - a);
      structures.push(e - b);
      if (f % 2 === 0) atmosphere.push(g - e);
    }
  }
  // Season switch: old chunks stay visible while rebuilt progressively.
  renderer.setSeason(c.season === "winter" ? "summer" : "winter");
  const switchFrames: number[] = [];
  for (let f = 0; f < 400; f++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const a = performance.now();
    applyCamera(ctx, camera);
    renderer.drawGround(ctx, camera, f * 16.7);
    ctx.getImageData(0, 0, 1, 1);
    switchFrames.push(performance.now() - a);
    if (renderer.stats.builtLastFrame > 0) console.log("  (unexpected synchronous build during season switch)");
    if (f > 0 && switchFrames.length > 2 && renderer.stats.totalBuilt >= built * 2 + 1) break;
  }
  console.log(`  season switch: ${switchFrames.length} frames to refresh visible + ring, ${stats(switchFrames)}`);
  // Walking: a fresh renderer, only the starting view warm, then pan east at
  // ~2 px/frame (≈120 px/s at 60 fps) for 600 frames. Chunk builds happen
  // inside drawGround (synchronously when visible, sliced when prefetched).
  const walker = new WorldRenderer(map);
  walker.setSeason(c.season);
  const walkCam: Camera = { ...camera, x: centre.x, y: centre.y };
  walker.warm(walkCam);
  for (const d of walker.structureDrawables(walkCam, 0)) d.draw(ctx, 0);
  const walk: number[] = [];
  let syncBuilds = 0;
  for (let f = 0; f < 600; f++) {
    walkCam.x = centre.x + f * 2;
    walkCam.y = centre.y + Math.sin(f / 90) * 40;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const a = performance.now();
    applyCamera(ctx, walkCam);
    walker.drawGround(ctx, walkCam, f * 16.7);
    const list = walker.structureDrawables(walkCam, f * 16.7);
    list.sort((p, q) => p.sortY - q.sortY);
    for (const d of list) d.draw(ctx, f * 16.7);
    ctx.getImageData(0, 0, 1, 1);
    walk.push(performance.now() - a);
    syncBuilds += walker.stats.builtLastFrame;
  }
  const over = (ms: number) => walk.filter((v) => v > ms).length;
  console.log(`  walking 600 frames: ${stats(walk)}; frames >8ms ${over(8)}, >16ms ${over(16)}; synchronous chunk builds ${syncBuilds}, total built ${walker.stats.totalBuilt}`);
  const s = renderer.stats;
  console.log(
    `${c.name}: cold ${cold.toFixed(1)}ms for ${built} chunks (${(cold / Math.max(1, built)).toFixed(2)}ms/chunk), cold structure sprites ${coldStructures.toFixed(1)}ms | ` +
      `drawGround ${stats(ground)} | structures ${stats(structures)} | atmosphere(rain,night) ${stats(atmosphere)} | full frame incl. raster flush: no overlay ${stats(bare)}, night+rain ${stats(full)} | cached ${s.cachedChunks}, total built ${s.totalBuilt}, ripples ${s.ripplesDrawn}`,
  );
}
}
