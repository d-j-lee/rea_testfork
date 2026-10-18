// Chapter metadata for the demo-mode chapter select and the pitch screen.
// Titles, years, levels, montage and 대전 come from the content registry;
// the one-line highlights and extra tags are presenter copy owned by the UI.
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
  /** Has a 대전(大戰): a great battle that grants lifespan on the first win. */
  great: boolean;
}

const COPY: Readonly<Record<ChapterId, { highlight: string; tags?: readonly string[] }>> = {
  ch01: { highlight: "홍건적에 함락된 개경. 사경에서 노인성의 빛을 받고 깨어난다.", tags: ["튜토리얼"] },
  ch02: { highlight: "진포의 화통과 황산대첩. 최영과 이성계 사이에서 이름을 쌓는다." },
  ch03: { highlight: "회군의 갈림길. 새 왕조의 개국공신 책록을 노린다.", tags: ["숙청 판정"] },
  ch04: { highlight: "왕자의 난 속에서 살아남고, 처음으로 신분을 바꾼다.", tags: ["신분 세탁"] },
  ch05: { highlight: "대마도 정벌과 4군 6진. 신기전이 손에 들어온다." },
  ch06: { highlight: "계유정난. 가장 높은 숙청 위험 속에서 편을 고른다.", tags: ["숙청 판정"] },
  ch07: { highlight: "사화가 휩쓰는 백 년을 세월 카드로 건넌다." },
  ch08: { highlight: "녹둔도에서 이순신을 만나고, 다가오는 전쟁을 대비한다." },
  ch09: { highlight: "동래성에서 행주까지. 의병을 일으켜 반격한다." },
  ch10: { highlight: "열세 척으로 명량의 바다를 버틴다." },
  ch11: { highlight: "남한산성 농성. 척화와 주화 사이에서 선택한다." },
  ch12: { highlight: "환국의 소용돌이를 줄서기와 탕평으로 건넌다." },
  ch13: { highlight: "장용영을 지켜 세도의 그늘을 늦춘다.", tags: ["B1·B2"] },
  ch14: { highlight: "정족산성을 지키고, 강화도조약의 조항을 다툰다.", tags: ["B3·B4"] },
  ch15: { highlight: "군란과 정변, 갑오년. 외국군 개입의 연쇄를 끊는다.", tags: ["B5–B8"] },
  ch16: { highlight: "중명전 수호와 13도 창의군. 1910년의 최종 정산.", tags: ["B9–B12", "최종장"] },
};

export function chapterMeta(id: ChapterId): ChapterMeta {
  const def = CHAPTERS[id];
  const copy = COPY[id];
  const great = def.battles.some((battle) => battle.great);
  const montage = def.montage ?? false;
  return {
    id,
    order: def.order,
    title: def.title,
    subtitle: def.subtitle,
    years: def.years,
    level: def.level,
    highlight: copy.highlight,
    tags: [...(great ? ["대전"] : []), ...(montage ? ["몽타주"] : []), ...(copy.tags ?? [])],
    montage,
    great,
  };
}

export function allChapters(): ChapterMeta[] {
  return CHAPTER_IDS.map(chapterMeta);
}

export function chapterNumber(order: number): string {
  return `제${order}장`;
}
