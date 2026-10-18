// Builds client views from authoritative state. Views carry display-ready
// values only; clients never re-derive rules.
import type { ContentIndex } from "../content/index.ts";
import { CHAPTER_IDS, type ChapterDef, type NationMeter, type PromptDef } from "../content/schema.ts";
import {
  BRANCH_LABELS,
  apparentAge,
  bondName,
  derived,
  evalCond,
  expToNext,
  finalInfiltration,
  heroSprite,
  nationValue,
  purgeRiskShown,
  rankName,
  realAge,
  suspicionBand,
} from "../rules/index.ts";
import type { PlayerStatus, World } from "../sim/world.ts";
import {
  FINAL_YEAR,
  type BattleView,
  type ChapterView,
  type EndingView,
  type ObjectiveView,
  type PlayerSave,
  type PromptView,
  type SelfView,
} from "../types.ts";

export function chapterView(chapter: ChapterDef): ChapterView {
  return {
    id: chapter.id,
    order: chapter.order,
    title: chapter.title,
    subtitle: chapter.subtitle,
    years: chapter.years,
    briefing: [...chapter.briefing],
    history: [...chapter.history],
    music: chapter.music,
    season: chapter.season,
    weather: chapter.weather,
    hour: chapter.hour,
    montage: chapter.montage ?? false,
  };
}

export function promptView(
  content: ContentIndex,
  save: PlayerSave,
  prompt: PromptDef,
): PromptView {
  const options = [];
  for (const option of prompt.options) {
    const allowed = evalCond(content, save, option.requires);
    if (!allowed && !option.lockedText) continue;
    const view: PromptView["options"][number] = { id: option.id, text: option.text };
    if (option.hint) view.hint = option.hint;
    if (!allowed) view.disabled = option.lockedText ?? "조건이 맞지 않는다";
    if (option.risk) view.risk = purgeRiskShown(content, save, option.risk, option.effects);
    options.push(view);
  }
  const view: PromptView = {
    id: prompt.id,
    kind: prompt.style === "card" ? "card" : prompt.style === "history" ? "history" : "story",
    title: prompt.title,
    body: [...prompt.body],
    options,
    year: save.year,
  };
  if (prompt.speaker) {
    view.speaker = { name: prompt.speaker.name };
    if (prompt.speaker.sprite) view.speaker.sprite = prompt.speaker.sprite;
    const chapter = content.chapters[save.chapter];
    const npc = chapter.npcs.find((candidate) => candidate.name === prompt.speaker?.name);
    if (npc?.historical) view.speaker.historical = true;
  }
  return view;
}

export interface SelfContext {
  id: number;
  world: World;
  status: PlayerStatus | null;
  battle: BattleView | null;
  stepYear: number;
  channel: SelfView["channel"];
  worldEvent?: SelfView["worldEvent"];
  /** Objectives currently visible with their progress. */
  objectives: ObjectiveView[];
}

export function selfView(content: ContentIndex, save: PlayerSave, context: SelfContext): SelfView {
  const chapter = content.chapters[save.chapter];
  const stats = derived(content, save);
  const status = context.status;
  const { grade, office } = rankName(save.rank, save.year);
  const nation: Record<NationMeter, number> = { ...save.nation, infiltration: nationValue(save, "infiltration") };
  const ruling = chapter.ruling;
  const factions = chapter.factions.map((faction) => {
    const view: SelfView["factions"][number] = {
      id: faction.id,
      name: faction.name,
      power: faction.power,
      favor: Math.round(save.favor[faction.id] ?? 0),
      ruling: faction.id === ruling,
      aligned: save.aligned === faction.id,
    };
    if (faction.desc) view.desc = faction.desc;
    return view;
  });
  const skills = [...new Set([...save.skills])].flatMap((skillId) => {
    const skill = content.skills[skillId];
    if (!skill) return [];
    const slotIndex = save.skillSlots.indexOf(skillId);
    return [
      {
        id: skill.id,
        name: skill.name,
        desc: skill.desc,
        energy: skill.energy,
        cooldown: skill.cooldown,
        ready: slotIndex >= 0 ? (status?.cooldowns[slotIndex] ?? 0) : 0,
        slot: slotIndex >= 0 ? slotIndex + 1 : null,
        kind: skill.kind,
      },
    ];
  });
  skills.push({
    id: content.longevity.id,
    name: content.longevity.name,
    desc: content.longevity.desc,
    energy: 0,
    cooldown: content.longevity.cooldown,
    ready: status?.longevityReady ?? 0,
    slot: 5,
    kind: content.longevity.kind,
  });
  const inventory = Object.entries(save.inventory)
    .filter(([, count]) => count > 0)
    .flatMap(([itemId, count]) => {
      const item = content.items[itemId];
      return item
        ? [{
            id: item.id,
            name: item.name,
            kind: item.kind,
            desc: item.desc,
            count,
            equipped: save.equipment.weapon === item.id || save.equipment.armor === item.id,
          }]
        : [];
    });
  const view: SelfView = {
    id: context.id,
    name: save.name,
    birthName: save.birthName,
    identityKind: save.identity.kind,
    identities: save.identities.map((record) => ({ ...record })),
    variant: save.variant,
    origin: save.origin,
    sprite: heroSprite(save),
    level: save.level,
    exp: Math.floor(save.exp),
    expNext: expToNext(save.level),
    hp: Math.ceil(status?.hp ?? stats.maxHp),
    maxHp: Math.round(status?.maxHp ?? stats.maxHp),
    energy: Math.floor(status?.energy ?? stats.maxEnergy),
    maxEnergy: Math.round(status?.maxEnergy ?? stats.maxEnergy),
    stamina: Math.floor(status?.stamina ?? 100),
    stats: { ...save.stats },
    freePoints: save.freePoints,
    points: { ...save.points },
    year: context.stepYear,
    age: realAge(context.stepYear),
    apparentAge: Math.round(apparentAge(context.stepYear) * 10) / 10,
    lifeEnd: save.lifeEnd,
    lifeShortfall: Math.max(0, FINAL_YEAR - save.lifeEnd),
    longevityUses: save.longevityUses,
    suspicion: Math.round(save.suspicion),
    suspicionBand: suspicionBand(save.suspicion),
    rank: save.rank,
    rankName: grade,
    office,
    titles: [...save.titles],
    factions,
    nation,
    showInfiltration: CHAPTER_IDS.indexOf(save.chapter) >= CHAPTER_IDS.indexOf("ch14"),
    branches: { ...save.branches },
    chapter: { id: chapter.id, title: chapter.title, order: chapter.order, stepYear: context.stepYear },
    objectives: context.objectives,
    skills,
    inventory,
    equipment: { ...save.equipment },
    chronicle: save.chronicle.slice(-40),
    bonds: Object.entries(save.bonds)
      .filter(([, value]) => value > 0)
      .map(([bondId, value]) => ({
        id: bondId,
        name: bondName(content, bondId),
        value: Math.round(value),
      })),
    channel: context.channel,
    demo: save.demo,
  };
  if (save.meritSubject) view.meritSubject = save.meritSubject;
  if (status?.downed !== null && status?.downed !== undefined)
    view.downed = { secondsLeft: Math.max(0, Math.ceil(status.downed)) };
  if (context.battle) view.battle = context.battle;
  if (context.worldEvent) view.worldEvent = context.worldEvent;
  return view;
}

/**
 * The settled 1910 numbers, read from the save the ending was computed on
 * (the session accepts no changes after save.ending): the score as decided
 * with the rows it is the sum of (all at 0.1, so they agree as shown), the
 * final infiltration that the breakdown charged, and every branch that was
 * not won shown as failed — the same reading rules/nation.ts settles with.
 */
export function endingView(content: ContentIndex, save: PlayerSave): EndingView | null {
  const ending = save.ending;
  if (!ending) return null;
  const nation = content.endings.nation[ending.nation];
  const personal = content.endings.personal[ending.personal];
  return {
    nation: { id: nation.id, title: nation.title, body: [...nation.body] },
    personal: { id: personal.id, title: personal.title, body: [...personal.body] },
    score: ending.score,
    breakdown: ending.breakdown.map((entry) => ({ ...entry })),
    nationValues: { ...save.nation, infiltration: finalInfiltration(save) },
    branches: (Object.keys(BRANCH_LABELS) as (keyof typeof BRANCH_LABELS)[]).map((branch) => ({
      id: branch,
      label: BRANCH_LABELS[branch],
      ok: save.branches[branch] === true,
    })),
    identities: save.identities.map((record) => ({ ...record })),
    lifeline: {
      lifeEnd: save.lifeEnd,
      gained: save.record.lifeGained,
      spent: save.record.lifeSpent,
    },
    chronicle: [...save.chronicle],
    record: { ...save.record },
    historyNote: [...content.endings.historyNote],
  };
}
