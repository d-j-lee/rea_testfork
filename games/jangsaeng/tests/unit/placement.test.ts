// Every NPC, battle arena and travel target a chapter uses must be reachable on
// foot on the generated map of that era — from the chapter start or from a
// place the story moves the player to (goto). NPC and travel positions are
// resolved the way the world resolves them (nearest walkable tile outside tiny
// pockets); battle arenas by the battle resolver itself at the battle's year
// (deck battles on decks), and starting the battle from any side puts the
// hero and the boss on the arena's ground.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAPTERS, CONTENT } from "../../src/shared/content/index.ts";
import { CHAPTER_IDS, type ChapterDef, type Effect, type Offset, type StepDef } from "../../src/shared/content/schema.ts";
import { collisionFor, generateMap } from "../../src/shared/map/generate.ts";
import { DECK_MIN, DECK_SHARE, arenaFits, battleArena, onArena, onDeck, type Arena } from "../../src/shared/sim/arena.ts";
import { components, nearestFree, type CollisionGrid } from "../../src/shared/sim/physics.ts";
import { MIN_REGION } from "../../src/shared/sim/entities.ts";
import { World, type PlayerSpec, type WorldHooks } from "../../src/shared/sim/world.ts";

const map = generateMap("jangsaeng");
const siteById = new Map(map.sites.map((site) => [site.id, site]));

function* walk(list: readonly Effect[] | undefined): Generator<Effect> {
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
}

function* effectsOf(chapter: ChapterDef): Generator<Effect> {
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

/** The step a battle is fought in: its objective, or the step whose prompts or effects start it. */
function battleStep(chapter: ChapterDef, battleId: string): StepDef {
  const starts = (effects: readonly Effect[] | undefined, seen: Set<string>): boolean =>
    [...walk(effects)].some((effect) =>
      (effect.k === "battle" && effect.battle === battleId) || (effect.k === "prompt" && opens(effect.prompt, seen)));
  const opens = (promptId: string, seen: Set<string>): boolean => {
    if (seen.has(promptId)) return false;
    seen.add(promptId);
    const prompt = chapter.prompts.find((candidate) => candidate.id === promptId);
    return prompt?.options.some((option) => starts(option.effects, seen)) ?? false;
  };
  for (const step of chapter.steps) {
    if (starts(step.onEnter, new Set())) return step;
    for (const objective of step.objectives) {
      if (objective.kind === "battle" && objective.target === battleId) return step;
      if (starts(objective.onComplete, new Set())) return step;
      const prompt = objective.prompt ?? (objective.kind === "prompt" ? objective.target : undefined);
      if (prompt && opens(prompt, new Set())) return step;
    }
  }
  const first = chapter.steps[0];
  assert.ok(first, `${chapter.id} has steps`);
  return first;
}

const grids = new Map<number, CollisionGrid>();
function gridAt(year: number): CollisionGrid {
  let grid = grids.get(year);
  if (!grid) {
    grid = { width: map.width, height: map.height, tiles: map.tiles, blocked: collisionFor(map, year) };
    grids.set(year, grid);
  }
  return grid;
}

function resolve(grid: CollisionGrid, siteId: string, offset?: Offset) {
  const site = siteById.get(siteId);
  if (!site) return null;
  return nearestFree(grid, site.x + 0.5 + (offset?.[0] ?? 0), site.y + 0.5 + (offset?.[1] ?? 0), 12, MIN_REGION);
}

/** Walkable regions the player can stand in during a year: the chapter start plus story jumps. */
function regionsAt(chapter: ChapterDef, year: number) {
  const grid = gridAt(year);
  const { labels } = components(grid);
  const label = (point: { x: number; y: number } | null) =>
    point ? (labels[Math.floor(point.y) * map.width + Math.floor(point.x)] ?? -1) : -1;
  const reachable = new Set<number>([label(resolve(grid, chapter.start.site, chapter.start.offset))]);
  for (const effect of effectsOf(chapter))
    if (effect.k === "goto" || effect.k === "exile") reachable.add(label(resolve(grid, effect.site, effect.k === "goto" ? effect.offset : undefined)));
  return { grid, label, reachable };
}

for (const id of CHAPTER_IDS) {
  test(`${id}: story places are reachable on foot`, () => {
    const chapter = CHAPTERS[id];
    const opening = regionsAt(chapter, chapter.steps[0]?.year ?? chapter.years[0]);
    const problems: string[] = [];
    const check = (what: string, siteId: string, offset?: Offset) => {
      const point = resolve(opening.grid, siteId, offset);
      if (!point) problems.push(`${what}: no walkable tile near ${siteId}`);
      else if (!opening.reachable.has(opening.label(point))) problems.push(`${what}: unreachable at ${siteId} ${JSON.stringify(offset ?? [0, 0])}`);
    };
    for (const npc of chapter.npcs) check(`npc ${npc.id}`, npc.site, npc.offset);
    for (const step of chapter.steps)
      for (const objective of step.objectives)
        if (objective.kind === "reach" && objective.target) check(`reach ${objective.id}`, objective.target, objective.offset);
    for (const battle of chapter.battles) {
      const at = regionsAt(chapter, battleStep(chapter, battle.id).year);
      const site = siteById.get(battle.site);
      const arena = site ? battleArena(at.grid, site, battle) : null;
      if (!arena) problems.push(`battle ${battle.id}: no walkable ground near ${battle.site}`);
      else if (battle.kind === "deck") {
        // Deck battles are fought on a fleet's decks, not on the beach: centred
        // on a deck, with at least DECK_SHARE of the ground deck.
        const share = arena.deck.size / arena.tiles.size;
        const shown = `${arena.deck.size} deck of ${arena.tiles.size} tiles`;
        if (!arena.naval || !onDeck(arena, arena.x, arena.y)) problems.push(`battle ${battle.id}: not centred on a deck (${shown})`);
        if (arena.deck.size < DECK_MIN) problems.push(`battle ${battle.id}: ${shown}`);
        if (share < DECK_SHARE || !arenaFits(arena)) problems.push(`battle ${battle.id}: deck share ${share.toFixed(2)} (${shown})`);
      } else if (!arenaFits(arena)) problems.push(`battle ${battle.id}: broken ground, main ${arena.tiles.size} of ${arena.walkable} walkable tiles`);
      if (arena && !at.reachable.has(at.label(arena))) problems.push(`battle ${battle.id}: arena unreachable at ${battle.site} ${JSON.stringify(battle.offset ?? [0, 0])}`);
    }
    assert.deepEqual(problems, []);
  });
}

const QUIET: WorldHooks = {
  onKill: () => {},
  onBattleEnd: () => {},
  fights: () => true,
  onTalk: () => {},
  onPickup: () => {},
  onDowned: () => {},
  onRevived: () => {},
  onLongevity: () => {},
  npcMarker: () => undefined,
};

const HERO = 9_000_001;
function hero(x: number, y: number): PlayerSpec {
  return {
    id: HERO, kind: "player", name: "시험", title: "", sprite: "hero_youth", variant: "m", level: 30, skills: [], x, y,
    derived: { maxHp: 5000, maxEnergy: 100, energyRegen: 3, moveSpeed: 4, critChance: 0.05, melee: 1, bow: 1, skill: 1, weaponAtk: 30, armorDef: 10, downSeconds: 12 },
  };
}

/** Where a hero may stand when a battle starts: every side of the ring and beside the step's story NPCs. */
function entries(world: World, chapter: ChapterDef, step: StepDef, arena: Arena): [string, { x: number; y: number }][] {
  const out: [string, { x: number; y: number }][] = [];
  for (const [side, angle] of [["north", -Math.PI / 2], ["east", 0], ["south", Math.PI / 2], ["west", Math.PI]] as const)
    out.push([side, { x: arena.x + Math.cos(angle) * (arena.radius + 3), y: arena.y + Math.sin(angle) * (arena.radius + 3) }]);
  const index = chapter.steps.indexOf(step);
  for (const near of chapter.steps.slice(Math.max(0, index - 1), index + 1))
    for (const objective of near.objectives) {
      const npc = objective.kind === "talk" && objective.target ? world.npcPosition(objective.target) : null;
      if (npc) out.push([`beside ${objective.target}`, npc]);
    }
  return out;
}

for (const id of CHAPTER_IDS) {
  test(`${id}: battles start with the hero and the boss on the arena`, () => {
    const chapter = CHAPTERS[id];
    const problems: string[] = [];
    for (const battle of chapter.battles) {
      const step = battleStep(chapter, battle.id);
      const site = siteById.get(battle.site);
      const arena = site ? battleArena(gridAt(step.year), site, battle) : null;
      if (!arena) continue;
      const world = new World({ content: CONTENT, chapter, map, year: step.year, seed: "placement", hooks: QUIET });
      world.setStep(step.id);
      world.tick(0.05); // the step's ambient spawns appear
      for (const [where, at] of entries(world, chapter, step, arena)) {
        world.addPlayer(hero(at.x, at.y));
        world.teleport(HERO, at.x, at.y);
        const before = new Set(world.entityIds());
        if (!world.startBattle(battle.id, HERO)) {
          problems.push(`${battle.id} from ${where}: did not start`);
          world.removePlayer(HERO);
          continue;
        }
        world.tick(0.05);
        const me = world.playerStatus(HERO);
        if (!me || !onArena(arena, me.x, me.y)) problems.push(`${battle.id} from ${where}: hero off the arena at ${me?.x},${me?.y}`);
        else if (arena.naval && !onDeck(arena, me.x, me.y)) problems.push(`${battle.id} from ${where}: hero off the deck at ${me.x},${me.y}`);
        // The opening spawns (boss, first waves) stand on the arena too, and a
        // deck battle's boarders on its decks while deck tiles remain.
        const foes = world.entityIds().filter((entity) => !before.has(entity)).map((entity) => world.inspect(entity))
          .filter((foe) => foe?.side === "foe");
        for (const foe of foes) {
          if (!foe) continue;
          if (!onArena(arena, foe.x, foe.y))
            problems.push(`${battle.id} from ${where}: ${foe.boss ? "boss" : foe.name} spawned off the arena at ${foe.x},${foe.y}`);
          else if (arena.naval && foes.length <= arena.deck.size && !foe.boss && !onDeck(arena, foe.x, foe.y))
            problems.push(`${battle.id} from ${where}: ${foe.name} boarded off the deck at ${foe.x},${foe.y}`);
        }
        world.abortBattle();
        world.removePlayer(HERO);
        world.tick(3.5);
      }
    }
    assert.deepEqual(problems, []);
  });
}
