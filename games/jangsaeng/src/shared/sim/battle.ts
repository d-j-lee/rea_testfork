// Battles: arena, participants, waves (side/sea/deck spawns), boss, defend
// target, allies, MMO scaling, morale/rout and the victory/defeat rules.
import type { BattleDef, WaveDef } from "../content/schema.ts";
import { TILE_INFO, Tile, type TileId } from "../map/tiles.ts";
import { isPropSprite } from "../sprites.ts";
import type { BattleView } from "../types.ts";
import { makeBossState } from "./boss.ts";
import { atkScale, bodyFree, freePoint, makeActor, releaseToken, spawnEnemy, spawnFighter } from "./entities.ts";
import { COLOR, emit, floatText, isDowned, later, sound, type Actor, type Sim } from "./state.ts";

export interface WaveRuntime {
  def: WaveDef;
  spawned: boolean;
  ids: number[];
  moraleHit: boolean;
}

export interface BattleRuntime {
  def: BattleDef;
  cx: number;
  cy: number;
  radius: number;
  startedAt: number;
  starter: number;
  participants: number[];
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
  deck: { x: number; y: number }[] | null;
}

const SIDE_ANGLE = { north: -Math.PI / 2, south: Math.PI / 2, east: 0, west: Math.PI } as const;

/** Humans count 1, companion bots 0.5. */
export function headcount(sim: Sim, ids: readonly number[]): number {
  let n = 0;
  for (const id of ids) {
    const a = sim.actors.get(id);
    if (a?.pl) n += a.pl.bot ? 0.5 : 1;
  }
  return Math.max(1, n);
}

const scaleOf = (n: number, per: number): number => Math.min(3, 1 + per * (n - 1));

export function startBattle(sim: Sim, battleId: string, starterId: number): BattleRuntime | null {
  if (sim.battle) return null;
  const def = sim.chapter.battles.find((b) => b.id === battleId);
  const site = def ? sim.sites.get(def.site) : undefined;
  if (!def || !site) return null;
  const off = def.offset ?? [0, 0];
  const centre = freePoint(sim, site.x + 0.5 + off[0], site.y + 0.5 + off[1], 6);
  const duel = def.kind === "duel";
  const participants: number[] = [];
  if (sim.players.has(starterId)) participants.push(starterId);
  if (!duel)
    for (const p of sim.players.values())
      if (p.id !== starterId && Math.hypot(p.x - centre.x, p.y - centre.y) <= def.radius + 2) participants.push(p.id);
  const n = def.scaled ? headcount(sim, participants) : 1;
  const b: BattleRuntime = {
    def,
    cx: centre.x,
    cy: centre.y,
    radius: def.radius,
    startedAt: sim.time,
    starter: starterId,
    participants,
    waves: duel ? [] : def.waves.map((w) => ({ def: w, spawned: false, ids: [], moraleHit: false })),
    enemies: [],
    fled: new Set(),
    bossId: -1,
    bossDead: false,
    defendId: -1,
    allies: [],
    morale: 100,
    hpScale: scaleOf(n, 0.65),
    countScale: scaleOf(n, 0.5),
    routed: false,
    seaAngle: undefined,
    deck: null,
  };
  sim.battle = b;
  const level = battleLevel(sim, def);
  const foeAngle = sideAngle(sim, b, def.waves[0]?.from) ?? -Math.PI / 2;
  if (def.kind === "defend" && def.defend) {
    const p = freePoint(sim, b.cx, b.cy, 4);
    const sprite = def.defend.sprite;
    const a = makeActor(sim, { kind: isPropSprite(sprite) ? "prop" : "ally", side: "friend", x: p.x, y: p.y, sprite, name: def.defend.name, hp: def.defend.hp });
    a.defend = true;
    b.defendId = a.id;
  }
  if (!duel)
    for (const group of def.allies ?? [])
      for (let i = 0; i < group.count; i++) {
        const ang = foeAngle + Math.PI + sim.rng.range(-0.8, 0.8);
        const r = 1.5 + sim.rng.range(0, 1.5);
        const ally = spawnFighter(sim, {
          kind: "ally", sprite: group.sprite, name: group.name, x: b.cx + Math.cos(ang) * r, y: b.cy + Math.sin(ang) * r,
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
  if ((def.kind === "boss" || duel) && def.boss) {
    const bossDef = def.boss;
    const body = sim.content.enemies[bossDef.enemy];
    if (body) {
      const r = b.radius * 0.4;
      const boss = spawnEnemy(sim, body, b.cx + Math.cos(foeAngle) * r, b.cy + Math.sin(foeAngle) * r, {
        level: bossDef.level, hpMul: bossDef.hpScale * b.hpScale, battle: true, boss: makeBossState(bossDef),
      });
      b.bossId = boss.id;
      b.enemies.push(boss.id);
      if (boss.en) boss.en.target = starterId;
    }
  }
  emit(sim, { k: "shout", x: b.cx, y: b.cy, power: b.radius });
  floatText(sim, b.cx, b.cy, def.title, COLOR.phase, true);
  return b;
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
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    let water = 0;
    for (let r = Math.floor(b.radius * 0.5); r <= b.radius + 6; r++) {
      const x = Math.floor(b.cx + Math.cos(ang) * r);
      const y = Math.floor(b.cy + Math.sin(ang) * r);
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

/** Deck tiles on the hull edge (next to water) inside the arena. */
function deckEdges(sim: Sim, b: BattleRuntime): { x: number; y: number }[] {
  if (b.deck) return b.deck;
  const g = sim.grid;
  const out: { x: number; y: number }[] = [];
  const r = Math.ceil(b.radius);
  for (let y = Math.floor(b.cy) - r; y <= Math.floor(b.cy) + r; y++)
    for (let x = Math.floor(b.cx) - r; x <= Math.floor(b.cx) + r; x++) {
      if (x < 1 || y < 1 || x >= g.width - 1 || y >= g.height - 1) continue;
      if (g.tiles[y * g.width + x] !== Tile.Deck || g.blocked[y * g.width + x] === 1) continue;
      if (Math.hypot(x + 0.5 - b.cx, y + 0.5 - b.cy) > b.radius) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const t = g.tiles[(y + (dy ?? 0)) * g.width + x + (dx ?? 0)] as TileId;
        return t !== Tile.Deck && TILE_INFO[t]?.water;
      });
      if (edge) out.push({ x: x + 0.5, y: y + 0.5 });
    }
  b.deck = out;
  return out;
}

function wavePoint(sim: Sim, b: BattleRuntime, from: WaveDef["from"], k: number, n: number): { x: number; y: number } {
  if (b.def.kind === "deck") {
    const deck = deckEdges(sim, b);
    if (deck.length > 0) return deck[(k * 7 + sim.rng.int(0, deck.length - 1)) % deck.length] as { x: number; y: number };
  }
  const side = sideAngle(sim, b, from);
  const ang = side ?? (k / Math.max(1, n)) * Math.PI * 2 + sim.rng.range(-0.2, 0.2);
  const reach = Math.max(1, b.radius - 1.2);
  const spread = side === null ? 0 : Math.max(-(b.radius - 2), Math.min(b.radius - 2, (k - (n - 1) / 2) * 0.9));
  const x = b.cx + Math.cos(ang) * reach - Math.sin(ang) * spread + sim.rng.range(-0.3, 0.3);
  const y = b.cy + Math.sin(ang) * reach + Math.cos(ang) * spread + sim.rng.range(-0.3, 0.3);
  let p = freePoint(sim, x, y, 5);
  if (Math.hypot(p.x - b.cx, p.y - b.cy) > b.radius) p = freePoint(sim, b.cx + (x - b.cx) * 0.6, b.cy + (y - b.cy) * 0.6, 5);
  return p;
}

function spawnWave(sim: Sim, b: BattleRuntime, index: number): void {
  const w = b.waves[index];
  if (!w) return;
  w.spawned = true;
  if (b.def.scaled) {
    b.countScale = scaleOf(headcount(sim, b.participants), 0.5);
    b.hpScale = Math.max(b.hpScale, scaleOf(headcount(sim, b.participants), 0.65));
  }
  const groups = w.def.enemies
    .map((g) => ({ def: sim.content.enemies[g.enemy], level: g.level, count: g.count <= 0 ? 0 : Math.max(1, Math.round(g.count * b.countScale)) }))
    .filter((g) => g.def !== undefined);
  const total = groups.reduce((s, g) => s + g.count, 0);
  let k = 0;
  for (const g of groups) {
    const def = g.def;
    if (!def) continue;
    for (let i = 0; i < g.count; i++) {
      const p = wavePoint(sim, b, w.def.from, k++, total);
      const a = spawnEnemy(sim, def, p.x, p.y, { level: g.level, battle: true, wave: index, hpMul: def.elite && b.def.scaled ? b.hpScale : 1 });
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
  if (w.def.line) floatText(sim, b.cx, b.cy, w.def.line, COLOR.phase, true);
  sound(sim, "skill", b.cx, b.cy);
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
  e.goalX = b.cx;
  e.goalY = b.cy;
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
      if (!b.participants.includes(p.id) && Math.hypot(p.x - b.cx, p.y - b.cy) <= b.radius) b.participants.push(p.id);
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
    floatText(sim, b.cx, b.cy, "적이 무너진다!", COLOR.phase, true);
  }
  const result = evaluate(sim, b, elapsed);
  if (result) endBattle(sim, result);
}

function evaluate(sim: Sim, b: BattleRuntime, elapsed: number): "victory" | "defeat" | null {
  if (b.defendId >= 0 && !sim.actors.get(b.defendId)?.alive) return "defeat";
  const fighters = b.participants.map((id) => sim.actors.get(id)).filter((a): a is Actor => a?.pl != null);
  const humans = fighters.filter((a) => a.kind === "player");
  const group = humans.length > 0 ? humans : fighters;
  if (group.length === 0 || group.every(isDowned)) return "defeat";
  const kind = b.def.kind;
  if ((kind === "boss" || kind === "duel") && b.bossId >= 0) return b.bossDead ? "victory" : null;
  if ((kind === "survive" || kind === "escape" || kind === "defend") && b.def.timeLimit !== undefined && elapsed >= b.def.timeLimit)
    return "victory";
  const wavesDone = b.routed || b.waves.every((w) => w.spawned);
  if (wavesDone && (b.waves.length > 0 || b.bossId >= 0) && liveEnemies(sim, b) === 0) return "victory";
  return null;
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
  floatText(sim, b.cx, b.cy, result === "victory" ? "승리" : "패배", result === "victory" ? COLOR.crit : COLOR.hurt, true);
  const participants = [...b.participants];
  const id = b.def.id;
  later(sim, () => sim.hooks.onBattleEnd(id, result, participants));
}

export function battleView(sim: Sim): BattleView | null {
  const b = sim.battle;
  if (!b) return null;
  const def = b.def;
  const view: BattleView = { id: def.id, title: def.title, kind: def.kind, x: b.cx, y: b.cy, radius: b.radius, participants: b.participants.length, morale: b.morale };
  if (def.subtitle) view.subtitle = def.subtitle;
  if (def.timeLimit !== undefined && (def.kind === "survive" || def.kind === "escape" || def.kind === "defend"))
    view.timeLeft = Math.max(0, Math.ceil(def.timeLimit - (sim.time - b.startedAt)));
  if (b.waves.length > 0) view.wave = [b.waves.filter((w) => w.spawned).length, b.waves.length];
  if (b.bossId >= 0) {
    const boss = sim.actors.get(b.bossId);
    const hp = boss?.alive ? Math.max(0, Math.ceil((boss.hp / boss.maxHp) * 100)) : 0;
    view.boss = { name: def.boss?.name ?? boss?.name ?? "", hp };
    if (def.boss?.title) view.boss.title = def.boss.title;
  }
  if (b.defendId >= 0 && def.defend) {
    const guard = sim.actors.get(b.defendId);
    view.defend = { name: def.defend.name, hp: guard?.alive ? Math.max(0, Math.ceil((guard.hp / guard.maxHp) * 100)) : 0 };
  }
  return view;
}

/** Keeps participants inside the ring and battle enemies near it. */
export function clampArena(sim: Sim, a: Actor, ox: number, oy: number): void {
  const b = sim.battle;
  if (!b) return;
  let r: number;
  if (a.pl) {
    if (!b.participants.includes(a.id) || Math.hypot(ox - b.cx, oy - b.cy) > b.radius + 0.5) return;
    r = b.radius;
  } else if (a.en?.battle) r = b.radius + 1;
  else return;
  const dx = a.x - b.cx;
  const dy = a.y - b.cy;
  const d = Math.hypot(dx, dy);
  if (d <= r) return;
  const nx = b.cx + (dx / d) * r;
  const ny = b.cy + (dy / d) * r;
  if (bodyFree(sim, nx, ny)) {
    a.x = nx;
    a.y = ny;
  } else {
    a.x = ox;
    a.y = oy;
  }
}
