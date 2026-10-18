// Battles: participants, waves (side/sea/deck spawns), boss, defend target,
// allies, headcount scaling, morale/rout and the victory/defeat rules, fought
// on the arena that sim/arena.ts resolves (arenaOf is the one owner of where).
import type { BattleDef, WaveDef } from "../content/schema.ts";
import { TILE_INFO, type TileId } from "../map/tiles.ts";
import { isPropSprite } from "../sprites.ts";
import type { BattleView } from "../types.ts";
import { arenaSpot, battleArena, boardingSpot, bossSpot, deckSpot, inRing, onArena, onArenaTile, onDeck, rimSpot, type Arena } from "./arena.ts";
import { makeBossState } from "./boss.ts";
import { atkScale, bodyFree, makeActor, releaseToken, spawnEnemy, spawnFighter } from "./entities.ts";
import type { CollisionGrid } from "./physics.ts";
import { placePlayer } from "./player.ts";
import { COLOR, emit, floatText, isDowned, later, sound, type Actor, type Sim } from "./state.ts";

export interface WaveRuntime {
  def: WaveDef;
  spawned: boolean;
  ids: number[];
  moraleHit: boolean;
}

export interface BattleRuntime {
  def: BattleDef;
  arena: Arena;
  startedAt: number;
  starter: number;
  participants: number[];
  /** Players who left the battle (a demo skip won it for them alone); they do not rejoin it. */
  left: Set<number>;
  waves: WaveRuntime[];
  /** Every battle enemy id: wave members, boss and summons. */
  enemies: number[];
  fled: Set<number>;
  bossId: number;
  bossDead: boolean;
  defendId: number;
  allies: number[];
  morale: number;
  hpScale: number;
  countScale: number;
  routed: boolean;
  seaAngle: number | null | undefined;
}

const SIDE_ANGLE = { north: -Math.PI / 2, south: Math.PI / 2, east: 0, west: Math.PI } as const;
/** Players this far beyond the ring still count toward a wave's scaling: they are arriving. */
const ARRIVING = 6;

/** Humans count 1, companion bots 0.5. */
function headcount(sim: Sim, ids: readonly number[]): number {
  let n = 0;
  for (const id of ids) {
    const a = sim.actors.get(id);
    if (a?.pl) n += a.pl.bot ? 0.5 : 1;
  }
  return Math.max(1, n);
}

const scaleOf = (n: number, per: number): number => Math.min(3, 1 + per * (n - 1));

/** Participants plus players arriving at the ring: who a wave will meet. */
function fightersAt(sim: Sim, b: BattleRuntime): number[] {
  const ids = [...b.participants];
  const { x, y, radius } = b.arena;
  for (const p of sim.players.values())
    if (!ids.includes(p.id) && !b.left.has(p.id) && Math.hypot(p.x - x, p.y - y) <= radius + ARRIVING) ids.push(p.id);
  return ids;
}

/**
 * A defend post's HP: the written HP for each attacker multiple it faces
 * (countScale). The attackers' extra HP (hpScale) only makes them live
 * longer, which the larger party offsets.
 */
const postHp = (b: BattleRuntime): number => Math.round((b.def.defend?.hp ?? 0) * b.countScale);

/** Re-reads the headcount scaling, and the post's HP with it; duels are always one against one. */
function rescale(sim: Sim, b: BattleRuntime): void {
  if (b.def.kind === "duel") return;
  const n = headcount(sim, fightersAt(sim, b));
  b.countScale = scaleOf(n, 0.5);
  b.hpScale = Math.max(b.hpScale, scaleOf(n, 0.65));
  const post = sim.actors.get(b.defendId);
  if (post?.alive) {
    const ratio = post.hp / post.maxHp;
    post.maxHp = postHp(b);
    post.hp = Math.max(1, ratio * post.maxHp);
  }
}

/** Resolved arenas per collision grid (one year's map) and battle def: all an arena depends on. */
const arenas = new WeakMap<CollisionGrid, Map<BattleDef, Arena | null>>();

/**
 * Where a chapter battle is fought: the running battle's arena, else the one
 * sim/arena.ts resolves for it on the current year's map (cached). Every
 * reader of a battle's place goes through it: the start, the trigger, the
 * objective marker, the story teleport.
 */
export function arenaOf(sim: Sim, battleId: string): Arena | null {
  if (sim.battle?.def.id === battleId) return sim.battle.arena;
  const def = sim.chapter.battles.find((b) => b.id === battleId);
  const site = def ? sim.sites.get(def.site) : undefined;
  if (!def || !site) return null;
  let byDef = arenas.get(sim.grid);
  if (!byDef) arenas.set(sim.grid, (byDef = new Map()));
  if (!byDef.has(def)) byDef.set(def, battleArena(sim.grid, site, def));
  return byDef.get(def) ?? null;
}

/**
 * Puts a participant on the arena's ground: the starter wherever the trigger
 * caught them (onto a deck in a deck battle), anyone else only when they
 * stand in a walled pocket of the ring. Every action in flight is cancelled.
 */
function enter(sim: Sim, b: BattleRuntime, a: Actor): void {
  const { arena } = b;
  if (a.id === b.starter && arena.naval && !onDeck(arena, a.x, a.y)) {
    const p = deckSpot(arena, a.x, a.y);
    placePlayer(sim, a, p.x, p.y);
    return;
  }
  if (onArena(arena, a.x, a.y)) return;
  if (a.id !== b.starter && Math.hypot(a.x - arena.x, a.y - arena.y) > arena.radius + 0.5) return;
  const p = arenaSpot(arena, a.x, a.y);
  placePlayer(sim, a, p.x, p.y);
}

export function startBattle(sim: Sim, battleId: string, starterId: number): BattleRuntime | null {
  if (sim.battle) return null;
  const def = sim.chapter.battles.find((b) => b.id === battleId);
  const arena = arenaOf(sim, battleId);
  if (!def || !arena) return null;
  const duel = def.kind === "duel";
  const participants: number[] = [];
  if (sim.players.has(starterId)) participants.push(starterId);
  if (!duel)
    for (const p of sim.players.values())
      if (p.id !== starterId && Math.hypot(p.x - arena.x, p.y - arena.y) <= arena.radius + 2) participants.push(p.id);
  const b: BattleRuntime = {
    def,
    arena,
    startedAt: sim.time,
    starter: starterId,
    participants,
    left: new Set(),
    waves: duel ? [] : def.waves.map((w) => ({ def: w, spawned: false, ids: [], moraleHit: false })),
    enemies: [],
    fled: new Set(),
    bossId: -1,
    bossDead: false,
    defendId: -1,
    allies: [],
    morale: 100,
    hpScale: 1,
    countScale: 1,
    routed: false,
    seaAngle: undefined,
  };
  sim.battle = b;
  for (const id of participants) {
    const a = sim.actors.get(id);
    if (a) enter(sim, b, a);
  }
  rescale(sim, b);
  const level = battleLevel(sim, def);
  const foeAngle = sideAngle(sim, b, def.waves[0]?.from) ?? -Math.PI / 2;
  if (def.kind === "defend" && def.defend) {
    const p = arenaSpot(arena, arena.x, arena.y);
    const sprite = def.defend.sprite;
    const hp = postHp(b);
    const a = makeActor(sim, { kind: isPropSprite(sprite) ? "prop" : "ally", side: "friend", x: p.x, y: p.y, sprite, name: def.defend.name, hp });
    a.defend = true;
    b.defendId = a.id;
  }
  if (!duel)
    for (const group of def.allies ?? [])
      for (let i = 0; i < group.count; i++) {
        const ang = foeAngle + Math.PI + sim.rng.range(-0.8, 0.8);
        const r = 1.5 + sim.rng.range(0, 1.5);
        const p = arenaSpot(arena, arena.x + Math.cos(ang) * r, arena.y + Math.sin(ang) * r);
        const ally = spawnFighter(sim, {
          kind: "ally", sprite: group.sprite, name: group.name, x: p.x, y: p.y,
          hp: Math.round(90 * (1 + 0.1 * (level - 1))), atk: 8 * atkScale(level), level, immortal: false,
        });
        b.allies.push(ally.id);
      }
  if (!duel)
    for (const id of sim.npcs.values()) {
      const npc = sim.actors.get(id);
      const npcDef = npc?.npcId ? sim.chapter.npcs.find((d) => d.id === npc.npcId) : undefined;
      if (npc?.fi && npcDef?.site === def.site) npc.fi.active = true;
    }
  // Boss and duel fights open with the boss; other kinds bring it with the last wave.
  if (def.boss && (def.kind === "boss" || duel || b.waves.length === 0)) {
    const p = bossSpot(arena, foeAngle, standing(sim, b));
    spawnBoss(sim, b, p.x, p.y, starterId);
  }
  emit(sim, { k: "shout", x: arena.x, y: arena.y, power: arena.radius });
  floatText(sim, arena.x, arena.y, def.title, COLOR.phase, true);
  return b;
}

function spawnBoss(sim: Sim, b: BattleRuntime, x: number, y: number, targetId: number): void {
  const bossDef = b.def.boss;
  const body = bossDef ? sim.content.enemies[bossDef.enemy] : undefined;
  if (!bossDef || !body || b.bossId >= 0) return;
  const boss = spawnEnemy(sim, body, x, y, {
    level: bossDef.level, hpMul: bossDef.hpScale * b.hpScale, battle: true, boss: makeBossState(bossDef),
  });
  b.bossId = boss.id;
  b.enemies.push(boss.id);
  if (boss.en) boss.en.target = targetId;
}

function battleLevel(sim: Sim, def: BattleDef): number {
  if (def.boss) return def.boss.level;
  const levels = def.waves.flatMap((w) => w.enemies.map((e) => e.level));
  return levels.length > 0 ? Math.round(levels.reduce((s, l) => s + l, 0) / levels.length) : sim.chapter.level[0];
}

function sideAngle(sim: Sim, b: BattleRuntime, from: WaveDef["from"]): number | null {
  if (from === "north" || from === "south" || from === "east" || from === "west") return SIDE_ANGLE[from];
  if (from === "sea") return seaAngle(sim, b);
  return null;
}

/** Direction from the centre with the most water within reach. */
function seaAngle(sim: Sim, b: BattleRuntime): number | null {
  if (b.seaAngle !== undefined) return b.seaAngle;
  let best = 0;
  let bestAngle: number | null = null;
  const g = sim.grid;
  const { x: cx, y: cy, radius } = b.arena;
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    let water = 0;
    for (let r = Math.floor(radius * 0.5); r <= radius + 6; r++) {
      const x = Math.floor(cx + Math.cos(ang) * r);
      const y = Math.floor(cy + Math.sin(ang) * r);
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
      if (TILE_INFO[g.tiles[y * g.width + x] as TileId]?.water) water++;
    }
    if (water > best) {
      best = water;
      bestAngle = ang;
    }
  }
  b.seaAngle = bestAngle;
  return bestAngle;
}

/**
 * Where the k-th of n wave enemies appears: in a deck battle on a deck (a
 * hull edge first) all around the ship; otherwise, or once every deck tile
 * is taken, on the rim toward the wave's side.
 */
function wavePoint(sim: Sim, b: BattleRuntime, from: WaveDef["from"], k: number, n: number, used: Set<number>): { x: number; y: number } {
  const around = () => (k / Math.max(1, n)) * Math.PI * 2 + sim.rng.range(-0.2, 0.2);
  const aboard = b.arena.naval ? boardingSpot(b.arena, around(), standing(sim, b), used) : null;
  return aboard ?? rimSpot(b.arena, sideAngle(sim, b, from) ?? around(), standing(sim, b), used);
}

/** Where the participants stand: spawns keep their distance so they are seen coming. */
function standing(sim: Sim, b: BattleRuntime): Actor[] {
  return b.participants.map((id) => sim.actors.get(id)).filter((a): a is Actor => a !== undefined);
}

function spawnWave(sim: Sim, b: BattleRuntime, index: number): void {
  const w = b.waves[index];
  if (!w) return;
  w.spawned = true;
  rescale(sim, b);
  const groups = w.def.enemies
    .map((g) => ({ def: sim.content.enemies[g.enemy], level: g.level, count: g.count <= 0 ? 0 : Math.max(1, Math.round(g.count * b.countScale)) }))
    .filter((g) => g.def !== undefined);
  const total = groups.reduce((s, g) => s + g.count, 0);
  const used = new Set<number>();
  let k = 0;
  for (const g of groups) {
    const def = g.def;
    if (!def) continue;
    for (let i = 0; i < g.count; i++) {
      const p = wavePoint(sim, b, w.def.from, k++, total, used);
      const a = spawnEnemy(sim, def, p.x, p.y, { level: g.level, battle: true, wave: index, hpMul: b.hpScale });
      if (a.en) {
        a.en.state = "alert";
        a.en.alertUntil = sim.time + 0.3;
        a.markUntil = sim.time + 0.9;
        a.en.target = b.defendId >= 0 ? b.defendId : (b.participants[k % Math.max(1, b.participants.length)] ?? b.starter);
      }
      w.ids.push(a.id);
      b.enemies.push(a.id);
    }
  }
  if (index === b.waves.length - 1 && b.def.boss && b.bossId < 0) {
    const p = wavePoint(sim, b, w.def.from, 0, 1, used);
    const target = b.defendId >= 0 ? b.defendId : (b.participants[0] ?? b.starter);
    spawnBoss(sim, b, p.x, p.y, target);
  }
  if (w.def.line) floatText(sim, b.arena.x, b.arena.y, w.def.line, COLOR.phase, true);
  sound(sim, "skill", b.arena.x, b.arena.y);
}

function killed(sim: Sim, b: BattleRuntime, id: number): boolean {
  const a = sim.actors.get(id);
  return a ? !a.alive : !b.fled.has(id);
}

function liveEnemies(sim: Sim, b: BattleRuntime): number {
  let n = 0;
  for (const id of b.enemies) {
    const a = sim.actors.get(id);
    if (a?.alive && a.en?.state !== "flee") n++;
  }
  return n;
}

function flee(sim: Sim, b: BattleRuntime, a: Actor): void {
  const e = a.en;
  if (!e || !a.alive) return;
  e.state = "flee";
  e.fleeUntil = sim.time + 3;
  e.goalX = b.arena.x;
  e.goalY = b.arena.y;
  e.act = null;
  e.target = -1;
  releaseToken(sim, a);
  b.fled.add(a.id);
}

export function tickBattle(sim: Sim): void {
  const b = sim.battle;
  if (!b) return;
  const t = sim.time;
  const elapsed = t - b.startedAt;
  if (b.def.kind !== "duel")
    for (const p of sim.players.values())
      if (!b.participants.includes(p.id) && !b.left.has(p.id) && onArena(b.arena, p.x, p.y)) b.participants.push(p.id);
  if (!b.routed && !b.bossDead)
    for (let i = 0; i < b.waves.length; i++) {
      const w = b.waves[i] as WaveRuntime;
      if (w.spawned) continue;
      const prev = b.waves[i - 1];
      const due = w.def.at !== undefined
        ? elapsed >= w.def.at
        : !prev || (prev.spawned && prev.ids.every((id) => killed(sim, b, id) || b.fled.has(id)));
      if (due) spawnWave(sim, b, i);
    }
  for (const w of b.waves) {
    if (!w.spawned || w.moraleHit || w.ids.length === 0) continue;
    const dead = w.ids.reduce((s, id) => s + (killed(sim, b, id) ? 1 : 0), 0);
    if (dead >= Math.ceil(w.ids.length * 0.4)) {
      w.moraleHit = true;
      b.morale -= 25;
    }
  }
  if (b.bossId >= 0 && !b.bossDead) {
    const boss = sim.actors.get(b.bossId);
    if (!boss || !boss.alive) {
      b.bossDead = true;
      b.morale -= 40;
    }
  }
  b.morale = Math.max(0, b.morale);
  if (b.morale <= 0 && !b.routed) {
    b.routed = true;
    for (const id of b.enemies) {
      const a = sim.actors.get(id);
      if (a) flee(sim, b, a);
    }
    floatText(sim, b.arena.x, b.arena.y, "적이 무너진다!", COLOR.phase, true);
  }
  const result = evaluate(sim, b, elapsed);
  if (result) endBattle(sim, result);
}

/**
 * A downed human stays revivable until their down timer runs out; the
 * battle is lost when every participant is down at once, or when every
 * human participant is down past that timer. A self-revive in between puts
 * them on the arena's rim, still fighting (rimRevival).
 */
function lost(sim: Sim, b: BattleRuntime): boolean {
  const fighters = b.participants.map((id) => sim.actors.get(id)).filter((a): a is Actor => a?.pl != null);
  if (fighters.length === 0 || fighters.every(isDowned)) return true;
  const humans = fighters.filter((a) => a.kind === "player");
  return humans.length > 0 && humans.every((a) => isDowned(a) && sim.time >= (a.pl?.downEnd ?? 0));
}

function evaluate(sim: Sim, b: BattleRuntime, elapsed: number): "victory" | "defeat" | null {
  if (b.defendId >= 0 && !sim.actors.get(b.defendId)?.alive) return "defeat";
  if (lost(sim, b)) return "defeat";
  const kind = b.def.kind;
  if ((kind === "boss" || kind === "duel") && b.bossId >= 0) return b.bossDead ? "victory" : null;
  if ((kind === "survive" || kind === "escape" || kind === "defend") && b.def.timeLimit !== undefined && elapsed >= b.def.timeLimit)
    return "victory";
  const wavesDone = b.routed || b.waves.every((w) => w.spawned);
  if (wavesDone && (b.waves.length > 0 || b.bossId >= 0) && liveEnemies(sim, b) === 0) return "victory";
  return null;
}

/**
 * Where a participant of the active battle stands when they revive
 * themself: on the arena's rim on their side, clear of the enemies — they
 * stay in the fight. Null when `a` is not fighting a battle.
 */
export function rimRevival(sim: Sim, a: Actor): { x: number; y: number } | null {
  const b = sim.battle;
  if (!b?.participants.includes(a.id)) return null;
  const { arena } = b;
  const enemies = b.enemies.map((id) => sim.actors.get(id)).filter((e): e is Actor => e?.alive === true && e.en?.state !== "flee");
  return rimSpot(arena, Math.atan2(a.y - arena.y, a.x - arena.x), enemies, new Set());
}

/**
 * Takes a player out of the active battle: they are no participant any more
 * and do not rejoin by standing on its ground. A demo skip that wins the
 * battle for one player while others fight on uses it.
 */
export function leaveBattle(sim: Sim, id: number): void {
  const b = sim.battle;
  if (!b) return;
  b.participants = b.participants.filter((p) => p !== id);
  b.left.add(id);
}

/** Ends the active battle; `result` null aborts without a hook call. */
export function endBattle(sim: Sim, result: "victory" | "defeat" | null): void {
  const b = sim.battle;
  if (!b) return;
  sim.battle = null;
  const t = sim.time;
  for (const id of b.enemies) {
    const a = sim.actors.get(id);
    if (a) flee(sim, b, a);
  }
  for (const id of b.allies) {
    const a = sim.actors.get(id);
    if (a?.fi) {
      a.fi.active = false;
      a.removeAt = t + 2.5;
    }
  }
  const guard = sim.actors.get(b.defendId);
  if (guard) guard.removeAt = Math.min(guard.removeAt, t + 2);
  for (const id of sim.npcs.values()) {
    const npc = sim.actors.get(id);
    if (npc?.fi) npc.fi.active = false;
  }
  if (!result) return;
  floatText(sim, b.arena.x, b.arena.y, result === "victory" ? "승리" : "패배", result === "victory" ? COLOR.crit : COLOR.hurt, true);
  const participants = [...b.participants];
  const id = b.def.id;
  later(sim, () => sim.hooks.onBattleEnd(id, result, participants));
}

export function battleView(sim: Sim): BattleView | null {
  const b = sim.battle;
  if (!b) return null;
  const def = b.def;
  const { x, y, radius } = b.arena;
  const view: BattleView = { id: def.id, title: def.title, kind: def.kind, x, y, radius, participants: b.participants.length, morale: b.morale };
  if (def.subtitle) view.subtitle = def.subtitle;
  if (def.alt) view.alt = true;
  if (def.weather) view.weather = def.weather;
  if (def.hour !== undefined) view.hour = def.hour;
  if (def.timeLimit !== undefined && (def.kind === "survive" || def.kind === "escape" || def.kind === "defend"))
    view.timeLeft = Math.max(0, Math.ceil(def.timeLimit - (sim.time - b.startedAt)));
  if (b.waves.length > 0) view.wave = [b.waves.filter((w) => w.spawned).length, b.waves.length];
  if (b.bossId >= 0) {
    const boss = sim.actors.get(b.bossId);
    const hp = boss?.alive ? Math.max(0, Math.ceil((boss.hp / boss.maxHp) * 100)) : 0;
    view.boss = { name: def.boss?.name ?? boss?.name ?? "", hp, historical: def.boss?.historical ?? false };
    if (def.boss?.title) view.boss.title = def.boss.title;
  }
  if (b.defendId >= 0 && def.defend) {
    const guard = sim.actors.get(b.defendId);
    view.defend = { name: def.defend.name, hp: guard?.alive ? Math.max(0, Math.ceil((guard.hp / guard.maxHp) * 100)) : 0 };
  }
  return view;
}

/**
 * Keeps participants on the arena's ground (the ring's main component) and
 * battle enemies on it or within a tile outside the ring. A participant
 * stepping off the ground slides along its edge like along a wall.
 */
export function clampArena(sim: Sim, a: Actor, ox: number, oy: number): void {
  const b = sim.battle;
  if (!b) return;
  const arena = b.arena;
  if (a.pl) {
    if (!b.participants.includes(a.id) || !onArena(arena, ox, oy) || onArena(arena, a.x, a.y)) return;
    // Slide along the ring, then along the ground's edge as along a wall.
    const d = Math.hypot(a.x - arena.x, a.y - arena.y);
    const k = d > arena.radius ? arena.radius / d : 1;
    const slides = [[arena.x + (a.x - arena.x) * k, arena.y + (a.y - arena.y) * k], [a.x, oy], [ox, a.y]] as const;
    for (const [x, y] of slides)
      if (onArena(arena, x, y) && bodyFree(sim, x, y)) {
        a.x = x;
        a.y = y;
        return;
      }
    a.x = ox;
    a.y = oy;
    return;
  }
  if (!a.en?.battle) return;
  if (inRing(arena, a.x, a.y)) {
    // Walled pockets of the ring stay closed to battle enemies.
    const pocket = (x: number, y: number) => inRing(arena, x, y) && !onArenaTile(arena, x, y);
    if (pocket(a.x, a.y) && !pocket(ox, oy)) {
      a.x = ox;
      a.y = oy;
    }
    return;
  }
  const r = arena.radius + 1;
  const dx = a.x - arena.x;
  const dy = a.y - arena.y;
  const d = Math.hypot(dx, dy);
  if (d <= r) return;
  const nx = arena.x + (dx / d) * r;
  const ny = arena.y + (dy / d) * r;
  if (bodyFree(sim, nx, ny)) {
    a.x = nx;
    a.y = ny;
  } else {
    a.x = ox;
    a.y = oy;
  }
}
