// Content registry: the single place that assembles all game data.
import type { ChapterDef, ChapterId, CompanionLines, CompanionPersona, HistoryNote, NationEndingDef, PersonalEndingDef } from "./schema.ts";
import { CHAPTER_IDS } from "./schema.ts";
import { ENEMIES } from "./enemies.ts";
import { ITEMS, ERA_GEAR } from "./items.ts";
import { LONGEVITY_SKILL, SKILLS } from "./skills.ts";
import { OFFICE_TABLES, ORIGINS, RANKS, gradeName, officeTitle } from "./people.ts";
import { COMPANION_LINES, COMPANION_PERSONAS } from "./companions.ts";
import { NATION_ENDINGS, PERSONAL_ENDINGS, ENDING_HISTORY_NOTE } from "./endings.ts";
import { ch01 } from "./chapters/ch01.ts";
import { ch02 } from "./chapters/ch02.ts";
import { ch03 } from "./chapters/ch03.ts";
import { ch04 } from "./chapters/ch04.ts";
import { ch05 } from "./chapters/ch05.ts";
import { ch06 } from "./chapters/ch06.ts";
import { ch07 } from "./chapters/ch07.ts";
import { ch08 } from "./chapters/ch08.ts";
import { ch09 } from "./chapters/ch09.ts";
import { ch10 } from "./chapters/ch10.ts";
import { ch11 } from "./chapters/ch11.ts";
import { ch12 } from "./chapters/ch12.ts";
import { ch13 } from "./chapters/ch13.ts";
import { ch14 } from "./chapters/ch14.ts";
import { ch15 } from "./chapters/ch15.ts";
import { ch16 } from "./chapters/ch16.ts";

export const CHAPTERS: Readonly<Record<ChapterId, ChapterDef>> = {
  ch01, ch02, ch03, ch04, ch05, ch06, ch07, ch08,
  ch09, ch10, ch11, ch12, ch13, ch14, ch15, ch16,
};

export const CHAPTER_ORDER: readonly ChapterId[] = CHAPTER_IDS;

export function nextChapter(id: ChapterId): ChapterId | null {
  const index = CHAPTER_ORDER.indexOf(id);
  return CHAPTER_ORDER[index + 1] ?? null;
}

export interface ContentIndex {
  chapters: typeof CHAPTERS;
  enemies: typeof ENEMIES;
  items: typeof ITEMS;
  skills: typeof SKILLS;
  longevity: typeof LONGEVITY_SKILL;
  origins: typeof ORIGINS;
  ranks: typeof RANKS;
  offices: typeof OFFICE_TABLES;
  eraGear: typeof ERA_GEAR;
  companions: { personas: readonly CompanionPersona[]; lines: CompanionLines };
  endings: {
    nation: Readonly<Record<NationEndingDef["id"], NationEndingDef>>;
    personal: Readonly<Record<PersonalEndingDef["id"], PersonalEndingDef>>;
    historyNote: readonly HistoryNote[];
  };
}

export const CONTENT: ContentIndex = {
  chapters: CHAPTERS,
  enemies: ENEMIES,
  items: ITEMS,
  skills: SKILLS,
  longevity: LONGEVITY_SKILL,
  origins: ORIGINS,
  ranks: RANKS,
  offices: OFFICE_TABLES,
  eraGear: ERA_GEAR,
  companions: { personas: COMPANION_PERSONAS, lines: COMPANION_LINES },
  endings: { nation: NATION_ENDINGS, personal: PERSONAL_ENDINGS, historyNote: ENDING_HISTORY_NOTE },
};

export { gradeName, officeTitle };
