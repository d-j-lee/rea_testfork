// Player settings: persisted per browser (through the client storage owner),
// applied to audio, motion and touch.
import type { AudioEngine } from "../audio/types.ts";
import { isRecord, readJson, writeKey } from "../storage.ts";

export interface Settings {
  music: number;
  sfx: number;
  muted: boolean;
  touch: "auto" | "on" | "off";
  motion: "auto" | "reduced" | "full";
}

const KEY = "settings";
const DEFAULTS: Settings = { music: 0.7, sfx: 0.8, muted: false, touch: "auto", motion: "auto" };

/** Stored settings, each field validated; anything unusable is the default. */
function load(): Settings {
  const v = readJson(KEY, isRecord);
  if (!v) return { ...DEFAULTS };
  const num = (x: unknown, d: number) => (typeof x === "number" && x >= 0 && x <= 1 ? x : d);
  return {
    music: num(v["music"], DEFAULTS.music),
    sfx: num(v["sfx"], DEFAULTS.sfx),
    muted: typeof v["muted"] === "boolean" ? v["muted"] : DEFAULTS.muted,
    touch: v["touch"] === "on" || v["touch"] === "off" ? v["touch"] : "auto",
    motion: v["motion"] === "reduced" || v["motion"] === "full" ? v["motion"] : "auto",
  };
}

export class SettingsStore {
  #value: Settings = load();
  readonly #listeners: ((s: Settings) => void)[] = [];
  readonly #audio: AudioEngine;
  readonly #coarse = window.matchMedia("(pointer: coarse)");
  readonly #reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(audio: AudioEngine) {
    this.#audio = audio;
    const reapply = () => this.#apply();
    this.#coarse.addEventListener?.("change", reapply);
    this.#reduce.addEventListener?.("change", reapply);
    this.#apply();
  }

  get value(): Readonly<Settings> {
    return this.#value;
  }

  get touchActive(): boolean {
    const t = this.#value.touch;
    return t === "on" || (t === "auto" && this.#coarse.matches);
  }

  get reducedMotion(): boolean {
    const m = this.#value.motion;
    return m === "reduced" || (m === "auto" && this.#reduce.matches);
  }

  update(patch: Partial<Settings>): void {
    this.#value = { ...this.#value, ...patch };
    writeKey(KEY, JSON.stringify(this.#value));
    this.#apply();
  }

  onChange(listener: (s: Settings) => void): void {
    this.#listeners.push(listener);
  }

  #apply(): void {
    const v = this.#value;
    this.#audio.setVolumes({ music: v.music, sfx: v.sfx });
    if (this.#audio.muted !== v.muted) this.#audio.setMuted(v.muted);
    const root = document.documentElement;
    root.dataset.motion = this.reducedMotion ? "reduced" : "full";
    root.dataset.touch = this.touchActive ? "on" : "off";
    for (const listener of this.#listeners) listener(v);
  }
}
