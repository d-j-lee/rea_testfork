// Parses untrusted client messages at the host boundary. Anything malformed
// becomes null; numbers are clamped; strings are bounded.
import {
  CHAPTER_IDS,
  STAT_KEYS,
  type ChapterId,
  type OriginId,
  type StatKey,
  type WashMethod,
} from "../content/schema.ts";
import type { ClientMsg, PlayerAction } from "../protocol.ts";
import { DEMO_PATHS } from "../types.ts";

const ORIGIN_IDS: readonly OriginId[] = ["northeast", "kaesong", "southcoast"];
const WASH_METHODS: readonly WashMethod[] = ["descendant", "fakeDeath", "monk", "merchant", "exam"];
const TOKEN = /^[0-9a-f]{32}$/;
const ID = /^[A-Za-z0-9_:.-]{1,64}$/;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown, min: number, max: number, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
const bool = (value: unknown): boolean => value === true;
const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value : null;
const id = (value: unknown): string | null =>
  typeof value === "string" && ID.test(value) ? value : null;

/** Keeps Hangul, Latin letters, digits and single spaces; 2–12 characters. */
export function sanitizeName(raw: string): string | null {
  const cleaned = raw
    .normalize("NFC")
    .replace(/[^\p{Script=Hangul}A-Za-z0-9 ·]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const length = [...cleaned].length;
  return length >= 2 && length <= 12 ? cleaned : null;
}

/** Chat text: strips control characters, collapses whitespace, ≤ 120 chars. */
export function sanitizeChat(raw: string): string | null {
  const cleaned = raw
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, 120).join("");
}

function parseAction(raw: unknown): PlayerAction | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case "allocate":
      return (STAT_KEYS as readonly string[]).includes(String(raw.stat))
        ? { kind: "allocate", stat: raw.stat as StatKey }
        : null;
    case "equip":
    case "use": {
      const item = id(raw.item);
      return item ? { kind: raw.kind, item } : null;
    }
    case "slot": {
      const skill = id(raw.skill);
      const slot = num(raw.slot, 1, 4, 0);
      return skill && Number.isInteger(slot) && slot >= 1 ? { kind: "slot", skill, slot } : null;
    }
    case "travel": {
      const site = id(raw.site);
      return site ? { kind: "travel", site } : null;
    }
    case "selfRevive":
    case "demoSkip":
      return { kind: raw.kind };
    case "emote": {
      const emote = id(raw.emote);
      return emote ? { kind: "emote", emote } : null;
    }
    default:
      return null;
  }
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case "hello": {
      const name = str(raw.name, 48);
      const variant = raw.variant === "f" ? "f" : raw.variant === "m" ? "m" : null;
      const origin = ORIGIN_IDS.find((candidate) => candidate === raw.origin);
      if (name === null || !variant || !origin) return null;
      const message: ClientMsg = { t: "hello", v: num(raw.v, 0, 1e6), name, variant, origin };
      if (typeof raw.token === "string" && TOKEN.test(raw.token)) message.token = raw.token;
      if ((CHAPTER_IDS as readonly string[]).includes(String(raw.demo)))
        message.demo = raw.demo as ChapterId;
      const demoPath = DEMO_PATHS.find((candidate) => candidate === raw.demoPath);
      if (message.demo && demoPath) message.demoPath = demoPath;
      return message;
    }
    case "input": {
      const message: ClientMsg = {
        t: "input",
        seq: Math.trunc(num(raw.seq, 0, Number.MAX_SAFE_INTEGER)),
        mx: num(raw.mx, -1, 1),
        my: num(raw.my, -1, 1),
        attack: bool(raw.attack),
        shoot: bool(raw.shoot),
        dodge: bool(raw.dodge),
        skill: Math.trunc(num(raw.skill, 0, 5)),
        interact: bool(raw.interact),
      };
      if (typeof raw.ax === "number" && typeof raw.ay === "number") {
        message.ax = num(raw.ax, -40, 40);
        message.ay = num(raw.ay, -40, 40);
      }
      return message;
    }
    case "choose": {
      const prompt = id(raw.prompt);
      const option = id(raw.option);
      return prompt && option ? { t: "choose", prompt, option } : null;
    }
    case "years": {
      const prompt = id(raw.prompt);
      if (!prompt || !Array.isArray(raw.activities) || raw.activities.length > 60) return null;
      const activities: string[] = [];
      for (const activity of raw.activities) {
        const parsed = id(activity);
        if (!parsed) return null;
        activities.push(parsed);
      }
      const message: ClientMsg = { t: "years", prompt, activities, offer: bool(raw.offer) };
      const wash = WASH_METHODS.find((method) => method === raw.wash);
      if (wash) message.wash = wash;
      const name = str(raw.name, 48);
      if (name) message.name = name;
      return message;
    }
    case "chat": {
      const text = str(raw.text, 400);
      return text === null ? null : { t: "chat", text };
    }
    case "action": {
      const action = parseAction(raw.action);
      return action ? { t: "action", action } : null;
    }
    case "ping":
      return { t: "ping", at: num(raw.at, 0, Number.MAX_SAFE_INTEGER) };
    default:
      return null;
  }
}
