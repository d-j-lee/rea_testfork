// In-context check: a small market/battle scene with props, characters,
// overlays and effects at the game's scale (SCENE_SCALE, default 3).
import type { CharacterSprite, Dir, Anim } from "../../src/shared/sprites.ts";
import { characterHeight, drawCharacter } from "../../src/client/render/characters.ts";
import { EffectSystem } from "../../src/client/render/effects.ts";
import { drawEmote, drawHpBar, drawNamePlate, drawSelectionRing } from "../../src/client/render/overlays.ts";
import { drawProp } from "../../src/client/render/props.ts";
import { TEAM_COLORS } from "../../src/client/render/palette.ts";
import { ground } from "./sheet-lib.ts";
import { context2d } from "../../src/client/render/pixel.ts";

const S = (globalThis as { SCENE_SCALE?: number }).SCENE_SCALE ?? 3;
const W = Math.floor(960 / S);
const H = Math.floor(600 / S);
const canvas = document.getElementById("preview") as HTMLCanvasElement;
canvas.width = 960;
canvas.height = 600;
const ctx = context2d(canvas);
ctx.setTransform(S, 0, 0, S, 0, 0);
ctx.imageSmoothingEnabled = false;
ground(ctx, 0, 0, W, H, "grass");
ground(ctx, 0, 70, W, 26, "town");
ground(ctx, W - 90, 0, 90, 70, "sand");

type Actor = { key: CharacterSprite; x: number; y: number; dir: Dir; anim: Anim; t: number; name?: string; team?: keyof typeof TEAM_COLORS; hp?: number; emote?: Parameters<typeof drawEmote>[1]; sel?: boolean; level?: number; title?: string };
const actors: Actor[] = [
  { key: "hero_youth", x: 80, y: 90, dir: "right", anim: "attack", t: 120, name: "장생", team: "self", hp: 0.8, sel: false, level: 12, title: "떠돌이 무사" },
  { key: "wokou", x: 104, y: 92, dir: "left", anim: "hurt", t: 40, name: "왜구", team: "enemy", hp: 0.35, sel: true, level: 9 },
  { key: "wokou_captain", x: 140, y: 100, dir: "left", anim: "idle", t: 0, name: "왜구 두목", team: "boss", hp: 1, level: 15 },
  { key: "merchant", x: 30, y: 82, dir: "down", anim: "idle", t: 0, name: "보부상", team: "npc", emote: "quest" },
  { key: "innkeeper", x: 50, y: 60, dir: "down", anim: "idle", t: 300, name: "주모", team: "npc", emote: "talk" },
  { key: "soldier_joseon", x: 60, y: 120, dir: "up", anim: "walk", t: 130, name: "관군", team: "ally" },
  { key: "archer_joseon", x: 30, y: 130, dir: "right", anim: "shoot", t: 200, name: "궁수", team: "ally" },
  { key: "scholar", x: 200, y: 50, dir: "left", anim: "idle", t: 0, name: "선비", team: "npc", emote: "questDone" },
  { key: "tiger", x: 250, y: 120, dir: "left", anim: "walk", t: 120, name: "산군", team: "enemy", hp: 0.9 },
  { key: "commoner_f", x: 180, y: 160, dir: "down", anim: "walk", t: 260, name: "아낙", team: "npc" },
  { key: "child", x: 196, y: 166, dir: "down", anim: "idle", t: 0 },
  { key: "monk", x: 120, y: 160, dir: "right", anim: "cast", t: 300, name: "스님", team: "ally", emote: "heart" },
  { key: "general_joseon", x: 280, y: 60, dir: "down", anim: "idle", t: 0, name: "장군", team: "ally", level: 40 },
];
drawProp(ctx, "banner", 300, 40, 0);
drawProp(ctx, "campfire", 150, 140, 200);
drawProp(ctx, "signpost", 12, 100, 0);
drawProp(ctx, "chest", 230, 90, 0);
drawProp(ctx, "ginseng", 260, 160, 400);
drawProp(ctx, "cannon", 200, 120, 0);
const fx = new EffectSystem();
for (const a of [...actors].sort((p, q) => p.y - q.y)) {
  if (a.sel) drawSelectionRing(ctx, a.x, a.y, TEAM_COLORS.enemy, 200);
  drawCharacter(ctx, a.key, a.x, a.y, a.dir, a.anim, a.t, a.anim === "hurt" ? { flash: "rgba(255,255,255,0.6)" } : undefined);
}
for (const a of actors) {
  const top = a.y - characterHeight(a.key);
  if (a.hp !== undefined) drawHpBar(ctx, a.x, top - 4, a.hp);
  if (a.name) drawNamePlate(ctx, a.name, a.x, top - 5, { color: TEAM_COLORS[a.team ?? "npc"], level: a.level, title: a.title });
  if (a.emote) drawEmote(ctx, a.emote, a.x, top - 16, 300);
}
fx.spawn("slash", 80, 90, { dir: "right" });
fx.spawn("spark", 104, 80);
fx.floatText("38", 104, 70);
fx.spawn("heal", 120, 160);
fx.spawn("arrow", 30, 130, { tx: 250, ty: 120 });
fx.spawn("fire", 230, 30, { durationMs: 5000 });
for (let i = 0; i < 12; i++) fx.update(16);
fx.draw(ctx, 200);
console.log("scene at scale", S);
