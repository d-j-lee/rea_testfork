// Every NPC, battle arena and travel target a chapter uses must be reachable on
// foot on the generated map of that era — from the chapter start or from a
// place the story moves the player to (goto). Positions are resolved the way
// the world resolves them (nearest walkable tile outside tiny pockets).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS } from "../../src/shared/content/index.ts";
import { CHAPTER_IDS, type ChapterDef, type Effect, type Offset } from "../../src/shared/content/schema.ts";
import { collisionFor, generateMap } from "../../src/shared/map/generate.ts";
import { components, nearestFree, type CollisionGrid } from "../../src/shared/sim/physics.ts";
import { MIN_REGION } from "../../src/shared/sim/entities.ts";

const map = generateMap("jangsaeng");
const siteById = new Map(map.sites.map((site) => [site.id, site]));

function* effectsOf(chapter: ChapterDef): Generator<Effect> {
  const walk = function* (list: readonly Effect[] | undefined): Generator<Effect> {
    for (const effect of list ?? []) {
      yield effect;
      if (effect.k === "check") {
        yield* walk(effect.success);
        yield* walk(effect.failure);
      }
      if (effect.k === "if") {
        yield* walk(effect.then);
        yield* walk(effect.else);
      }
    }
  };
  for (const prompt of chapter.prompts) for (const option of prompt.options) yield* walk(option.effects);
  for (const step of chapter.steps) {
    yield* walk(step.onEnter);
    for (const objective of step.objectives) yield* walk(objective.onComplete);
  }
  for (const battle of chapter.battles) {
    yield* walk(battle.victory);
    yield* walk(battle.defeat);
  }
}

function resolve(grid: CollisionGrid, siteId: string, offset?: Offset) {
  const site = siteById.get(siteId);
  if (!site) return null;
  return nearestFree(grid, site.x + 0.5 + (offset?.[0] ?? 0), site.y + 0.5 + (offset?.[1] ?? 0), 12, MIN_REGION);
}

for (const id of CHAPTER_IDS) {
  test(`${id}: story places are reachable on foot`, () => {
    const chapter = CHAPTERS[id];
    const year = chapter.steps[0]?.year ?? chapter.years[0];
    const grid: CollisionGrid = { width: map.width, height: map.height, tiles: map.tiles, blocked: collisionFor(map, year) };
    const { labels } = components(grid);
    const label = (point: { x: number; y: number } | null) =>
      point ? (labels[Math.floor(point.y) * map.width + Math.floor(point.x)] ?? -1) : -1;
    // Regions the player can stand in: the chapter start plus story jumps.
    const reachable = new Set<number>([label(resolve(grid, chapter.start.site, chapter.start.offset))]);
    for (const effect of effectsOf(chapter))
      if (effect.k === "goto" || effect.k === "exile") reachable.add(label(resolve(grid, effect.site, effect.k === "goto" ? effect.offset : undefined)));
    const problems: string[] = [];
    const check = (what: string, siteId: string, offset?: Offset) => {
      const point = resolve(grid, siteId, offset);
      if (!point) problems.push(`${what}: no walkable tile near ${siteId}`);
      else if (!reachable.has(label(point))) problems.push(`${what}: unreachable at ${siteId} ${JSON.stringify(offset ?? [0, 0])}`);
    };
    for (const npc of chapter.npcs) check(`npc ${npc.id}`, npc.site, npc.offset);
    for (const battle of chapter.battles) check(`battle ${battle.id}`, battle.site, battle.offset);
    for (const step of chapter.steps)
      for (const objective of step.objectives)
        if (objective.kind === "reach" && objective.target) check(`reach ${objective.id}`, objective.target, objective.offset);
    assert.deepEqual(problems, []);
  });
}
