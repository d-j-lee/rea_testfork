// Validates untrusted stored JSON into a PlayerSave. Core identity fields
// must be valid (else null); every other field is type-checked, clamped to
// its range and defaulted when missing or malformed. Never throws.
import type { ContentIndex } from "../content/index.ts";
import type { BranchId, ChapterDef, ChapterId, FlagValue, IdentityKind, NationKey, StatKey } from "../content/schema.ts";
import { BRANCH_IDS, CHAPTER_IDS, NATION_KEYS, POINT_KEYS, STAT_KEYS } from "../content/schema.ts";
import type { ChronicleEntry, EndingResult, IdentityRecord, PendingStory, PlayerSave } from "../types.ts";
import { SAVE_VERSION } from "../types.ts";
import { ensureEquipment, LEVEL_CAP, RANK_CAP, SKILL_SLOTS, STAT_CAP } from "./progression.ts";
import { createSave } from "./save.ts";
import { round1 } from "./util.ts";

type Raw = Record<string, unknown>;

const IDENTITY_KINDS: readonly IdentityKind[] = [
  "birth", "descendant", "fakeDeath", "monk", "merchant", "exam", "forced", "successor",
];
const TONES = ["info", "good", "bad", "epic"] as const;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_KEYS = 512;
const MAX_LIST = 2048;
const MAX_CHRONICLE = 1000;
const BIG = 1_000_000_000;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min: number, max: number, integer = true): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(max, Math.max(min, value));
  return integer ? Math.round(bounded) : bounded;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeEntries(value: unknown): [string, unknown][] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([key]) => !UNSAFE_KEYS.has(key) && key.length > 0 && key.length <= 96)
    .slice(0, MAX_KEYS);
}

function numberRecord(value: unknown, min: number, max: number, integer = true): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, entry] of safeEntries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) out[key] = num(entry, 0, min, max, integer);
  }
  return out;
}

function stringList(value: unknown, maxLength: number, keep?: (entry: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value.slice(0, MAX_LIST)) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > maxLength) continue;
    if (keep && !keep(entry)) continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

function isIdentityKind(value: unknown): value is IdentityKind {
  return typeof value === "string" && (IDENTITY_KINDS as readonly string[]).includes(value);
}

function parseIdentityRecord(value: unknown): IdentityRecord | undefined {
  if (!isRecord(value)) return undefined;
  const name = text(value.name, 32);
  if (!name || !isIdentityKind(value.kind) || typeof value.from !== "number" || !Number.isFinite(value.from)) return undefined;
  const record: IdentityRecord = { name, kind: value.kind, from: Math.round(value.from) };
  if (typeof value.to === "number" && Number.isFinite(value.to)) record.to = Math.round(value.to);
  return record;
}

function parseChronicle(value: unknown): ChronicleEntry | undefined {
  if (!isRecord(value)) return undefined;
  const body = text(value.text, 400);
  if (!body || typeof value.year !== "number" || !Number.isFinite(value.year)) return undefined;
  const entry: ChronicleEntry = { year: Math.round(value.year), text: body };
  if (typeof value.tone === "string" && (TONES as readonly string[]).includes(value.tone)) entry.tone = value.tone as ChronicleEntry["tone"];
  if (value.alt === true) entry.alt = true;
  return entry;
}

function parseEnding(value: unknown): EndingResult | undefined {
  if (!isRecord(value)) return undefined;
  const nation = value.nation;
  const personal = value.personal;
  if (nation !== "N1" && nation !== "N2" && nation !== "N3") return undefined;
  if (typeof personal !== "string" || !["P0", "P1", "P2", "P3", "P4", "P5"].includes(personal)) return undefined;
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) return undefined;
  const breakdown: EndingResult["breakdown"] = [];
  if (Array.isArray(value.breakdown)) {
    for (const entry of value.breakdown.slice(0, 64)) {
      if (isRecord(entry) && typeof entry.label === "string" && typeof entry.value === "number" && Number.isFinite(entry.value)) {
        breakdown.push({ label: entry.label.slice(0, 80), value: entry.value });
      }
    }
  }
  return { nation, personal: personal as EndingResult["personal"], score: value.score, breakdown };
}

const PENDING_KINDS: readonly PendingStory["kind"][] = ["prompt", "escape", "battle"];
const MAX_PENDING = 64;

/**
 * The story the session still owes, in order: each entry must name a card or
 * battle of the save's chapter (an escape names `<chapter>:<year>` of that
 * chapter); unknown or repeated entries are dropped.
 */
function parsePending(value: unknown, chapter: ChapterDef): PendingStory[] {
  if (!Array.isArray(value)) return [];
  const out: PendingStory[] = [];
  for (const entry of value.slice(0, MAX_PENDING)) {
    if (!isRecord(entry) || typeof entry.kind !== "string" || !(PENDING_KINDS as readonly string[]).includes(entry.kind)) continue;
    const kind = entry.kind as PendingStory["kind"];
    const id = text(entry.id, 96);
    if (!id || out.some((known) => known.kind === kind && known.id === id)) continue;
    const known =
      kind === "prompt" ? chapter.prompts.some((prompt) => prompt.id === id)
        : kind === "battle" ? chapter.battles.some((battle) => battle.id === id)
          : new RegExp(`^${chapter.id}:\\d{1,4}$`).test(id);
    if (known) out.push({ kind, id });
  }
  return out;
}

function parseFlags(value: unknown): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  for (const [key, entry] of safeEntries(value)) {
    if (typeof entry === "boolean") out[key] = entry;
    else if (typeof entry === "number" && Number.isFinite(entry)) out[key] = entry;
    else if (typeof entry === "string" && entry.length <= 200) out[key] = entry;
  }
  return out;
}

function parse(content: ContentIndex, raw: unknown): PlayerSave | null {
  if (!isRecord(raw) || raw.version !== SAVE_VERSION) return null;
  const token = text(raw.token, 128);
  const name = text(raw.name, 32);
  const seed = raw.seed;
  const origin = raw.origin;
  const chapter = raw.chapter;
  if (!token || !name || typeof seed !== "number" || !Number.isFinite(seed)) return null;
  if (typeof origin !== "string" || !content.origins[origin]) return null;
  if (typeof chapter !== "string" || !(CHAPTER_IDS as readonly string[]).includes(chapter)) return null;
  const chapterDef = content.chapters[chapter as ChapterId];
  if (!chapterDef) return null;

  const variant = raw.variant === "f" ? "f" : "m";
  const base = createSave(content, { token, name, variant, origin: origin as PlayerSave["origin"], seed });
  const save: PlayerSave = base;
  save.name = name;
  save.birthName = text(raw.birthName, 32) ?? name;
  save.demo = bool(raw.demo, false);
  save.chapter = chapter as ChapterId;

  const identity = isRecord(raw.identity) ? raw.identity : {};
  if (isIdentityKind(identity.kind)) {
    save.identity = {
      kind: identity.kind,
      startYear: num(identity.startYear, base.identity.startYear, 1300, 3000),
      startAge: num(identity.startAge, base.identity.startAge, 0, 1000, false),
    };
  }
  const identities = Array.isArray(raw.identities)
    ? raw.identities.slice(0, 128).map(parseIdentityRecord).filter((entry): entry is IdentityRecord => entry !== undefined)
    : [];
  if (identities.length > 0) save.identities = identities;
  else save.identities = [{ name: save.birthName, kind: "birth", from: base.identity.startYear }];

  save.level = num(raw.level, 1, 1, LEVEL_CAP);
  save.exp = num(raw.exp, 0, 0, BIG);
  const stats = isRecord(raw.stats) ? raw.stats : {};
  for (const stat of STAT_KEYS) save.stats[stat as StatKey] = num(stats[stat], base.stats[stat], 1, STAT_CAP);
  save.freePoints = num(raw.freePoints, 0, 0, 999);
  const points = isRecord(raw.points) ? raw.points : {};
  for (const point of POINT_KEYS) {
    save.points[point] = num(points[point], base.points[point], point === "honor" ? -BIG : 0, BIG);
  }
  save.lifeEnd = num(raw.lifeEnd, base.lifeEnd, 1361, 3000);
  save.graceUsed = bool(raw.graceUsed, false);
  save.longevityUses = num(raw.longevityUses, 0, 0, 3);
  save.offeredThisChapter = num(raw.offeredThisChapter, 0, 0, 5);
  save.suspicion = round1(num(raw.suspicion, 0, 0, 100, false));
  save.rank = num(raw.rank, 0, 0, RANK_CAP);
  if (raw.meritSubject === 1 || raw.meritSubject === 2 || raw.meritSubject === 3 || raw.meritSubject === 4) {
    save.meritSubject = raw.meritSubject;
  }
  save.titles = stringList(raw.titles, 40).slice(0, 64);
  if (raw.favor !== undefined) save.favor = numberRecord(raw.favor, -100, 100);
  save.aligned = text(raw.aligned, 64) ?? null;

  const nation = isRecord(raw.nation) ? raw.nation : {};
  for (const key of NATION_KEYS) save.nation[key] = num(nation[key], chapterDef.hist[key], 0, 100);
  save.infiltration = num(raw.infiltration, 0, 0, 100);
  save.longFlags = {};
  for (const [flag, entry] of safeEntries(raw.longFlags)) {
    if (!isRecord(entry) || typeof entry.key !== "string" || !(NATION_KEYS as readonly string[]).includes(entry.key)) continue;
    if (typeof entry.add !== "number" || !Number.isFinite(entry.add)) continue;
    save.longFlags[flag] = { key: entry.key as NationKey, add: num(entry.add, 0, -50, 50) };
  }
  save.branches = {};
  const branches = isRecord(raw.branches) ? raw.branches : {};
  for (const id of BRANCH_IDS) {
    const value = branches[id];
    if (typeof value === "boolean") save.branches[id as BranchId] = value;
  }
  save.flags = parseFlags(raw.flags);
  save.bonds = numberRecord(raw.bonds, 0, 100);

  if (raw.inventory !== undefined) {
    save.inventory = {};
    for (const [id, count] of Object.entries(numberRecord(raw.inventory, 0, 9999))) {
      if (content.items[id] && count > 0) save.inventory[id] = count;
    }
  }
  const equipment = isRecord(raw.equipment) ? raw.equipment : {};
  for (const slot of ["weapon", "armor"] as const) {
    const id = equipment[slot];
    if (typeof id === "string" && content.items[id]?.kind === slot) {
      save.equipment[slot] = id;
      if ((save.inventory[id] ?? 0) <= 0) save.inventory[id] = 1;
    }
  }
  ensureEquipment(content, save);
  if (raw.skills !== undefined) save.skills = stringList(raw.skills, 64, (id) => content.skills[id] !== undefined).slice(0, 32);
  if (raw.skillSlots !== undefined) save.skillSlots = stringList(raw.skillSlots, 64, (id) => save.skills.includes(id)).slice(0, SKILL_SLOTS);
  else save.skillSlots = save.skillSlots.filter((id) => save.skills.includes(id));

  save.step = num(raw.step, 0, 0, chapterDef.steps.length);
  save.year = num(raw.year, chapterDef.years[0], 1361, 3000);
  save.objectives = numberRecord(raw.objectives, 0, BIG);
  save.pending = parsePending(raw.pending, chapterDef);
  const demoEntry = text(raw.demoEntry, 64);
  if (save.demo && demoEntry && chapterDef.steps.some((step, index) => index > 0 && step.id === demoEntry)) save.demoEntry = demoEntry;
  save.promptsDone = stringList(raw.promptsDone, 96);
  save.battlesWon = stringList(raw.battlesWon, 96);
  const exile = text(raw.exile, 64);
  if (exile) save.exile = exile;
  if (isRecord(raw.position) && typeof raw.position.x === "number" && typeof raw.position.y === "number"
    && Number.isFinite(raw.position.x) && Number.isFinite(raw.position.y)) {
    save.position = { x: raw.position.x, y: raw.position.y };
  }
  if (Array.isArray(raw.chronicle)) {
    save.chronicle = raw.chronicle.slice(-MAX_CHRONICLE).map(parseChronicle).filter((entry): entry is ChronicleEntry => entry !== undefined);
  }
  const record = isRecord(raw.record) ? raw.record : {};
  for (const key of Object.keys(save.record) as (keyof PlayerSave["record"])[]) {
    save.record[key] = num(record[key], 0, 0, BIG);
  }
  if (isRecord(raw.successor) && typeof raw.successor.generation === "number" && Number.isFinite(raw.successor.generation)) {
    save.successor = { generation: num(raw.successor.generation, 1, 1, 99) };
  }
  const ending = parseEnding(raw.ending);
  if (ending) save.ending = ending;
  return save;
}

/** Validates and upgrades untrusted stored JSON; null when unusable. */
export function migrateSave(content: ContentIndex, raw: unknown): PlayerSave | null {
  try {
    return parse(content, raw);
  } catch {
    return null;
  }
}
