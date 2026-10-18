// The client's one owner of browser persistence (profiles, summaries,
// settings): namespaced key/value storage over localStorage that never
// throws. Sandboxed frames, private windows and full quotas make every
// storage access fallible; each failing key falls back to an in-memory copy
// so the session keeps working (it just will not survive a reload).

const PREFIX = "jangsaeng:v1:";

let storage: Storage | null | undefined;
const memory = new Map<string, string>();

function backend(): Storage | null {
  if (storage !== undefined) return storage;
  try {
    const candidate = globalThis.localStorage;
    const probe = `${PREFIX}probe`;
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    storage = candidate;
  } catch {
    storage = null;
  }
  return storage;
}

/** True when values survive a reload (localStorage is usable). */
export function storagePersistent(): boolean {
  return backend() !== null;
}

export function readKey(key: string): string | null {
  const full = PREFIX + key;
  const local = memory.get(full);
  if (local !== undefined) return local;
  try {
    return backend()?.getItem(full) ?? null;
  } catch {
    return null;
  }
}

/** Writes a value; returns false when it only lives in memory. */
export function writeKey(key: string, value: string): boolean {
  const full = PREFIX + key;
  const store = backend();
  if (store) {
    try {
      store.setItem(full, value);
      memory.delete(full);
      return true;
    } catch {
      // Quota or access error: keep the newest value in memory.
    }
  }
  memory.set(full, value);
  return false;
}

export function removeKey(key: string): void {
  const full = PREFIX + key;
  memory.delete(full);
  try {
    backend()?.removeItem(full);
  } catch {
    // Nothing to do: the key is unreachable either way.
  }
}

/** Guard for JSON objects (not arrays or null). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  const raw = readKey(key);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}
