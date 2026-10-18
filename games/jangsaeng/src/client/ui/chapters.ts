// Chapter metadata for the demo-mode chapter select and the pitch screen.
// Titles, years and levels come from the content registry once writers have
// filled a chapter; until then the design-document values stand in. The
// one-line highlights are presenter copy owned by the UI.
import { CHAPTERS } from "../../shared/content/index.ts";
import { CHAPTER_IDS, type ChapterId } from "../../shared/content/schema.ts";

export interface ChapterMeta {
  id: ChapterId;
  order: number;
  title: string;
  subtitle: string;
  years: readonly [number, number];
  level: readonly [number, number];
  highlight: string;
  tags: readonly string[];
  montage: boolean;
}

type Fallback = Omit<ChapterMeta, "id" | "order" | "subtitle">;

const DESIGN: Readonly<Record<ChapterId, Fallback>> = {
  ch01: { title: "노인성의 밤", years: [1361, 1364], level: [1, 5], highlight: "홍건적에 함락된 개경. 사경에서 노인성의 빛을 받고 깨어난다.", tags: ["튜토리얼"], montage: false },
  ch02: { title: "왜구의 시대, 두 명장", years: [1365, 1387], level: [5, 10], highlight: "진포의 화통과 황산대첩. 최영과 이성계 사이에서 이름을 쌓는다.", tags: ["대첩"], montage: false },
  ch03: { title: "위화도에서 개국까지", years: [1388, 1392], level: [10, 14], highlight: "회군의 갈림길. 새 왕조의 개국공신 책록을 노린다.", tags: ["숙청 판정"], montage: false },
  ch04: { title: "형제의 칼", years: [1393, 1418], level: [14, 16], highlight: "왕자의 난 속에서 살아남고, 처음으로 신분을 바꾼다.", tags: ["신분 세탁"], montage: false },
  ch05: { title: "세종의 바다와 북방", years: [1419, 1452], level: [16, 19], highlight: "대마도 정벌과 4군 6진. 신기전이 손에 들어온다.", tags: [], montage: false },
  ch06: { title: "계유년의 밤", years: [1453, 1468], level: [19, 21], highlight: "계유정난. 가장 높은 숙청 위험 속에서 편을 고른다.", tags: ["숙청 판정"], montage: false },
  ch07: { title: "사화의 세기", years: [1469, 1574], level: [21, 23], highlight: "사화가 휩쓰는 백 년을 세월 카드로 건넌다.", tags: ["몽타주"], montage: true },
  ch08: { title: "붕당과 전야", years: [1575, 1591], level: [23, 25], highlight: "녹둔도에서 이순신을 만나고, 다가오는 전쟁을 대비한다.", tags: [], montage: false },
  ch09: { title: "임진년", years: [1592, 1593], level: [25, 30], highlight: "동래성에서 행주까지. 의병을 일으켜 반격한다.", tags: ["대첩"], montage: false },
  ch10: { title: "정유년과 노량", years: [1597, 1598], level: [30, 32], highlight: "열두 척으로 명량의 바다를 버틴다.", tags: ["대첩"], montage: false },
  ch11: { title: "두 번의 호란", years: [1608, 1658], level: [32, 34], highlight: "남한산성 농성. 척화와 주화 사이에서 선택한다.", tags: ["대첩"], montage: false },
  ch12: { title: "환국과 탕평", years: [1659, 1775], level: [34, 35], highlight: "환국의 소용돌이를 줄서기와 탕평으로 건넌다.", tags: ["몽타주"], montage: true },
  ch13: { title: "정조의 꿈, 세도의 그늘", years: [1776, 1862], level: [35, 36], highlight: "장용영을 지켜 세도의 그늘을 늦춘다.", tags: ["B1·B2"], montage: false },
  ch14: { title: "양요와 개항", years: [1863, 1881], level: [36, 37], highlight: "정족산성 대첩, 그리고 강화도조약의 조항을 다툰다.", tags: ["대첩", "B3·B4"], montage: false },
  ch15: { title: "정변과 갑오년", years: [1882, 1895], level: [37, 39], highlight: "군란과 정변, 갑오년. 외국군 개입의 연쇄를 끊는다.", tags: ["B5–B8"], montage: false },
  ch16: { title: "제국의 마지막 14년", years: [1896, 1910], level: [39, 40], highlight: "중명전 수호와 13도 창의군. 1910년의 최종 정산.", tags: ["대첩", "B9–B12", "최종장"], montage: false },
};

function isPlaceholder(title: string): boolean {
  return title.trim() === "" || title.includes("준비 중");
}

export function chapterMeta(id: ChapterId): ChapterMeta {
  const def = CHAPTERS[id];
  const fallback = DESIGN[id];
  const order = CHAPTER_IDS.indexOf(id) + 1;
  if (!def || isPlaceholder(def.title)) {
    return { id, order, subtitle: "", ...fallback };
  }
  return {
    id,
    order: def.order || order,
    title: def.title,
    subtitle: def.subtitle,
    years: def.years,
    level: def.level,
    highlight: fallback.highlight,
    tags: fallback.tags,
    montage: def.montage ?? fallback.montage,
  };
}

export function allChapters(): ChapterMeta[] {
  return CHAPTER_IDS.map(chapterMeta);
}

export function chapterNumber(order: number): string {
  return `제${order}장`;
}
