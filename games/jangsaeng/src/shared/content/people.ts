// Origins, ranks and office titles.
import type { OfficeTable, OriginDef, RankDef } from "./schema.ts";

export const ORIGINS: Readonly<Record<string, OriginDef>> = {
  northeast: {
    id: "northeast",
    name: "동북면 무가",
    desc: "함흥 무가의 자손. 이성계 휘하에서 시작한다.",
    stats: { power: 3, body: 3 },
    favor: { yi: 10 },
  },
  kaesong: {
    id: "kaesong",
    name: "개경 군관가",
    desc: "개경 군관의 아들딸. 최영 휘하에서 시작한다.",
    stats: { agility: 3, wit: 3 },
    favor: { choe: 10 },
  },
  southcoast: {
    id: "southcoast",
    name: "남해 어촌 피란민",
    desc: "왜구에게 고향을 잃었다. 사람을 살리는 일에 마음이 간다.",
    stats: { agility: 3, tact: 3 },
    points: { virtue: 50 },
  },
};

const GRADES = [
  "종9품", "정9품", "종8품", "정8품", "종7품", "정7품", "종6품", "정6품", "종5품",
  "정5품", "종4품", "정4품", "종3품", "정3품 당상", "종2품", "정2품", "종1품", "정1품",
];

export const RANKS: readonly RankDef[] = GRADES.map((grade, index) => ({
  step: index + 1,
  grade,
  senior: index + 1 >= 14,
}));

export const OFFICE_TABLES: readonly OfficeTable[] = [
  {
    from: 1300,
    titles: [
      "무관직", "대정", "대정", "교위", "교위", "산원", "산원", "별장", "별장", "낭장",
      "낭장", "중랑장", "중랑장", "장군", "장군", "대장군", "대장군", "상장군", "상장군",
    ],
  },
  {
    from: 1392,
    titles: [
      "무관직", "부사용", "사용", "부사맹", "사맹", "부사정", "사정", "부사과", "사과", "부사직",
      "사직", "부호군", "호군", "대호군", "상호군", "병마절도사", "오위도총관", "판중추부사", "영중추부사",
    ],
  },
  {
    from: 1895,
    titles: [
      "무관직", "참위", "참위", "참위", "참위", "부위", "부위", "정위", "정위", "참령",
      "참령", "부령", "부령", "정령", "정령", "참장", "참장", "부장", "대장",
    ],
  },
];

export function officeTitle(rank: number, year: number): string {
  let table = OFFICE_TABLES[0] as OfficeTable;
  for (const candidate of OFFICE_TABLES) if (year >= candidate.from) table = candidate;
  return table.titles[Math.max(0, Math.min(18, rank))] ?? "무관직";
}

export function gradeName(rank: number): string {
  return rank <= 0 ? "무품" : (RANKS[Math.min(18, rank) - 1]?.grade ?? "무품");
}
