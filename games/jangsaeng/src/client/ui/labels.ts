// Display vocabulary shared by several screens. Identity values stay as the
// protocol sends them; these tables only map them to Korean labels.
import type { IdentityKind, WashMethod } from "../../shared/content/schema.ts";
import type { SelfView } from "../../shared/types.ts";

/** Marks simulated companions wherever a name is shown (chat, roster, plates). */
export const SIM_MARK = "◇";

export function botName(name: string): string {
  return name.startsWith(SIM_MARK) ? name : `${SIM_MARK}${name}`;
}

export const IDENTITY_LABELS: Readonly<Record<IdentityKind, string>> = {
  birth: "본래 이름",
  descendant: "후손 행세",
  fakeDeath: "죽음 위장",
  monk: "출가",
  merchant: "상인 신분",
  exam: "과거 급제",
  forced: "강제 세탁",
  successor: "유지 계승",
};

export const WASH_GLYPH: Readonly<Record<WashMethod, string>> = {
  descendant: "孫",
  fakeDeath: "葬",
  monk: "僧",
  merchant: "商",
  exam: "科",
};

export const SUSPICION_BANDS: Readonly<Record<SelfView["suspicionBand"], { label: string; tone: string }>> = {
  calm: { label: "평온", tone: "calm" },
  rumour: { label: "소문", tone: "rumour" },
  inquiry: { label: "추궁", tone: "inquiry" },
  exposed: { label: "발각 위기", tone: "exposed" },
};

export function meritLabel(grade: 1 | 2 | 3 | 4): string {
  return grade === 4 ? "원종공신" : `개국공신 ${grade}등`;
}

/** Hanja glyph shown on skill buttons, by skill kind. */
export const SKILL_GLYPH: Readonly<Record<string, string>> = {
  dash: "突",
  spin: "旋",
  shout: "喝",
  pierce: "箭",
  rockets: "火",
  barrage: "神",
  parry: "盾",
  bomb: "雷",
  musket: "銃",
  rifle: "銃",
  longevity: "壽",
};

export const ITEM_KIND_LABELS: Readonly<Record<string, string>> = {
  weapon: "무기",
  armor: "갑주",
  consumable: "소모품",
  treasure: "귀중품",
  key: "중요 물품",
};

/** Risk band of the 풍향계 (purge-risk weather vane), 0..100. */
export function riskTone(value: number): { tone: string; label: string } {
  if (value < 25) return { tone: "low", label: "잔잔함" };
  if (value < 50) return { tone: "mid", label: "바람 붊" };
  if (value < 70) return { tone: "high", label: "거센 바람" };
  return { tone: "severe", label: "폭풍" };
}

/** Loading-screen lines: unattributed in-world aphorisms (no invented quotes of real people). */
export const ERA_QUOTES: readonly string[] = [
  "노인성이 남쪽 하늘에 보이면 나라가 평안하고 사람이 오래 산다 하였다.",
  "칼은 한 시대를 베고, 이름은 오백 년을 남는다.",
  "늙지 않는 얼굴은 언젠가 질문을 부른다.",
  "실록은 왕의 기록이고, 장생록은 살아남은 자의 기록이다.",
  "바람의 방향을 읽는 자만이 숙청의 밤을 넘긴다.",
  "천수는 쓰는 것이다. 아끼기만 하면 아무것도 지키지 못한다.",
  "같은 별빛을 받은 이들이 같은 시대에 서 있다.",
];

const SURNAMES = ["강", "윤", "한", "서", "류", "송", "홍", "남", "연", "백", "진", "하", "문", "설"];
const GIVEN_M = ["무진", "도현", "태겸", "성휘", "건", "율", "해원", "지운", "청", "규", "한결", "온"];
const GIVEN_F = ["서연", "연화", "소원", "다온", "은설", "해림", "가람", "윤슬", "초아", "단", "하늘", "새봄"];

export function suggestName(variant: "m" | "f", seed = Math.random()): string {
  const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length] as T;
  const r1 = seed;
  const r2 = (seed * 7919) % 1;
  return pick(SURNAMES, r1) + pick(variant === "m" ? GIVEN_M : GIVEN_F, r2);
}

export const NAME_RULE = /^[가-힣A-Za-z0-9]{2,12}$/;

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "이름은 두 글자 이상이어야 합니다.";
  if (trimmed.length > 12) return "이름은 열두 글자까지 쓸 수 있습니다.";
  if (!NAME_RULE.test(trimmed)) return "한글 완성자·영문·숫자만 쓸 수 있습니다.";
  return null;
}
