// Shared colour language. Built around 오방색 (blue, red, yellow, white,
// black) and 간색 accents, with muted natural tones for terrain so UI and
// characters read clearly on top of the map.

export const OBANG = {
  blue: "#2b5a8c",
  red: "#b8312f",
  yellow: "#e2b23a",
  white: "#f3ecdc",
  black: "#1d1a19",
} as const;

export const GANSAEK = {
  green: "#3f7d4a",
  pink: "#d9667b",
  sky: "#5f9ec9",
  purple: "#6b3e75",
  sulfur: "#c99a2e",
} as const;

export const NATURE = {
  skin: "#f0c8a0",
  skinShade: "#c9946c",
  hair: "#2a1e18",
  wood: "#8a5a35",
  woodDark: "#5e3a22",
  giwa: "#46505c",
  giwaLight: "#66717d",
  thatch: "#c9a35a",
  thatchDark: "#9c7a38",
  stone: "#8c8a84",
  stoneDark: "#5f5d58",
  earth: "#a07c55",
  earthDark: "#7c5c3b",
  grass: "#6b9a4a",
  grassDark: "#557d3a",
  meadow: "#8bb05a",
  forest: "#2f5d3a",
  forestDark: "#1f4229",
  hill: "#7f8d4f",
  mountain: "#6d6a5e",
  mountainDark: "#4d4a42",
  peak: "#9b978c",
  snow: "#eef2f4",
  snowShade: "#c9d3da",
  sand: "#e3cf9c",
  sandDark: "#cdb57f",
  marsh: "#8c8065",
  paddy: "#8fb15a",
  paddyWater: "#6f9fae",
  shallow: "#4f93bd",
  sea: "#2f6f9f",
  deep: "#1f4a75",
  foam: "#d8ecf2",
  road: "#c4a476",
  roadDark: "#a8885c",
  deck: "#9a6b3f",
  deckDark: "#6f4a2a",
  // World art (terrain and architecture); appended by the world renderer.
  pine: "#2f5535",
  pineDark: "#1b3423",
  pineTrunk: "#7b4a31",
  granite: "#9e998e",
  graniteDark: "#6a675f",
  roofTile: "#373e48",
  roofTileLight: "#56606b",
  plaster: "#ebe3d0",
  timber: "#6e4529",
  dancheongGreen: "#3a8a6c",
  dancheongRed: "#a8322c",
  mudWall: "#ae9068",
  riceGold: "#c8a841",
  azalea: "#c4507e",
  maple: "#b54d32",
  ice: "#c4d8e2",
} as const;

/** Team tints used for name plates and minimap markers. */
export const TEAM_COLORS = {
  self: "#ffe08a",
  player: "#9fd3ff",
  ally: "#9be38f",
  npc: "#f3ecdc",
  enemy: "#ff8a7a",
  boss: "#ff5e5e",
} as const;

/** Name tint of simulated companions (◇): the UI's sim blue, apart from real players. */
export const COMPANION_COLOR = "#93b8cf";
/** Frame around the player's own name plate (dancheong gold). */
export const SELF_FRAME = "#e2b23a";
