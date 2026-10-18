// JSON-file profile store. Profiles are loaded into memory at start; saves
// update memory synchronously and are written to disk shortly after, each via
// a temporary file and rename so a crash never leaves a truncated profile.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ProfileStore } from "../shared/host/api.ts";
import type { PlayerSave } from "../shared/types.ts";

const TOKEN = /^[0-9a-f]{32}$/;

export class JsonProfileStore implements ProfileStore {
  readonly #dir: string;
  readonly #profiles = new Map<string, PlayerSave>();
  readonly #dirty = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  readonly #log: (line: string) => void;

  constructor(dataDir: string, log: (line: string) => void = console.log) {
    this.#log = log;
    this.#dir = join(dataDir, "profiles");
    mkdirSync(this.#dir, { recursive: true });
    for (const file of readdirSync(this.#dir)) {
      const token = file.replace(/\.json$/, "");
      if (!TOKEN.test(token)) continue;
      try {
        this.#profiles.set(
          token,
          JSON.parse(readFileSync(join(this.#dir, file), "utf8")),
        );
      } catch (error) {
        this.#log(`profile ${file} unreadable, skipped: ${String(error)}`);
      }
    }
    this.#log(`loaded ${this.#profiles.size} profiles from ${this.#dir}`);
  }

  load(token: string): PlayerSave | null {
    return TOKEN.test(token) ? (this.#profiles.get(token) ?? null) : null;
  }

  save(token: string, save: PlayerSave): void {
    if (!TOKEN.test(token)) throw new Error("invalid profile token");
    this.#profiles.set(token, save);
    this.#dirty.add(token);
    this.#timer ??= setTimeout(() => this.flush(), 1000);
  }

  isNameTaken(name: string, exceptToken: string): boolean {
    const wanted = name.toLowerCase();
    for (const [token, profile] of this.#profiles)
      if (token !== exceptToken && profile.name.toLowerCase() === wanted)
        return true;
    return false;
  }

  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const token of this.#dirty) {
      const profile = this.#profiles.get(token);
      if (!profile) continue;
      const target = join(this.#dir, `${token}.json`);
      const temporary = `${target}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(profile));
        renameSync(temporary, target);
      } catch (error) {
        this.#log(`failed to save profile ${token}: ${String(error)}`);
        continue;
      }
      this.#dirty.delete(token);
    }
  }
}
