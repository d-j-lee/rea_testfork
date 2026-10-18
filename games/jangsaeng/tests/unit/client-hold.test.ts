// What the client decides on its own about time and urgency: the offline
// world's clock while the menu holds it, and how loudly the HUD speaks of a
// lifespan that falls short of 1910.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HELD_BEAT_MS, HostTime } from "../../src/client/net/host-time.ts";
import { LIFE_NEAR_YEARS, lifeWarning } from "../../src/client/ui/labels.ts";

test("host time follows the page while nothing holds the world", () => {
  const time = new HostTime(1000);
  assert.equal(time.advance(1050, false), 1050);
  assert.equal(time.advance(2050, false), 2050);
});

test("a held world stands still, and releasing it does not replay the held time", () => {
  const time = new HostTime(0);
  time.advance(100, false);
  assert.equal(time.advance(5000, true), 100);
  assert.equal(time.advance(60_000, true), 100);
  // Released: it runs on from where it stood, at the page's pace.
  assert.equal(time.advance(60_050, false), 150);
});

test("a message sent while held buys one short beat, so its answer still comes", () => {
  const time = new HostTime(0);
  time.advance(10, true);
  time.nudge();
  assert.equal(time.advance(110, true), 100);
  assert.equal(time.advance(10_000, true), HELD_BEAT_MS);
  assert.equal(time.advance(20_000, true), HELD_BEAT_MS);
  // The beat outlasts the host's 0.25 s self-view cadence.
  assert.ok(HELD_BEAT_MS > 250);
});

test("the page clock going backwards never moves host time back", () => {
  const time = new HostTime(500);
  time.advance(800, false);
  assert.equal(time.advance(700, false), 800);
  assert.equal(time.advance(900, false), 900);
});

test("a lifespan short of 1910 is a calm note while decades remain, red when it runs out", () => {
  // The opening: 500 years ahead, 49 short.
  assert.equal(lifeWarning({ year: 1361, lifeEnd: 1861, lifeShortfall: 49 }), "far");
  assert.equal(lifeWarning({ year: 1861 - LIFE_NEAR_YEARS - 1, lifeEnd: 1861, lifeShortfall: 49 }), "far");
  assert.equal(lifeWarning({ year: 1861 - LIFE_NEAR_YEARS, lifeEnd: 1861, lifeShortfall: 49 }), "near");
  assert.equal(lifeWarning({ year: 1855, lifeEnd: 1861, lifeShortfall: 49 }), "near");
  assert.equal(lifeWarning({ year: 1900, lifeEnd: 1915, lifeShortfall: 0 }), "ok");
});
