// Front (facing the camera) and rear views of the quadrupeds, authored as
// 16-px-wide templates: in the top-down 3/4 view the head is nearest the
// camera with the back visible behind it (front), or the rump nearest with
// the head beyond the shoulders (rear). Legs, mouth and eyes are animated by
// re-stamping template rows.
//   O/o main/shade  D dark  L light  W white  P ear  N nose  Y/E eye
//   B muzzle  S snout  M mane  R open mouth  h highlight

import type { PixGrid, Px } from "./pixgrid.ts";
import { px } from "./pixgrid.ts";

export type BeastKind = "tiger" | "wolf" | "boar" | "bear";

interface ViewArt {
  rows: readonly string[];
  /** Number of bottom rows that are legs. */
  legRows: number;
  /** Row index replaced when the mouth opens, and its replacement. */
  mouthRow?: number;
  mouthOpen?: string;
  /** Extra decoration (tail) drawn behind the template, relative to its top. */
  tail?: readonly [number, number, "O" | "D" | "L"][];
}

const ART: Record<BeastKind, { front: ViewArt; rear: ViewArt; pal: Record<string, string> }> = {
  tiger: {
    pal: {
      O: "#dc842c", o: "#b5652a", D: "#2a1e18", L: "#f5e7c8", W: "#fbf6ea",
      P: "#e8a0a0", N: "#d46a6a", Y: "#e8d24a", E: "#2a1e18", R: "#7a2a2a", h: "#eea050",
    },
    front: {
      rows: [
        "......oOOo......",
        "....oOODDOOo....",
        "...oODOhhODOo...",
        "..oOOOOOOOOOOo..",
        "..oDOOOOOOOODo..",
        ".DD.oOOOOOOo.DD.",
        ".DPDOOODDOOODPD.",
        ".DOOOODOODOOOOD.",
        "OOODOOOOOOOODOOO",
        "LOOYEOOOOOOEYOOL",
        "LLOOOOLLLLOOOOLL",
        ".LLOOLLNNLLOOLL.",
        ".LLLLLLDDLLLLLL.",
        "..LLLLLLLLLLLL..",
        "...OOO....OOO...",
        "...ODO....ODO...",
        "...OOO....OOO...",
        "..LLLL....LLLL..",
      ],
      legRows: 4,
      mouthRow: 12,
      mouthOpen: ".LLLLWRRRRWLLLL.",
      tail: [
        [12, 0, "O"],
        [13, -1, "D"],
        [13, -2, "O"],
        [13, -3, "D"],
        [12, -4, "D"],
      ],
    },
    rear: {
      rows: [
        "..DD........DD..",
        "..DOOOOOOOOOOD..",
        "..OOODOOOODOOO..",
        "...OOOOOOOOOO...",
        "..oOOOODDOOOOo..",
        ".oDDOOOhhOOODDo.",
        ".oOODOOOOOODOOo.",
        "oOOOOODDDDOOOOOo",
        "oDDOOOOOOOOOODDo",
        "oOODDOOOOOODDOOo",
        "oOOOOODDDDOOOOOo",
        "oDDOOOOOOOOOODDo",
        ".oOOOOOLLOOOOOo.",
        ".oOOOLLDDLLOOOo.",
        "..OOO..OD..OOO..",
        "..ODO..DO..ODO..",
        "..OOO..OD..OOO..",
        ".LLLL..DO.LLLL..",
      ],
      legRows: 4,
    },
  },
  wolf: {
    pal: {
      O: "#8e8b85", o: "#6f6c67", D: "#4f4d49", L: "#d4d0c6", W: "#f4f1e8",
      N: "#2a2523", Y: "#e8c84a", E: "#2a2523", R: "#7a2a2a", h: "#a8a59e",
    },
    front: {
      rows: [
        "................",
        "......oOOo......",
        "....oOODDOOo....",
        "...D.oOOOOo.D...",
        "...DD.OOOO.DD...",
        "...DOOOhhOOOD...",
        "...OOOOOOOOOO...",
        "..oOYEOOOOEYOo..",
        "..oOOOLLLLOOOo..",
        "..oOOLLLLLLOOo..",
        "...OOLLNNLLOO...",
        "....oLLLLLLo....",
        "...LLLLLLLLLL...",
        "...oLLLLLLLLo...",
        "....OO....OO....",
        "....OO....OO....",
        "....Oo....oO....",
        "...DDO....ODD...",
      ],
      legRows: 4,
      mouthRow: 11,
      mouthOpen: "....oLRRRRLo....",
    },
    rear: {
      rows: [
        "...D........D...",
        "...DD......DD...",
        "...DOOOOOOOOD...",
        "....OOOOOOOO....",
        "...oOOODDOOOo...",
        "..oOOOODDOOOOo..",
        "..oOOOOhhOOOOo..",
        "..oOOOOOOOOOOo..",
        "..oOOOOOOOOOOo..",
        "..oOOOOOOOOOOo..",
        "...oOOOLLOOOo...",
        "...oOOLLLLOOo...",
        "....OOLLLLOO....",
        "....OOOLLOOO....",
        "....OO.OO.OO....",
        "....OO.OO.OO....",
        "....Oo.LL.oO....",
        "...DDO....ODD...",
      ],
      legRows: 4,
    },
  },
  boar: {
    pal: {
      O: "#5e4632", o: "#4a3626", D: "#2a1e18", M: "#2e2219", S: "#b88a7a",
      N: "#5a3a32", W: "#f4efe0", E: "#1a1210", Y: "#1a1210", R: "#7a2a2a", h: "#7a5c42", L: "#8a6a4e",
    },
    front: {
      rows: [
        "....MMMMMMMM....",
        "..oOOMMMMMMOOo..",
        ".oOOOOMMMMOOOOo.",
        "oOOOhOOMMOOhOOOo",
        "oOOOOOOOOOOOOOOo",
        "DDoOOOOOOOOOOoDD",
        ".DDOOOOOOOOOODD.",
        "..oOOEOOOOEOOo..",
        "..oOOOOOOOOOOo..",
        "...OOOSSSSOOO...",
        "...WOSSSSSSOW...",
        "...W.SNSSNS.W...",
        "....WSSSSSSW....",
        "...OOO.SS.OOO...",
        "...OOO....OOO...",
        "...DDD....DDD...",
      ],
      legRows: 3,
      mouthRow: 12,
      mouthOpen: "....WSRRRRSW....",
    },
    rear: {
      rows: [
        "....D......D....",
        "....DOOOOOOD....",
        "...oOMMMMMMOo...",
        "..oOOOMMMMOOOo..",
        ".oOOOOOMMOOOOOo.",
        "oOOOhOOOOOOhOOOo",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        ".oOOOOOOOOOOOOo.",
        ".oOOOOODDOOOOOo.",
        "..oOOOODDOOOOo..",
        "...OOO.D..OOO...",
        "...OOO.DD.OOO...",
        "...OOO....OOO...",
        "...DDD....DDD...",
      ],
      legRows: 4,
    },
  },
  bear: {
    pal: {
      O: "#2f2b2d", o: "#1f1c1e", D: "#1c191b", L: "#5a5456", B: "#8a6a4e", N: "#121012",
      W: "#efe9dc", Y: "#cfcac0", E: "#0e0c0d", R: "#7a2a2a", h: "#4a4548",
    },
    front: {
      rows: [
        "....oOOhhOOo....",
        "..oOOhhOOhhOOo..",
        ".DDDoOOOOOOoDDD.",
        ".DLDOOOOOOOODLD.",
        ".DDOOOOOOOOOODD.",
        "..OOOOOOOOOOOO..",
        "..OOYEOOOOEYOO..",
        "..OOOOBBBBOOOO..",
        "..OOOBBNNBBOOO..",
        "...OOBBBBBBOO...",
        "...OOOBBBBOOO...",
        "..OWWOOOOOOWWO..",
        ".OOOWWWWWWWWOOO.",
        ".OOOOOWWWWOOOOO.",
        ".OOOO......OOOO.",
        ".OOOO......OOOO.",
        ".OOOO......OOOO.",
        ".WOWO......OWOW.",
      ],
      legRows: 4,
      mouthRow: 10,
      mouthOpen: "...OOBRRRRBOO...",
    },
    rear: {
      rows: [
        "...DD......DD...",
        "...DOOOOOOOOD...",
        "...OOOOOOOOOO...",
        "..oOOOhhhhOOOo..",
        ".oOOOhhOOhhOOOo.",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        "oOOOOOOOOOOOOOOo",
        ".oOOOOOOOOOOOOo.",
        ".oOOOOOLLOOOOOo.",
        "..oOOOOLLOOOOo..",
        ".OOOO......OOOO.",
        ".OOOO......OOOO.",
        ".OOOO......OOOO.",
        ".OOOO......OOOO.",
      ],
      legRows: 4,
    },
  },
};

export interface ViewPose {
  /** Whole-sprite vertical offset (lunge toward / away from the camera). */
  dy: number;
  /** Body (non-leg) offset for breathing / crouching. */
  bodyDy: number;
  liftL: number;
  liftR: number;
  mouth: boolean;
  eyesShut: boolean;
  /** Raise a front paw (claw swipe) by this many px. */
  pawL: number;
  /** Bear rearing up: body lifted with legs stretched. */
  rear: number;
}

export function drawBeastView(
  g: PixGrid,
  kind: BeastKind,
  side: "front" | "rear",
  pose: ViewPose,
): void {
  const art = ART[kind];
  const view = art[side];
  const pal: Record<string, Px> = {};
  for (const [k, v] of Object.entries(art.pal)) pal[k] = px(v);
  const rows = [...view.rows];
  if (pose.mouth && view.mouthRow !== undefined && view.mouthOpen) rows[view.mouthRow] = view.mouthOpen;
  if (pose.eyesShut)
    for (let i = 0; i < rows.length; i++) rows[i] = (rows[i] as string).replace(/[YE]/g, "D");
  const h = rows.length;
  const top = 24 - h + pose.dy;
  const bodyRows = h - view.legRows;
  if (view.tail)
    for (const [x, y, c] of view.tail) g.set(x, top + y + pose.bodyDy - pose.rear, pal[c] as Px);
  // Legs first so the body overlaps their tops when crouching.
  for (let r = bodyRows; r < h; r++) {
    const row = rows[r] as string;
    for (let x = 0; x < 16; x++) {
      const c = pal[row[x] as string];
      if (!c) continue;
      const left = x < 6;
      const right = x > 9;
      let dy = 0;
      if (left) dy = pose.liftL - (pose.pawL && r < bodyRows + 2 ? 0 : 0);
      else if (right) dy = pose.liftR;
      g.set(x, top + r + dy, c);
      if (pose.rear && (left || right))
        for (let k = 1; k <= pose.rear; k++) g.set(x, top + r - k, c);
    }
  }
  for (let r = 0; r < bodyRows; r++) {
    const row = rows[r] as string;
    for (let x = 0; x < 16; x++) {
      const c = pal[row[x] as string];
      if (c) g.set(x, top + r + pose.bodyDy - pose.rear, c);
    }
  }
  if (pose.pawL || pose.rear) {
    // Raised paws with claws beside the head.
    const W = pal.W ?? px("#f4f1e8");
    const O = pal.O as Px;
    const py = top + 6 - pose.pawL - pose.rear;
    for (const x0 of pose.rear ? [0, 13] : [1]) {
      g.rect(x0, py, 3, 3, O);
      g.hline(x0, x0 + 2, py - 1, W);
    }
  }
}
