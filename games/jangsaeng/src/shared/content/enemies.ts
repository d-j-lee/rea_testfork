// Enemy roster. Names follow allegiance + arm ("왜구 궁수", "청 기병"), never
// ethnic slurs. Stats are level-1 bases; sim scales hp ×(1 + 0.10·(L−1)) and
// atk ×(1 + 0.08·(L−1)).
import type { EnemyDef } from "./schema.ts";

const list: EnemyDef[] = [
  // 고려말 외침
  { id: "red_turban_spear", name: "홍건적 창병", sprite: "red_turban", behavior: "melee", hp: 40, atk: 8, def: 4, speed: 3.2, range: 1.4, cooldown: 1.2, sight: 7, poise: 20 },
  { id: "red_turban_axe", name: "홍건적 도부수", sprite: "red_turban", behavior: "brute", hp: 62, atk: 13, def: 5, speed: 2.8, range: 1.3, cooldown: 1.8, sight: 7, poise: 35 },
  { id: "wokou_raider", name: "왜구 도적", sprite: "wokou", behavior: "melee", hp: 38, atk: 9, def: 3, speed: 3.8, range: 1.2, cooldown: 1.0, sight: 8, poise: 18, drops: [{ item: "rice_ball", chance: 0.12 }] },
  { id: "wokou_archer", name: "왜구 궁수", sprite: "wokou", behavior: "archer", hp: 30, atk: 8, def: 2, speed: 3.2, range: 6, cooldown: 2.0, sight: 9, poise: 12 },
  { id: "jurchen_rider", name: "여진 기병", sprite: "jurchen", behavior: "charger", hp: 55, atk: 12, def: 4, speed: 4.6, range: 1.4, cooldown: 2.6, sight: 10, poise: 30 },
  { id: "jurchen_archer", name: "여진 궁기병", sprite: "jurchen", behavior: "archer", hp: 44, atk: 10, def: 3, speed: 3.9, range: 7, cooldown: 2.2, sight: 10, poise: 20 },
  // 조선 내부의 난
  { id: "rebel_shield", name: "반란군 방패병", sprite: "rebel", behavior: "shield", hp: 72, atk: 9, def: 10, speed: 2.6, range: 1.2, cooldown: 1.6, sight: 7, poise: 45 },
  { id: "rebel_spear", name: "반란군 창병", sprite: "rebel", behavior: "melee", hp: 48, atk: 11, def: 5, speed: 3.1, range: 1.5, cooldown: 1.3, sight: 7, poise: 22 },
  { id: "assassin", name: "자객", sprite: "assassin", behavior: "melee", hp: 46, atk: 14, def: 3, speed: 4.3, range: 1.2, cooldown: 0.9, sight: 8, poise: 15 },
  { id: "bandit", name: "도적", sprite: "bandit", behavior: "melee", hp: 34, atk: 8, def: 2, speed: 3.4, range: 1.2, cooldown: 1.1, sight: 7, poise: 14, drops: [{ item: "coin_pouch", chance: 0.25 }] },
  { id: "pursuer", name: "추격대", sprite: "soldier_joseon", behavior: "melee", hp: 50, atk: 12, def: 6, speed: 3.6, range: 1.5, cooldown: 1.2, sight: 10, poise: 25 },
  // 임진·정유
  { id: "japanese_spear", name: "왜군 창병", sprite: "japanese_samurai", behavior: "melee", hp: 56, atk: 11, def: 6, speed: 3.0, range: 1.7, cooldown: 1.4, sight: 8, poise: 28 },
  { id: "japanese_musket", name: "왜군 조총병", sprite: "japanese_ashigaru", behavior: "musket", hp: 40, atk: 22, def: 3, speed: 2.8, range: 8, cooldown: 4.0, sight: 10, poise: 16 },
  { id: "japanese_marine", name: "왜군 도선병", sprite: "japanese_samurai", behavior: "melee", hp: 50, atk: 12, def: 5, speed: 3.4, range: 1.4, cooldown: 1.2, sight: 8, poise: 24 },
  // 호란
  { id: "qing_rider", name: "청 기병", sprite: "qing_soldier", behavior: "charger", hp: 72, atk: 14, def: 6, speed: 4.8, range: 1.5, cooldown: 2.4, sight: 10, poise: 34 },
  { id: "qing_armored", name: "청 철갑병", sprite: "qing_soldier", behavior: "brute", hp: 110, atk: 16, def: 14, speed: 2.4, range: 1.4, cooldown: 2.0, sight: 7, poise: 60 },
  { id: "qing_archer", name: "청 궁병", sprite: "qing_soldier", behavior: "archer", hp: 50, atk: 13, def: 4, speed: 3.0, range: 7, cooldown: 2.1, sight: 9, poise: 20 },
  // 양요·근대
  { id: "french_marine", name: "프랑스군 해병", sprite: "french_marine", behavior: "rifle", hp: 62, atk: 18, def: 6, speed: 3.0, range: 9, cooldown: 2.6, sight: 11, poise: 26 },
  { id: "us_marine", name: "미군 해병", sprite: "us_marine", behavior: "rifle", hp: 64, atk: 19, def: 6, speed: 3.0, range: 9, cooldown: 2.5, sight: 11, poise: 26 },
  { id: "japanese_infantry", name: "일본군 보병", sprite: "japanese_modern", behavior: "rifle", hp: 72, atk: 20, def: 8, speed: 3.2, range: 10, cooldown: 2.4, sight: 12, poise: 30 },
  { id: "japanese_vanguard", name: "일본군 돌격병", sprite: "japanese_modern", behavior: "melee", hp: 80, atk: 18, def: 9, speed: 3.6, range: 1.6, cooldown: 1.3, sight: 10, poise: 32 },
  // 산짐승
  { id: "tiger", name: "호랑이", sprite: "tiger", behavior: "beast", hp: 160, atk: 20, def: 6, speed: 5.0, range: 1.5, cooldown: 1.6, sight: 9, poise: 50, elite: true, drops: [{ item: "ginseng", chance: 0.35 }] },
  { id: "wolf", name: "늑대", sprite: "wolf", behavior: "beast", hp: 30, atk: 7, def: 2, speed: 4.4, range: 1.2, cooldown: 1.1, sight: 8, poise: 10 },
  { id: "boar", name: "멧돼지", sprite: "boar", behavior: "charger", hp: 52, atk: 10, def: 4, speed: 4.0, range: 1.3, cooldown: 2.4, sight: 6, poise: 30, drops: [{ item: "rice_ball", chance: 0.3 }] },
  { id: "bear", name: "곰", sprite: "bear", behavior: "brute", hp: 120, atk: 17, def: 8, speed: 3.0, range: 1.4, cooldown: 2.0, sight: 6, poise: 55, elite: true, drops: [{ item: "herb_tonic", chance: 0.4 }] },
  // 보스 몸체 (BattleDef.boss가 이름·단계를 덧씌운다)
  { id: "boss_red_turban", name: "홍건적 선봉장", sprite: "red_turban", behavior: "boss", hp: 420, atk: 15, def: 8, speed: 3.2, range: 1.6, cooldown: 1.4, sight: 12, poise: 120 },
  { id: "boss_wokou_captain", name: "왜구 장수", sprite: "wokou_captain", behavior: "boss", hp: 620, atk: 18, def: 10, speed: 3.6, range: 1.6, cooldown: 1.2, sight: 12, poise: 150 },
  { id: "boss_duelist", name: "결투 상대", sprite: "general_goryeo", behavior: "boss", hp: 520, atk: 17, def: 9, speed: 3.8, range: 1.5, cooldown: 1.0, sight: 12, poise: 110 },
  { id: "boss_rebel_captain", name: "반란군 부장", sprite: "rebel", behavior: "boss", hp: 700, atk: 19, def: 14, speed: 3.0, range: 1.5, cooldown: 1.4, sight: 12, poise: 160 },
  { id: "boss_japanese_general", name: "왜군 장수", sprite: "japanese_general", behavior: "boss", hp: 900, atk: 24, def: 14, speed: 3.2, range: 1.8, cooldown: 1.3, sight: 13, poise: 180 },
  { id: "boss_qing_general", name: "청 기병대장", sprite: "qing_general", behavior: "boss", hp: 1000, atk: 26, def: 16, speed: 4.4, range: 1.8, cooldown: 1.4, sight: 13, poise: 200 },
  { id: "boss_western_officer", name: "원정군 지휘관", sprite: "french_marine", behavior: "boss", hp: 980, atk: 27, def: 14, speed: 3.0, range: 9, cooldown: 2.0, sight: 13, poise: 170 },
  { id: "boss_japanese_commander", name: "일본군 수비대 지휘관", sprite: "japanese_modern", behavior: "boss", hp: 1300, atk: 30, def: 18, speed: 3.2, range: 10, cooldown: 1.8, sight: 14, poise: 220 },
  { id: "boss_tiger_lord", name: "백두산 범", sprite: "tiger", behavior: "boss", hp: 760, atk: 26, def: 10, speed: 5.4, range: 1.6, cooldown: 1.3, sight: 12, poise: 150 },
];

export const ENEMIES: Readonly<Record<string, EnemyDef>> = Object.fromEntries(
  list.map((enemy) => [enemy.id, enemy]),
);
