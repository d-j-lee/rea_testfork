// Hat rendering for the paper-doll humanoid: templates live in
// hats-civil.ts and hats-military.ts; this module recolours and stamps them
// and adds ornaments (crests, feathers) for the "big" variants.

import type { HatKind, HatSpec } from "./costume-types.ts";
import { CIVIL_HATS } from "./hats-civil.ts";
import { MILITARY_HATS } from "./hats-military.ts";
import type { View } from "./humanoid-head.ts";
import { darker, lighter, px, type PixGrid, type Px } from "./pixgrid.ts";

export interface HatArt {
  /** First row relative to the skull top. */
  top: number;
  /** Column of the template's first character (body-local). */
  left?: number;
  down: readonly string[];
  up?: readonly string[];
  right?: readonly string[];
  /** Hides the eyes (brim pulled low). */
  hidesEyes?: boolean;
}

const HATS: Record<Exclude<HatKind, "none">, HatArt> = { ...CIVIL_HATS, ...MILITARY_HATS };

export function hatHidesEyes(hat: HatSpec | undefined): boolean {
  return !!hat && hat.kind !== "none" && !!HATS[hat.kind].hidesEyes;
}

export function drawHat(g: PixGrid, hat: HatSpec, view: View, headTop: number): void {
  if (hat.kind === "none") return;
  const art = HATS[hat.kind];
  const rows =
    view === "up"
      ? (art.up ?? art.down)
      : view === "right"
        ? (art.right ?? art.down)
        : art.down;
  const accent = hat.accent ?? "#b8312f";
  const plume = hat.plume ?? accent;
  const pal: Record<string, Px> = {
    M: px(hat.color),
    m: px(darker(hat.color, 0.3)),
    L: px(lighter(hat.color, 0.28)),
    N: px(accent),
    n: px(darker(accent, 0.3)),
    O: px(plume),
    P: px(accent),
    p: px(darker(accent, 0.3)),
    W: px("#f4f1e8"),
    G: px(hat.kind === "helmet" ? lighter(hat.color, 0.45) : "#e2b23a"),
  };
  g.stamp(rows, pal, art.left ?? 0, headTop + art.top);
  if (hat.big) drawHatOrnament(g, hat, view, headTop, pal);
}

function drawHatOrnament(
  g: PixGrid,
  hat: HatSpec,
  view: View,
  t: number,
  pal: Record<string, Px>,
): void {
  const G = px("#e2b23a");
  const g2 = px("#f6dc7a");
  switch (hat.kind) {
    case "kabuto": {
      // Large crest: a tall crescent (maedate) or horns.
      if (view === "up") return;
      const cx = view === "right" ? 10 : 7;
      g.rect(cx, t - 8, 2, 3, G);
      g.hline(cx - 3, cx + 4, t - 9, G);
      g.set(cx - 4, t - 10, G);
      g.set(cx + 5, t - 10, G);
      g.set(cx, t - 8, g2);
      break;
    }
    case "jeollip":
    case "tugu": {
      // Peacock feather (공작미) on the side.
      const fx = view === "right" ? 2 : 12;
      g.vline(fx, t - 7, t - 3, px("#2f6f5f"));
      g.set(fx, t - 8, px("#5fa0c0"));
      g.set(fx + (view === "right" ? -1 : 1), t - 8, px("#2b5a8c"));
      break;
    }
    case "furhat": {
      // Feather plume leaning back.
      const fx = view === "right" ? 6 : 9;
      const back = view === "right" ? -1 : view === "down" ? 1 : -1;
      const O = pal.O as Px;
      const shade = px(darker("#f4f1e8", 0.35));
      g.vline(fx, t - 5, t - 3, O);
      g.vline(fx + back, t - 8, t - 5, O);
      g.set(fx + 2 * back, t - 9, O);
      g.set(fx + 2 * back, t - 8, shade);
      g.set(fx, t - 4, shade);
      break;
    }
    case "qingofficial": {
      if (view === "down") return;
      break;
    }
    default:
      break;
  }
}

/** Highest row (relative to the skull top) a hat reaches, for heights. */
export function hatTop(hat: HatSpec | undefined): number {
  if (!hat || hat.kind === "none") return -2;
  const top = HATS[hat.kind].top;
  return hat.big && (hat.kind === "kabuto" || hat.kind === "tugu") ? Math.min(top, -10) : top;
}
