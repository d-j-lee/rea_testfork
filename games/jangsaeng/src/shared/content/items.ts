import type { ItemDef } from "./schema.ts";

const list: ItemDef[] = [
  // 무기 — 시대별 계보
  { id: "rusty_hwando", name: "녹슨 환도", kind: "weapon", family: "sword", atk: 10, desc: "피란길에 주운 낡은 칼." },
  { id: "hwando", name: "환도", kind: "weapon", family: "sword", atk: 14, desc: "고려 군관의 허리칼." },
  { id: "wolgdo", name: "월도", kind: "weapon", family: "sword", atk: 19, desc: "언월도. 휘두르는 힘이 크다." },
  { id: "ungeom", name: "운검", kind: "weapon", family: "sword", atk: 25, desc: "임금을 호위하는 무관의 칼." },
  { id: "ssangsudo", name: "쌍수도", kind: "weapon", family: "sword", atk: 32, desc: "임진년 이후 익힌 긴 양손칼." },
  { id: "jangyong_hwando", name: "장용영 환도", kind: "weapon", family: "sword", atk: 40, desc: "장용영 무관에게 내린 칼." },
  { id: "empire_sabre", name: "대한제국 군도", kind: "weapon", family: "sword", atk: 48, desc: "원수부 무관의 지휘도." },
  // 갑옷
  { id: "cotton_clothes", name: "무명옷", kind: "armor", def: 2, desc: "거친 무명 한 벌." },
  { id: "chalgap", name: "찰갑", kind: "armor", def: 6, desc: "작은 쇳조각을 엮은 고려 갑옷." },
  { id: "dujeonggap", name: "두정갑", kind: "armor", def: 10, desc: "못을 박은 조선 무관 갑옷." },
  { id: "gyeongbeongap", name: "경번갑", kind: "armor", def: 14, desc: "쇠고리와 판을 엮은 갑옷." },
  { id: "jangyong_armor", name: "장용영 갑주", kind: "armor", def: 18, desc: "정조의 친위 군영 갑주." },
  { id: "empire_uniform", name: "대한제국 군복", kind: "armor", def: 20, desc: "시위대 장교 군복." },
  // 소모품
  { id: "rice_ball", name: "주먹밥", kind: "consumable", heal: 30, price: 10, desc: "체력 30 회복." },
  { id: "herb_tonic", name: "탕약", kind: "consumable", heal: 80, price: 40, desc: "체력 80 회복." },
  { id: "cheongsimhwan", name: "청심환", kind: "consumable", heal: 160, price: 120, desc: "체력 160 회복." },
  { id: "ginseng", name: "산삼", kind: "consumable", life: 2, desc: "천수 +2년. 깊은 산의 영약." },
  // 귀중품·열쇠
  { id: "coin_pouch", name: "엽전 꾸러미", kind: "treasure", price: 30, desc: "팔면 30전." },
  { id: "mapae", name: "마패", kind: "key", desc: "역참에서 말을 빌려 빠르게 이동할 수 있다." },
  { id: "song_fan", name: "송상현의 부채", kind: "key", desc: "동래부사가 아버지께 남긴 글이 적힌 부채." },
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  list.map((item) => [item.id, item]),
);

/** Weapon/armor that a fresh character of each era should carry (demo presets). */
export const ERA_GEAR: readonly { from: number; weapon: string; armor: string }[] = [
  { from: 1361, weapon: "rusty_hwando", armor: "cotton_clothes" },
  { from: 1380, weapon: "hwando", armor: "chalgap" },
  { from: 1392, weapon: "wolgdo", armor: "dujeonggap" },
  { from: 1450, weapon: "ungeom", armor: "dujeonggap" },
  { from: 1592, weapon: "ssangsudo", armor: "gyeongbeongap" },
  { from: 1790, weapon: "jangyong_hwando", armor: "jangyong_armor" },
  { from: 1897, weapon: "empire_sabre", armor: "empire_uniform" },
];
