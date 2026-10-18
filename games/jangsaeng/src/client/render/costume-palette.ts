// Shared dyes and materials for costume data (costumes*.ts).

export const MUSLIN = "#e9e0c8"; // undyed 무명
export const MUSLIN_D = "#d3c7aa";
export const WHITE = "#f1ede2";
export const WHITE_D = "#ddd5c0";
export const INK = "#26211f"; // lacquer / horsehair black
export const RED = "#b8312f";
export const ROYAL_RED = "#c23a2e";
export const DEEP_RED = "#902a2a";
export const BLUE = "#2b5a8c";
export const NAVY = "#22304f";
export const DEEP_NAVY = "#181e30";
export const INDIGO = "#3d4a6b";
export const GREEN = "#3f7d55";
export const GOLD = "#e2b23a";
export const IMPERIAL = "#e0b13c";
export const BROWN = "#7a5236";
export const DARK_BROWN = "#4f3424";
export const LEATHER = "#8a5a35";
export const STRAW = "#d4b066";
export const GREY = "#8b8a84";
export const STEEL = "#97a1ab";
export const FUR_LIGHT = "#cdb28a";
export const BOOT = "#2a2523";
export const PATCH = "#2b3a66";

export const straw = { color: STRAW } as const;
export const boots = { color: BOOT, boots: true } as const;
export const blackShoes = { color: BOOT } as const;
