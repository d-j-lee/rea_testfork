// Effects showcase: each effect kind snapshotted mid-flight next to a
// character, plus damage numbers, name plates, HP bars, emotes and the
// selection ring.
import { EFFECT_KINDS, type EffectKind } from "../../src/shared/sprites.ts";
import { drawCharacter } from "../../src/client/render/characters.ts";
import { EffectSystem } from "../../src/client/render/effects.ts";
import { drawEmote, drawHpBar, drawNamePlate, drawSelectionRing } from "../../src/client/render/overlays.ts";
import { drawProp } from "../../src/client/render/props.ts";
import { ground, label, setup, world, SCALE } from "./sheet-lib.ts";

const cw = 56;
const ch = 54;
const cols = 6;
const rows = 4;
const W = cw * cols;
const H = ch * rows;
const ctx = setup(W * SCALE, H * SCALE);
world(ctx);
ground(ctx, 0, 0, W, H, "grass");

const snap: Record<EffectKind, number> = {
  slash: 90, thrust: 70, arrow: 120, bullet: 40, cannonball: 300, fire: 1500, smoke: 300,
  spark: 60, heal: 300, levelup: 350, dust: 120, splash: 150, explosion: 120, shout: 160,
};

const cells: { kind: EffectKind | "text" | "ui"; col: number; row: number }[] = [];
EFFECT_KINDS.forEach((k, i) => cells.push({ kind: k, col: i % cols, row: Math.floor(i / cols) }));
cells.push({ kind: "text", col: EFFECT_KINDS.length % cols, row: Math.floor(EFFECT_KINDS.length / cols) });
cells.push({ kind: "ui", col: (EFFECT_KINDS.length + 1) % cols, row: Math.floor((EFFECT_KINDS.length + 1) / cols) });

for (const cell of cells) {
  const ox = cell.col * cw;
  const oy = cell.row * ch;
  const gx = ox + 18;
  const gy = oy + 40;
  const fx = new EffectSystem();
  label(ctx, cell.kind, ox + cw / 2, oy + 1);
  if (cell.kind === "text") {
    drawCharacter(ctx, "wokou", gx + 10, gy, "left", "hurt", 50, { flash: "rgba(255,255,255,0.75)" });
    fx.floatText("27", gx + 4, gy - 22);
    fx.floatText("152", gx + 18, gy - 30, { crit: true });
    fx.floatText("MISS", gx - 6, gy - 12, { color: "#c8d8f0" });
    fx.floatText("+40", gx + 26, gy - 8, { color: "#7fdc6a" });
    fx.floatText("막기!", gx + 8, gy + 8, { color: "#e8e0c8" });
    fx.update(60);
    fx.draw(ctx, 60);
    continue;
  }
  if (cell.kind === "ui") {
    drawSelectionRing(ctx, gx + 10, gy, "#ff8a7a", 300);
    drawCharacter(ctx, "japanese_samurai", gx + 10, gy, "down", "idle", 0);
    drawHpBar(ctx, gx + 10, gy - 30, 0.62);
    drawNamePlate(ctx, "왜장 무사", gx + 10, gy - 32, { color: "#ff8a7a", level: 23, title: "임진 선봉" });
    drawEmote(ctx, "alert", gx + 24, gy - 26, 0);
    continue;
  }
  const kind = cell.kind;
  const dir = "right" as const;
  if (kind === "fire") {
    drawProp(ctx, "campfire", gx + 14, gy, 0);
    fx.spawn("fire", gx + 14, gy - 2, { durationMs: 4000 });
  } else if (kind === "arrow" || kind === "bullet" || kind === "cannonball") {
    const who = kind === "arrow" ? "archer_joseon" : kind === "bullet" ? "musketeer_joseon" : null;
    if (who) drawCharacter(ctx, who, gx - 6, gy, "right", "shoot", kind === "bullet" ? 160 : 200);
    else drawProp(ctx, "cannon", gx - 4, gy, 0);
    drawCharacter(ctx, "wokou", gx + 32, gy, "left", "idle", 0);
    fx.spawn(kind, gx - 6, gy, { tx: gx + 32, ty: gy });
  } else {
    const who = kind === "thrust" ? "soldier_joseon" : kind === "heal" ? "monk" : kind === "levelup" ? "hero_youth" : kind === "shout" ? "general_joseon" : "hero_joseon_general";
    const anim = kind === "slash" ? "attack" : kind === "thrust" ? "attack" : kind === "shout" ? "cast" : kind === "dust" ? "walk" : "idle";
    if (kind !== "explosion" && kind !== "smoke" && kind !== "splash")
      drawCharacter(ctx, who, gx + 4, gy, dir, anim, kind === "slash" || kind === "thrust" ? 120 : 300);
    const at = kind === "spark" ? [gx + 18, gy - 10] : kind === "explosion" || kind === "smoke" || kind === "splash" ? [gx + 12, gy] : [gx + 4, gy];
    if (kind === "spark") drawCharacter(ctx, "wokou", gx + 22, gy, "left", "hurt", 40, { flash: "#ffffff" });
    fx.spawn(kind, at[0] as number, at[1] as number, { dir });
  }
  const t = snap[kind];
  for (let s = 0; s < t; s += 16) fx.update(Math.min(16, t - s));
  fx.draw(ctx, t);
  label(ctx, `${fx.count}p`, ox + cw - 6, oy + ch - 9, "#9fd3ff");
}
console.log("effects drawn");
