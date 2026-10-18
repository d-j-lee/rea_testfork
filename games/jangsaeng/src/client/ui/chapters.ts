// Chapter metadata for the demo-mode chapter select, the title and the pitch screen.
// Titles, years, levels, montage, 대전 and the branches a chapter decides
// come from the content registry and the rules; the one-line highlights and
// extra tags are presenter copy owned by the UI.
import { CHAPTERS } from "../../shared/content/index.ts";
import { BRANCH_IDS, CHAPTER_IDS, type BranchId, type ChapterId } from "../../shared/content/schema.ts";
import { chapterBranches } from "../../shared/rules/index.ts";

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
  ch05: { highlight: "쓰시마 정벌(기해동정)과 4군 6진. 신기전이 손에 들어온다." },
  ch06: { highlight: "계유정난. 가장 높은 숙청 위험 속에서 편을 고른다.", tags: ["숙청 판정"] },
  ch07: { highlight: "사화가 휩쓰는 백 년을 세월 카드로 건넌다." },
  ch08: { highlight: "녹둔도에서 이순신을 만나고, 다가오는 전쟁을 대비한다." },
  ch09: { highlight: "동래성에서 행주까지. 의병을 일으켜 반격한다." },
  ch10: { highlight: "열세 척으로 명량의 바다를 버틴다." },
  ch11: { highlight: "남한산성 농성. 척화와 주화 사이에서 선택한다." },
  ch12: { highlight: "환국의 소용돌이를 줄서기와 탕평으로 건넌다." },
  ch13: { highlight: "장용영을 지켜 세도의 그늘을 늦춘다." },
  ch14: { highlight: "정족산성을 지키고, 강화도조약의 조항을 다툰다." },
  ch15: { highlight: "군란과 정변, 갑오년. 외국군 개입의 연쇄를 끊는다." },
  ch16: { highlight: "중명전 수호와 13도 창의군. 1910년의 최종 정산.", tags: ["최종장"] },
};

/** "B1·B2" for two branches, "B5–B8" for a run of more, by branch id order. */
function branchSpan(ids: readonly BranchId[]): string {
  const first = ids[0];
  const last = ids[ids.length - 1];
  if (!first || !last) return "";
  return ids.length <= 2 ? ids.join("·") : `${first}–${last}`;
}

/** Every branch, as the pitch and help name the range ("B1–B12c"). */
export const ALL_BRANCHES = branchSpan(BRANCH_IDS);

/**
 * Years of the first and last branch decisions (B1 장용영 1802, B12c 군대
 * 해산 1907). Presenter copy: the rules own the branches and carry each
 * year in BRANCH_LABELS; tests/unit/client-copy.test.ts pins these to them.
 */
export const BRANCH_YEARS: readonly [number, number] = [1802, 1907];

export function chapterMeta(id: ChapterId): ChapterMeta {
  const def = CHAPTERS[id];
  const copy = COPY[id];
  const great = def.battles.some((battle) => battle.great);
  const montage = def.montage ?? false;
  const branches = branchSpan(chapterBranches(id));
  return {
    id,
    order: def.order,
    title: def.title,
    subtitle: def.subtitle,
    years: def.years,
    level: def.level,
    highlight: copy.highlight,
    tags: [...(great ? ["대전"] : []), ...(montage ? ["몽타주"] : []), ...(branches ? [branches] : []), ...(copy.tags ?? [])],
    montage,
    great,
  };
}

export function allChapters(): ChapterMeta[] {
  return CHAPTER_IDS.map(chapterMeta);
}

/**
 * The one life the chapters tell: how many there are and the years from the
 * first chapter's start to the last chapter's end (the title and the pitch
 * name these).
 */
export function chapterArc(chapters: readonly ChapterMeta[] = allChapters()): { count: number; from: number; to: number } {
  const first = chapters[0];
  const last = chapters[chapters.length - 1];
  if (!first || !last) throw new Error("the content registry has no chapters");
  return { count: chapters.length, from: first.years[0], to: last.years[1] };
}

/** The historical 대전 the pitch screen names (presenter choice, by battle id). */
export const PITCH_BATTLES: readonly string[] = ["ch02_hwangsan", "b_haengju", "b_myeongnyang", "b_namhan", "b_jeongjok"];

/**
 * Titles of the given 대전 battles, in the order given. The names come from
 * the content registry (which owns battle titles: 황산대첩, 남한산성 농성 …);
 * an id that is not a 대전 there is left out.
 */
export function greatBattleTitles(ids: readonly string[]): string[] {
  const titles = new Map<string, string>();
  for (const id of CHAPTER_IDS)
    for (const battle of CHAPTERS[id].battles) if (battle.great) titles.set(battle.id, battle.title);
  return ids.flatMap((id) => titles.get(id) ?? []);
}

export function chapterNumber(order: number): string {
  return `제${order}장`;
}
