// The client storage owner carries a pre-namespace key over once: the old key
// is removed only when the caller says its value is safely kept (stored
// under the new key, or worthless), so a failed write never loses it. The
// settings consumer is checked in a browser by tools/preview/ui-check.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

/** localStorage with a switchable quota error on namespaced writes. */
class FakeStorage {
  readonly data = new Map<string, string>();
  full = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full && key === "jangsaeng:v1:kept") throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const fake = new FakeStorage();
Object.assign(globalThis, { localStorage: fake });
// storage.ts resolves its backend on first use, after the fake is in place.
const { carryLegacyKey, readKey, writeKey } = await import("../../src/client/storage.ts");

test("the old key stays until the value is stored under the new one", () => {
  fake.data.set("old.kept", "v");
  const carry = (value: string) => writeKey("kept", value);
  fake.full = true;
  carryLegacyKey("old.kept", carry);
  assert.equal(readKey("kept"), "v", "usable this session (memory)");
  assert.equal(fake.data.get("old.kept"), "v", "a failed write keeps the old key");
  fake.full = false;
  carryLegacyKey("old.kept", carry);
  assert.equal(fake.data.get("jangsaeng:v1:kept"), "v");
  assert.equal(fake.data.has("old.kept"), false, "removed once the new key is stored");
});

test("carry is not called without an old value; true alone removes the old key", () => {
  let calls = 0;
  carryLegacyKey("old.none", () => ++calls > 0);
  assert.equal(calls, 0);
  fake.data.set("old.junk", "{not json");
  carryLegacyKey("old.junk", (value) => value.startsWith("{not"));
  assert.equal(fake.data.has("old.junk"), false, "worthless: nothing to keep");
});
