// Performance probe: cold frame builds, warm draw cost, effects at the cap.
import { CHARACTER_SPRITES, type Anim, type Dir } from "../../src/shared/sprites.ts";
import { characterCachePixels, characterCacheSize, drawCharacter, warmCharacter } from "../../src/client/render/characters.ts";
import { EffectSystem } from "../../src/client/render/effects.ts";
import { drawHpBar, drawNamePlate } from "../../src/client/render/overlays.ts";
import { context2d } from "../../src/client/render/pixel.ts";

const canvas = document.getElementById("preview") as HTMLCanvasElement;
canvas.width = 960;
canvas.height = 640;
const ctx = context2d(canvas);
ctx.setTransform(3, 0, 0, 3, 0, 0);
const log = (s: string) => console.log(s);

// 1. One sprite fully warmed (all dirs/anims/frames), cold.
let t0 = performance.now();
warmCharacter("hero_youth");
log(`warm hero_youth (68 frames): ${(performance.now() - t0).toFixed(1)} ms`);

// 2. Every sprite, every frame (worst case: whole library).
t0 = performance.now();
for (const k of CHARACTER_SPRITES) warmCharacter(k);
const all = performance.now() - t0;
const n = characterCacheSize();
log(`warm all ${CHARACTER_SPRITES.length} sprites: ${all.toFixed(0)} ms, ${n} surfaces, ${(characterCachePixels() * 4 / 1048576).toFixed(1)} MB pixels`);
// Memory estimate: sum of surface pixels (via a fresh sample of frame sizes).
// 3. Typical screen: 60 characters walking, warm cache.
const dirs: Dir[] = ["down", "left", "up", "right"];
const anims: Anim[] = ["walk", "idle", "attack"];
const N = 60;
const frames = 300;
t0 = performance.now();
for (let f = 0; f < frames; f++) {
  ctx.fillStyle = "#6b9a4a";
  ctx.fillRect(0, 0, 320, 214);
  for (let i = 0; i < N; i++) {
    const key = CHARACTER_SPRITES[i % CHARACTER_SPRITES.length]!;
    const x = 10 + (i % 15) * 20;
    const y = 30 + Math.floor(i / 15) * 45;
    drawCharacter(ctx, key, x, y, dirs[(i + f) % 4]!, anims[i % 3]!, f * 16 + i * 37, i % 7 === 0 ? { flash: "rgba(255,255,255,0.7)" } : undefined);
    drawHpBar(ctx, x, y - 30, (i % 10) / 10);
    drawNamePlate(ctx, `병사${i}`, x, y - 32, { color: "#f3ecdc", level: i });
  }
}
const per = (performance.now() - t0) / frames;
log(`draw ${N} chars + hp + plates: ${per.toFixed(3)} ms/frame (warm, ${frames} frames)`);

// 4. Effects at the cap.
const fx = new EffectSystem();
for (let i = 0; i < 60; i++) {
  fx.spawn("explosion", 40 + (i % 10) * 25, 40 + Math.floor(i / 10) * 25);
  fx.spawn("fire", 40 + (i % 10) * 25, 60, { durationMs: 10000 });
  fx.floatText(`${i * 7}`, 50 + i * 3, 80, { crit: i % 5 === 0 });
}
fx.update(16);
log(`effects live particles after burst: ${fx.count}`);
t0 = performance.now();
const steps = 300;
for (let f = 0; f < steps; f++) {
  fx.update(16);
  if (f % 3 === 0) fx.spawn("spark", 100, 100);
  fx.draw(ctx, f * 16);
}
log(`effects update+draw at cap: ${((performance.now() - t0) / steps).toFixed(3)} ms/frame, live=${fx.count}`);
const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
if (mem) log(`JS heap used: ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB`);
