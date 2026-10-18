// Vocabulary for paper-doll humanoid costumes. A costume picks one option per
// layer (hair, hat, upper garment, lower garment, shoes, belt, details, back
// item, held weapon) and colours it; humanoid.ts draws every option for every
// view and pose, so new characters are data, not art.

export type Build = "normal" | "large" | "child";

export type HairStyle =
  | "topknot" // 상투
  | "short" // cropped (modern / western)
  | "bald" // shaved (monks)
  | "long" // loose long hair with topknot (hermit)
  | "bun" // 쪽머리 with 비녀
  | "braid" // 댕기머리 with ribbon
  | "bigwig" // 큰머리 / 어여머리 (court lady)
  | "queue" // Qing braid
  | "messy" // unkempt
  | "bangs"; // child fringe with braid

export type Beard = "none" | "mustache" | "goatee" | "long" | "full";

export type HatKind =
  | "none"
  | "headband"
  | "gat" // 갓
  | "samo" // 사모
  | "ikseon" // 익선관
  | "boktu" // 복두 (Goryeo, long straight wings)
  | "jeollip" // 전립
  | "tugu" // 투구 with plume and ear flaps
  | "helmet" // Goryeo iron helmet with lamellar guard
  | "peaked" // peaked military cap
  | "kepi"
  | "forage" // slouched forage cap
  | "bowler"
  | "tophat"
  | "bicorne"
  | "qingcap" // Qing summer cap with red fringe
  | "qingofficial" // Qing winter official hat
  | "qinghelmet"
  | "jingasa" // 진가사
  | "satgat" // 삿갓
  | "paeraengi" // 패랭이 with cotton balls
  | "strawhat"
  | "kabuto"
  | "scarf" // wrapped head cloth (홍건)
  | "furhat"
  | "minghelmet"
  | "hood"
  | "tanggeon"; // 탕건

export interface HatSpec {
  kind: HatKind;
  color: string;
  /** Band, tassel, rim, crest or badge colour. */
  accent?: string;
  /** Plume / feather / flap colour. */
  plume?: string;
  /** Ornate variant: bigger crest, feather, extra trim. */
  big?: boolean;
}

export type UpperKind =
  | "jacket" // 저고리 / short coat to the hip
  | "jacketF" // short women's 저고리 over a high skirt
  | "robe" // ankle-length robe (도포, 단령, 곤룡포, 장삼)
  | "coat" // knee-length coat (두정갑, 전포, padded coats, frock coats)
  | "tunic" // fitted western jacket
  | "armor"; // torso armour with hanging skirt plates

export type Collar = "cross" | "round" | "high" | "open" | "none";

export type Pattern =
  | "none"
  | "lamellar" // 찰갑 scales
  | "studs" // 두정갑 rivets
  | "lacing" // Japanese laced plates
  | "quilt" // padded stitching
  | "dragon"; // 용보 medallions on chest and shoulders

export interface UpperSpec {
  kind: UpperKind;
  color: string;
  sleeve?: string;
  trim?: string;
  collar?: Collar;
  pattern?: Pattern;
  patternColor?: string;
  wideSleeves?: boolean;
  /** Bare forearms (rolled sleeves). */
  bareArms?: boolean;
  /** 색동 rainbow sleeve stripes. */
  stripes?: readonly string[];
}

export type LowerKind = "trousers" | "rolled" | "skirt" | "hakama" | "straight";

export interface LowerSpec {
  kind: LowerKind;
  color: string;
  /** Ankle ties (대님), gaiters or a trouser stripe. */
  tie?: string;
}

export interface ShoeSpec {
  color: string;
  boots?: boolean;
}

export type Detail =
  | { kind: "patch"; color: string; accent: string } // 흉배
  | { kind: "buttons"; color: string }
  | { kind: "crossbelts"; color: string }
  | { kind: "sash"; color: string } // diagonal sash
  | { kind: "kasaya"; color: string; accent?: string } // 가사 over the left shoulder
  | { kind: "apron"; color: string }
  | { kind: "vest"; color: string; trim?: string } // 전복 / sleeveless over-robe
  | { kind: "epaulettes"; color: string }
  | { kind: "pauldrons"; color: string; accent?: string }
  | { kind: "furcollar"; color: string }
  | { kind: "ribbon"; color: string } // 고름
  | { kind: "bag"; color: string } // side bag
  | { kind: "beads"; color: string } // 갓끈 / prayer beads
  | { kind: "facecloth"; color: string }
  | { kind: "trimhem"; color: string }; // contrasting hem band

export type BackItem =
  | { kind: "quiver"; color: string }
  | { kind: "flag"; color: string; accent: string }
  | { kind: "banner"; color: string; accent: string } // sashimono: tall narrow back banner
  | { kind: "jige"; color: string; load: string } // 지게 A-frame
  | { kind: "pack"; color: string } // bundle / herb box
  | { kind: "cape"; color: string };

export type WeaponKind =
  | "none"
  | "sword" // 환도 / straight sword
  | "curved" // katana / curved blade
  | "longsword" // nodachi
  | "sabre" // modern officer sabre
  | "spear"
  | "trident" // 당파
  | "bamboo" // 죽창
  | "staff"
  | "monkstaff" // 석장
  | "hoe"
  | "cane"
  | "bow"
  | "musket" // 조총 / matchlock
  | "rifle" // breech-loader with bayonet
  | "fan"
  | "warfan";

/** Weapon family used by gameplay to pick attack effects. */
export type WeaponClass =
  | "sword"
  | "spear"
  | "bamboo"
  | "bow"
  | "musket"
  | "staff"
  | "fists"
  | "claw";

export interface CostumeSpec {
  build?: Build;
  hair: HairStyle;
  hairColor?: string;
  beard?: Beard;
  beardColor?: string;
  hat?: HatSpec;
  upper: UpperSpec;
  lower: LowerSpec;
  shoes: ShoeSpec;
  belt?: string;
  details?: readonly Detail[];
  back?: BackItem;
  weapon: WeaponKind;
  /** Spear tassel / sword guard tint. */
  weaponAccent?: string;
  /** Overrides applied for the "f" body variant. */
  female?: Partial<CostumeSpec>;
  /** Which variant the key shows when none is requested. */
  defaultVariant?: "m" | "f";
}

export function weaponClassOf(weapon: WeaponKind): WeaponClass {
  switch (weapon) {
    case "sword":
    case "curved":
    case "longsword":
    case "sabre":
    case "fan":
    case "warfan":
      return "sword";
    case "spear":
    case "trident":
      return "spear";
    case "bamboo":
      return "bamboo";
    case "staff":
    case "monkstaff":
    case "hoe":
    case "cane":
      return "staff";
    case "bow":
      return "bow";
    case "musket":
    case "rifle":
      return "musket";
    case "none":
      return "fists";
  }
}
