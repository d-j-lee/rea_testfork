// Era-unlocked skills. The weapon lineage changes across 500 years so the
// passage of time is felt in the hands: sword → rockets → muskets → rifles.
import type { SkillDef } from "./schema.ts";

const list: SkillDef[] = [
  { id: "dash_slash", name: "돌진베기", desc: "3칸을 내달리며 벤다.", kind: "dash", unlock: "ch01", energy: 20, cooldown: 6, coef: 1.8, range: 3 },
  { id: "whirlwind", name: "회선참", desc: "월도를 휘둘러 주위를 두 바퀴 벤다.", kind: "spin", unlock: "ch01", energy: 30, cooldown: 10, coef: 1.2, radius: 1.8 },
  { id: "war_cry", name: "함성", desc: "주위 아군 공격력 +15%(8초), 적을 1초 위축시킨다.", kind: "shout", unlock: "ch01", energy: 30, cooldown: 30, coef: 0, radius: 5 },
  { id: "pyeonjeon", name: "편전", desc: "통아로 쏘는 애기살. 적을 꿰뚫는다.", kind: "pierce", unlock: "ch02", energy: 25, cooldown: 8, coef: 2.0, range: 12 },
  { id: "juhwa", name: "주화", desc: "화통도감의 불화살 세 발을 부채꼴로 쏜다.", kind: "rockets", unlock: "ch02", energy: 35, cooldown: 14, coef: 1.0, range: 8 },
  { id: "singijeon", name: "신기전", desc: "화차에서 신기전 열두 발을 퍼붓는다.", kind: "barrage", unlock: "ch05", energy: 50, cooldown: 25, coef: 0.7, range: 9, radius: 2.5 },
  { id: "deungpae", name: "등패 막기", desc: "1.5초 동안 정면 화살·탄환을 튕겨낸다.", kind: "parry", unlock: "ch05", energy: 20, cooldown: 12, coef: 0 },
  { id: "bigyeok", name: "비격진천뢰", desc: "3초 뒤 터지는 진천뢰를 놓는다.", kind: "bomb", unlock: "ch09", energy: 40, cooldown: 30, coef: 4.0, radius: 2.5 },
  { id: "jochong", name: "조총 자세", desc: "조준 후 일직선으로 꿰뚫는 사격.", kind: "musket", unlock: "ch09", energy: 0, cooldown: 4, coef: 3.5, range: 10 },
  { id: "ssanggeom", name: "쌍검 육연격", desc: "무예도보통지 쌍검 — 주위를 여섯 번 벤다.", kind: "spin", unlock: "ch13", energy: 35, cooldown: 9, coef: 0.7, radius: 1.9 },
  { id: "rifle", name: "개량 소총", desc: "빠르게 장전하는 후장식 소총 사격.", kind: "rifle", unlock: "ch14", energy: 0, cooldown: 1.5, coef: 2.5, range: 14 },
];

export const SKILLS: Readonly<Record<string, SkillDef>> = Object.fromEntries(
  list.map((skill) => [skill.id, skill]),
);

/** Slot 5: burns one year of lifespan; max 3 per chapter. */
export const LONGEVITY_SKILL: SkillDef = {
  id: "longevity",
  name: "노인성 일섬",
  desc: "천수 1년을 태워 화면 안의 모든 적을 벤다. 5초 무적. 장마다 3회.",
  kind: "longevity",
  unlock: "ch01",
  energy: 0,
  cooldown: 20,
  coef: 8.0,
};
