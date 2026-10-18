// Sprite vocabulary shared by content data (which names sprites) and the
// client renderer (which must draw every key; enforced by Record<SpriteKey,…>).

export type Dir = "down" | "up" | "left" | "right";

export type Anim =
  | "idle"
  | "walk"
  | "attack"
  | "shoot"
  | "cast"
  | "hurt"
  | "dead";

/** Visual variant for humanoid sprites that support it. */
export type BodyVariant = "m" | "f";

export const CHARACTER_SPRITES = [
  // Player avatars; the game picks one from era, rank and disguise state.
  "hero_youth",
  "hero_goryeo_officer",
  "hero_joseon_general",
  "hero_official",
  "hero_disguise",
  "hero_hermit",
  "hero_modern",
  "hero_righteous",
  // Court and townsfolk.
  "king_goryeo",
  "king_joseon",
  "emperor_korea",
  "queen",
  "prince",
  "official_red",
  "official_blue",
  "official_green",
  "scholar",
  "commoner_m",
  "commoner_f",
  "farmer",
  "merchant",
  "innkeeper",
  "monk",
  "elder",
  "child",
  "messenger",
  "physician",
  "reformer",
  "western_envoy",
  "japanese_envoy",
  "qing_envoy",
  // Allied forces.
  "general_goryeo",
  "general_joseon",
  "admiral",
  "soldier_goryeo",
  "soldier_joseon",
  "archer_joseon",
  "navy_joseon",
  "monk_soldier",
  "musketeer_joseon",
  "righteous_army",
  "donghak_peasant",
  "soldier_empire",
  "ming_soldier",
  // Hostile forces and wildlife.
  "wokou",
  "wokou_captain",
  "red_turban",
  "jurchen",
  "jurchen_chief",
  "japanese_ashigaru",
  "japanese_samurai",
  "japanese_general",
  "qing_soldier",
  "qing_general",
  "bandit",
  "rebel",
  "assassin",
  "french_marine",
  "us_marine",
  "japanese_modern",
  "ronin",
  "tiger",
  "wolf",
  "boar",
  "bear",
] as const;

export type CharacterSprite = (typeof CHARACTER_SPRITES)[number];

export const PROP_SPRITES = [
  "chest",
  "herb",
  "ginseng",
  "coin",
  "scroll",
  "banner",
  "cannon",
  "singijeon",
  "campfire",
  "signpost",
] as const;

export type PropSprite = (typeof PROP_SPRITES)[number];

export type SpriteKey = CharacterSprite | PropSprite;

export const EFFECT_KINDS = [
  "slash",
  "thrust",
  "arrow",
  "bullet",
  "cannonball",
  "fire",
  "smoke",
  "spark",
  "heal",
  "levelup",
  "dust",
  "splash",
  "explosion",
  "shout",
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

export const isCharacterSprite = (key: string): key is CharacterSprite =>
  (CHARACTER_SPRITES as readonly string[]).includes(key);

export const isPropSprite = (key: string): key is PropSprite =>
  (PROP_SPRITES as readonly string[]).includes(key);

/** World units: one tile is TILE_PX world pixels. */
export const TILE_PX = 16;
