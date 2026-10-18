// Costumes for hostile forces across the eras (pirates, invaders, rebels,
// assassins, 19th-century expeditionary troops). Same body and face as every
// other people; faction reads from headgear, armour and colour only.

import type { CostumeSpec } from "./costume-types.ts";
import { WHITE, INK, RED, DEEP_RED, INDIGO, GOLD, DARK_BROWN, FUR_LIGHT, straw, boots } from "./costume-palette.ts";

export type HostileSprite =
  | "wokou"
  | "wokou_captain"
  | "red_turban"
  | "jurchen"
  | "jurchen_chief"
  | "japanese_ashigaru"
  | "japanese_samurai"
  | "japanese_general"
  | "qing_soldier"
  | "qing_general"
  | "bandit"
  | "rebel"
  | "assassin"
  | "french_marine"
  | "us_marine"
  | "japanese_modern"
  | "ronin";

export const HOSTILE_COSTUMES: Record<HostileSprite, CostumeSpec> = {
  wokou: {
    hair: "messy",
    hat: { kind: "headband", color: "#e9e1cc", accent: "#e9e1cc" },
    upper: { kind: "armor", color: "#6a5238", sleeve: INDIGO, collar: "open", pattern: "lacing", patternColor: INDIGO, bareArms: true },
    lower: { kind: "hakama", color: "#5b5248" },
    shoes: straw,
    belt: "#3a3434",
    weapon: "curved",
  },
  wokou_captain: {
    build: "large",
    hair: "messy",
    beard: "full",
    hat: { kind: "kabuto", color: INK, accent: DEEP_RED, big: true },
    upper: { kind: "armor", color: "#3a3030", collar: "open", pattern: "lacing", patternColor: RED },
    lower: { kind: "hakama", color: "#4a3a30" },
    shoes: boots,
    belt: GOLD,
    details: [{ kind: "pauldrons", color: "#3a3030", accent: RED }],
    weapon: "longsword",
  },
  red_turban: {
    hair: "topknot",
    beard: "full",
    hat: { kind: "scarf", color: "#c4372d", accent: "#8f2a2a" },
    upper: { kind: "jacket", color: "#7a5a3a", collar: "open" },
    lower: { kind: "trousers", color: "#5b4a38", tie: "#3a2a1e" },
    shoes: { color: "#3a2a1e", boots: true },
    belt: RED,
    details: [{ kind: "vest", color: "#5e4630", trim: "#3a2a1e" }],
    weapon: "sword",
  },
  jurchen: {
    hair: "queue",
    hat: { kind: "furhat", color: "#4f3a2c", accent: "#9b7550" },
    upper: { kind: "coat", color: "#8a6a48", trim: FUR_LIGHT, collar: "cross" },
    lower: { kind: "trousers", color: "#5e4630", tie: "#3a2a1e" },
    shoes: { color: "#3a2a1e", boots: true },
    belt: "#3a2a1e",
    back: { kind: "quiver", color: DARK_BROWN },
    weapon: "bow",
  },
  jurchen_chief: {
    build: "large",
    hair: "queue",
    beard: "full",
    hat: { kind: "furhat", color: "#2f4a52", accent: "#8a6440", plume: "#f4f1e8", big: true },
    upper: { kind: "coat", color: "#2f5b62", trim: FUR_LIGHT, collar: "cross" },
    lower: { kind: "trousers", color: "#3a2a1e", tie: "#2a1e18" },
    shoes: { color: "#2a1e18", boots: true },
    belt: GOLD,
    details: [
      { kind: "furcollar", color: FUR_LIGHT },
      { kind: "pauldrons", color: "#8a6a48", accent: GOLD },
    ],
    weapon: "curved",
  },
  japanese_ashigaru: {
    hair: "topknot",
    hat: { kind: "jingasa", color: INK, accent: RED },
    upper: { kind: "armor", color: "#3a3636", sleeve: INDIGO, collar: "open", pattern: "lacing", patternColor: "#5b5f6b" },
    lower: { kind: "hakama", color: INDIGO },
    shoes: straw,
    belt: "#5b5248",
    back: { kind: "banner", color: "#2b2f3a", accent: GOLD },
    weapon: "musket",
  },
  japanese_samurai: {
    hair: "topknot",
    hat: { kind: "kabuto", color: INK, accent: DEEP_RED },
    upper: { kind: "armor", color: "#2e2a2a", sleeve: "#3a3030", collar: "open", pattern: "lacing", patternColor: RED },
    lower: { kind: "hakama", color: "#4a3a5a" },
    shoes: straw,
    belt: "#5b5248",
    details: [{ kind: "pauldrons", color: "#2e2a2a", accent: RED }],
    weapon: "curved",
  },
  japanese_general: {
    build: "large",
    hair: "topknot",
    beard: "mustache",
    hat: { kind: "kabuto", color: INK, accent: "#7a1f24", big: true },
    upper: { kind: "armor", color: "#6a2228", sleeve: "#3a2a22", collar: "open", pattern: "lacing", patternColor: GOLD },
    lower: { kind: "hakama", color: "#2e2a2a" },
    shoes: boots,
    belt: GOLD,
    details: [{ kind: "pauldrons", color: "#6a2228", accent: GOLD }],
    weapon: "warfan",
  },
  qing_soldier: {
    hair: "queue",
    hat: { kind: "qingcap", color: "#e9e1cc", accent: DEEP_RED, plume: RED },
    upper: { kind: "coat", color: "#2f5590", trim: RED, collar: "round", pattern: "quilt" },
    lower: { kind: "trousers", color: INK, tie: INK },
    shoes: boots,
    belt: "#3a2a1e",
    details: [{ kind: "patch", color: WHITE, accent: RED }],
    weapon: "spear",
  },
  qing_general: {
    build: "large",
    hair: "queue",
    beard: "mustache",
    hat: { kind: "qinghelmet", color: "#3a3434", accent: "#c9a35a", plume: RED },
    upper: { kind: "coat", color: "#cf9f30", trim: "#2a2523", collar: "round", pattern: "studs", patternColor: "#7a5220" },
    lower: { kind: "trousers", color: INK, tie: INK },
    shoes: boots,
    belt: "#2a2523",
    details: [{ kind: "pauldrons", color: "#cf9f30", accent: "#2a2523" }],
    weapon: "sword",
  },
  bandit: {
    hair: "messy",
    beard: "full",
    hat: { kind: "headband", color: "#7a2a24", accent: "#7a2a24" },
    upper: { kind: "jacket", color: "#6e5a44", collar: "open", bareArms: true },
    lower: { kind: "trousers", color: "#4f4438", tie: "#3a2a1e" },
    shoes: straw,
    belt: "#3a2a1e",
    weapon: "sword",
  },
  rebel: {
    hair: "topknot",
    hat: { kind: "scarf", color: "#5a4a3a", accent: "#3a2e24" },
    upper: { kind: "jacket", color: "#8a7a66", trim: "#6e6253", collar: "cross" },
    lower: { kind: "trousers", color: "#6e6253", tie: "#4f463c" },
    shoes: straw,
    belt: "#4f463c",
    details: [{ kind: "vest", color: "#3d4a3a", trim: "#2a3328" }],
    weapon: "spear",
    weaponAccent: "#3a3434",
  },
  assassin: {
    hair: "topknot",
    hat: { kind: "hood", color: "#2a2730" },
    upper: { kind: "jacket", color: "#2e2b33", trim: "#1d1b20", collar: "none" },
    lower: { kind: "trousers", color: "#2e2b33", tie: "#1d1b20" },
    shoes: { color: "#1d1b20" },
    belt: "#5a1f22",
    details: [{ kind: "facecloth", color: "#2a2730" }],
    weapon: "sword",
  },
  french_marine: {
    hair: "short",
    hat: { kind: "kepi", color: "#1f2a48", accent: RED, plume: RED },
    upper: { kind: "tunic", color: "#1f2a48", trim: RED, collar: "high" },
    lower: { kind: "straight", color: "#93a3bd" },
    shoes: boots,
    belt: INK,
    details: [{ kind: "buttons", color: GOLD }],
    weapon: "rifle",
  },
  us_marine: {
    hair: "short",
    hat: { kind: "forage", color: "#1f2a48", accent: "#2b3a5f" },
    upper: { kind: "tunic", color: "#26365e", trim: "#26365e", collar: "high" },
    lower: { kind: "straight", color: "#7f95b8" },
    shoes: boots,
    details: [
      { kind: "crossbelts", color: WHITE },
      { kind: "buttons", color: GOLD },
    ],
    weapon: "rifle",
  },
  japanese_modern: {
    hair: "short",
    hat: { kind: "kepi", color: "#16203a", accent: GOLD, plume: "#16203a" },
    upper: { kind: "tunic", color: "#16203a", trim: GOLD, collar: "high" },
    lower: { kind: "straight", color: "#16203a", tie: GOLD },
    shoes: { color: WHITE, boots: true },
    belt: INK,
    details: [{ kind: "buttons", color: GOLD }],
    weapon: "rifle",
  },
  ronin: {
    hair: "messy",
    beard: "goatee",
    upper: { kind: "jacket", color: "#6e6a5e", trim: "#4f4b42", collar: "cross" },
    lower: { kind: "hakama", color: "#4f4b42" },
    shoes: straw,
    belt: "#3a3434",
    weapon: "curved",
  },
};
