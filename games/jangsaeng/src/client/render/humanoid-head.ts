// Heads, hair, beards and hats for the paper-doll humanoid. Templates are
// authored against body-local coordinates (16 px wide box, x = 0..15) with
// rows relative to the top of the skull; slot letters are recoloured per
// costume:
//   K/k skin/shade  E eye  R blush  H/h hair/highlight
// (hats live in hat-art.ts)

import type { Beard, HairStyle } from "./costume-types.ts";
import { darker, lighter, mix, px, type PixGrid, type Px } from "./pixgrid.ts";

export type View = "down" | "up" | "right";
export type EyeState = "open" | "shut" | "wince" | "hidden";

export const SKIN = "#f0c8a0";
const EYE = "#2b2026";
const BLUSH = "#e8a088";

const HEAD: Record<View, readonly string[]> = {
  down: [
    "..HHHHHH..",
    ".HhhHHHHH.",
    "HHhHHHHHHH",
    "HHHHHHHHHH",
    "HHKKKKKKHH",
    "HKKKKKKKKH",
    "KKEKKKKEKK",
    "KKEKKKKEKK",
    "kRKKKKKKRk",
    ".kKKKKKKk.",
  ],
  up: [
    "..HHHHHH..",
    ".HhhHHHHH.",
    "HHhHHHHHHH",
    "HHHHHHHHHH",
    "HHHHHHHHHH",
    "HHHHHHHHHH",
    "kHHHHHHHHk",
    "kHHHHHHHHk",
    ".HHHHHHHH.",
    "..kKKKKk..",
  ],
  right: [
    "..HHHHHH..",
    ".HhhHHHHH.",
    "HHhHHHHHHH",
    "HHHHHHHHHH",
    "HHHHHHKKKK",
    "HHHHHKKKKK",
    "HHHHkKKKEK",
    "HHHHkKKKEK",
    ".HHHKKKKRK",
    "..HkKKKKK.",
  ],
};

/** Hairline overrides per style (row index → replacement row). */
const HAIRLINE: Partial<Record<HairStyle, Partial<Record<View, Record<number, string>>>>> = {
  short: {
    down: { 3: "HHKHHHHKHH", 4: "HKKKKKKKKH" },
    right: { 3: "HHHHHHHKKK", 4: "HHHHHKKKKK" },
  },
  bangs: {
    down: { 4: "HHHHHHHHHH", 5: "HKHKKKKHKH" },
    right: { 4: "HHHHHHHHHK", 5: "HHHHHKKHKK" },
  },
  bun: { down: { 0: "..HHhhHH..", 1: ".HHHhhHHH." } },
  braid: { down: { 0: "..HHhhHH..", 1: ".HHHhhHHH." } },
};

function headPalette(hair: string, skin: string): Record<string, Px> {
  return {
    H: px(hair),
    h: px(lighter(hair, 0.22)),
    K: px(skin),
    k: px(darker(skin, 0.22)),
    E: px(EYE),
    R: px(mix(skin, BLUSH, 0.6)),
  };
}

export interface HeadOptions {
  view: View;
  hair: HairStyle;
  hairColor: string;
  beard: Beard;
  beardColor: string;
  eyes: EyeState;
  mouth: boolean;
  hatted: boolean;
  /** Head top row in body-local coordinates. */
  top: number;
}

/** Hair behind the body (long hair, braids) — drawn before the torso. */
export function drawHairBack(g: PixGrid, o: HeadOptions): void {
  const H = px(o.hairColor);
  const h = px(lighter(o.hairColor, 0.2));
  const d = px(darker(o.hairColor, 0.25));
  const t = o.top;
  if (o.hair === "long") {
    if (o.view === "right") {
      g.rect(2, t + 6, 3, 6, H);
      g.rect(2, t + 12, 2, 3, H);
      g.set(2, t + 7, h);
    } else if (o.view === "down") {
      g.rect(2, t + 7, 1, 5, H);
      g.rect(13, t + 7, 1, 5, d);
    }
  }
}

/** Braid brought forward over the shoulder (front view). */
export function drawHairFront(g: PixGrid, o: HeadOptions, ribbon: string): void {
  if (o.view !== "down" || (o.hair !== "braid" && o.hair !== "bangs")) return;
  const H = px(o.hairColor);
  const d = px(darker(o.hairColor, 0.25));
  const t = o.top;
  const len = o.hair === "bangs" ? 2 : 4;
  for (let i = 0; i < len; i++) g.rect(11, t + 9 + i, 2, 1, i % 2 ? d : H);
  g.rect(11, t + 9 + len, 2, 2, px(ribbon));
}

/** Hair drawn over the torso back (up view braids, long hair). */
export function drawHairOver(g: PixGrid, o: HeadOptions, ribbon: string): void {
  const H = px(o.hairColor);
  const h = px(lighter(o.hairColor, 0.2));
  const d = px(darker(o.hairColor, 0.25));
  const R = px(ribbon);
  const t = o.top;
  if (o.view === "up") {
    if (o.hair === "long") {
      g.rect(4, t + 9, 8, 4, H);
      g.rect(5, t + 13, 6, 2, H);
      g.hline(6, 9, t + 15, d);
      g.set(5, t + 10, h);
    } else if (o.hair === "braid" || o.hair === "bangs") {
      const len = o.hair === "bangs" ? 5 : 8;
      for (let i = 0; i < len; i++) g.rect(7, t + 9 + i, 2, 1, i % 2 ? d : H);
      g.rect(6, t + 9 + len, 4, 2, R);
    } else if (o.hair === "queue") {
      for (let i = 0; i < 8; i++) g.set(7 + (i % 2), t + 9 + i, i % 2 ? d : H);
      g.set(7, t + 17, d);
    }
  } else if (o.view === "right") {
    if (o.hair === "braid" || o.hair === "bangs") {
      const len = o.hair === "bangs" ? 4 : 7;
      for (let i = 0; i < len; i++) g.rect(2, t + 8 + i, 2, 1, i % 2 ? d : H);
      g.rect(1, t + 8 + len, 3, 2, R);
    } else if (o.hair === "queue") {
      for (let i = 0; i < 7; i++) g.set(2 + (i > 3 ? 0 : 1), t + 8 + i, i % 2 ? d : H);
    }
  }
}

export function drawHead(g: PixGrid, o: HeadOptions, skin = SKIN): void {
  const bald = o.hair === "bald";
  const hairColor = bald ? lighter(skin, 0.05) : o.hairColor;
  const pal = headPalette(hairColor, skin);
  if (bald) pal.h = px(lighter(skin, 0.35));
  const rows = [...HEAD[o.view]];
  const over = HAIRLINE[o.hair]?.[o.view];
  if (over) for (const [i, row] of Object.entries(over)) rows[Number(i)] = row;
  if (o.hair === "queue" && !o.hatted && o.view !== "up") {
    // Shaved front: forehead and crown show skin.
    rows[1] = o.view === "down" ? ".KKKKKKKK." : ".KKKKHHHH.";
    rows[2] = o.view === "down" ? "KKKKKKKKKK" : "KKKKHHHHHH";
    rows[3] = o.view === "down" ? "HKKKKKKKKH" : "HHHHHKKKKK";
  }
  g.stamp(rows, pal, 3, o.top);
  const t = o.top;
  // Eyes.
  if (o.view !== "up") {
    const eyes = o.view === "down" ? [5, 10] : [11];
    const skinPx = px(skin);
    const eyePx = px(EYE);
    for (const ex of eyes) {
      if (o.eyes === "hidden") {
        g.set(ex, t + 6, px(darker(skin, 0.3)));
        g.set(ex, t + 7, skinPx);
      } else if (o.eyes === "shut") {
        g.set(ex, t + 6, skinPx);
        g.set(ex, t + 7, eyePx);
        if (o.view === "down") g.set(ex + (ex < 8 ? -1 : 1), t + 7, eyePx);
      } else if (o.eyes === "wince") {
        g.set(ex, t + 6, eyePx);
        g.set(ex, t + 7, skinPx);
        if (o.view === "down") g.set(ex + (ex < 8 ? 1 : -1), t + 7, eyePx);
      }
    }
    if (o.mouth) {
      const m = px("#6a2a2a");
      if (o.view === "down") g.rect(7, t + 8, 2, 1, m);
      else g.set(11, t + 8, m);
    }
  }
  // Hair tops (hidden under hats).
  if (!o.hatted) drawHairTop(g, o, pal);
  drawBeard(g, o);
}

function drawHairTop(g: PixGrid, o: HeadOptions, pal: Record<string, Px>): void {
  const t = o.top;
  const H = pal.H as Px;
  const h = pal.h as Px;
  switch (o.hair) {
    case "topknot":
    case "long": {
      // 상투 with a 망건 band.
      const x = o.view === "right" ? 6 : 6;
      g.rect(x + 1, t - 2, 2, 1, H);
      g.rect(x, t - 1, 4, 1, H);
      g.set(x + 1, t - 2, h);
      break;
    }
    case "bun":
      if (o.view === "down") {
        // Bun at the nape: its sides and the 비녀 tips peek out by the jaw.
        g.set(2, t + 7, H);
        g.set(13, t + 7, H);
        g.set(1, t + 8, px("#e2b23a"));
        g.set(14, t + 8, px("#e2b23a"));
      } else if (o.view === "right") {
        g.rect(1, t + 5, 3, 3, H);
        g.set(1, t + 5, h);
        g.hline(0, 4, t + 6, px("#e2b23a"));
      } else if (o.view === "up") {
        g.rect(5, t + 6, 6, 3, H);
        g.hline(6, 9, t + 6, h);
        g.hline(3, 12, t + 7, px("#e2b23a"));
      }
      break;
    case "messy":
      g.set(4, t - 1, H);
      g.set(8, t - 1, H);
      g.set(11, t, H);
      g.set(2, t + 2, H);
      if (o.view !== "down") {
        g.rect(1, t + 4, 2, 2, H);
        g.set(0, t + 5, H);
      }
      break;
    case "bigwig":
      drawBigWig(g, o.view, t, o.hairColor);
      break;
    default:
      break;
  }
}

function drawBigWig(g: PixGrid, view: View, t: number, color: string): void {
  const H = px(color);
  const h = px(lighter(color, 0.25));
  const d = px(darker(color, 0.3));
  const G = px("#e2b23a");
  const R = px("#c8402e");
  if (view === "right") {
    g.ellipse(1, t - 5, 13, 7, H);
    g.ellipse(2, t - 4, 6, 3, h);
    g.hline(2, 12, t + 1, d);
  } else {
    g.ellipse(0, t - 5, 16, 7, H);
    g.ellipse(2, t - 4, 7, 3, h);
    g.hline(1, 14, t + 1, d);
  }
  if (view !== "up") {
    g.set(view === "right" ? 11 : 4, t - 2, G);
    g.set(view === "right" ? 9 : 11, t - 2, G);
    g.set(view === "right" ? 10 : 7, t - 4, R);
    g.set(view === "right" ? 10 : 8, t - 4, G);
  } else {
    g.hline(3, 12, t - 1, G);
  }
}

function drawBeard(g: PixGrid, o: HeadOptions): void {
  if (o.beard === "none" || o.view === "up") return;
  const t = o.top;
  const B = px(o.beardColor);
  const b = px(darker(o.beardColor, 0.2));
  if (o.view === "down") {
    if (o.beard === "mustache" || o.beard === "long" || o.beard === "full") {
      g.hline(6, 9, t + 8, B);
      g.set(5, t + 9, b);
      g.set(10, t + 9, b);
    }
    if (o.beard === "goatee") g.rect(7, t + 9, 2, 2, B);
    if (o.beard === "long") {
      g.rect(7, t + 9, 2, 4, B);
      g.set(7, t + 12, b);
      g.set(8, t + 13, b);
    }
    if (o.beard === "full") {
      g.vline(3, t + 6, t + 8, B);
      g.vline(12, t + 6, t + 8, b);
      g.hline(4, 11, t + 9, B);
      g.rect(6, t + 10, 4, 1, b);
    }
  } else {
    if (o.beard === "mustache" || o.beard === "long" || o.beard === "full")
      g.hline(10, 12, t + 8, B);
    if (o.beard === "goatee") g.rect(10, t + 9, 2, 2, B);
    if (o.beard === "long") {
      g.rect(10, t + 9, 2, 3, B);
      g.set(10, t + 12, b);
    }
    if (o.beard === "full") {
      g.rect(7, t + 7, 2, 3, B);
      g.hline(8, 12, t + 9, B);
      g.hline(9, 11, t + 10, b);
    }
  }
}
