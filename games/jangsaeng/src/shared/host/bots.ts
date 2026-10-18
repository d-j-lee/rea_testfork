// Simulated companions (◇): fill era channels so the world feels inhabited.
// They follow a human, fight beside them, revive the fallen and chat. They
// never progress story and are always marked as simulated in the UI.
import type { ContentIndex } from "../content/index.ts";
import type { CompanionPersona } from "../content/schema.ts";
import { createRng, type Rng } from "../rng.ts";
import { createSave, derived } from "../rules/index.ts";
import type { PlayerInput, PlayerSpec, World } from "../sim/world.ts";
import type { Channel } from "./channel.ts";

const THINK_EVERY = 0.2;
/** In a battle a companion fights back against enemies this close to itself… */
const SELF_DEFENCE = 2.2;
/** …and takes on enemies this close to its leader (or to a fallen ally it covers). */
const GUARD_RADIUS = 3.5;
/** Companions covering a revive keep this far from the fallen… */
const COVER = 2.5;
/** …while this many, the nearest, go in to revive (two in case one is stuck). */
const REVIVERS = 2;
/** In a defend battle companions also take on enemies this close to the post. */
const POST_GUARD = 5.5;
/** A companion goes after an enemy this close that is aiming at it or its leader. */
const RETURN_FIRE = 10;
/** Companions strike at this share of their gear's power: the hero carries the fight. */
const SUPPORT_POWER = 0.5;
/** Seconds between a companion's skills. */
const SKILL_EVERY: readonly [number, number] = [9, 16];
/** A melee companion closes in this far from its foe (within striking reach)… */
const SURROUND = 1.2;
/** …on its far side from the one it protects, fanned over this arc (radians) by formation slot. */
const SURROUND_FAN = (Math.PI * 2) / 3;
/** Seconds a companion keeps quiet after a chat line: a battle's downs and revives do not each get one. */
const LINE_GAP = 20;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Distances (tiles) companions arrive at beside the hero, by slot, alternating so neighbours are not level… */
const ARRIVAL_SPREAD: readonly number[] = [3, 4.5];
/** …and keep from the hero in formation. */
const FOLLOW_SPREAD: readonly number[] = [2.6, 4];

export class Bot {
  readonly id: number;
  readonly persona: CompanionPersona;
  readonly level: number;
  readonly #channel: Channel;
  readonly #content: ContentIndex;
  readonly #rng: Rng;
  readonly #archer: boolean;
  #thinkTimer = 0;
  #downedFor = 0;
  #skillTimer = 6;
  #stuckTimer = 0;
  #nudge = { x: 0, y: 0, time: 0 };
  #last = { x: 0, y: 0 };
  #greetIn: number;
  #formation: number;
  /** How far from the hero this companion arrives (spotNear)… */
  #reach: number;
  /** …and keeps in formation (#formationSpot). */
  #follow: number;
  #focus: number | null = null;
  /** Seconds this companion has been thinking (its chat clock). */
  #clock = 0;
  #lastLine = -Infinity;

  /** `slot`: this companion's place among the channel's (0, 1, …): its side of the hero in formation. */
  constructor(
    id: number,
    persona: CompanionPersona,
    level: number,
    channel: Channel,
    content: ContentIndex,
    seed: number,
    slot: number,
  ) {
    this.id = id;
    this.persona = persona;
    this.level = level;
    this.#channel = channel;
    this.#content = content;
    this.#rng = createRng(seed);
    this.#archer = persona.sprite.includes("archer") || persona.style === "cautious";
    this.#greetIn = this.#rng.range(2, 9);
    // Successive slots are a golden angle apart, so any number of companions spread evenly around the hero.
    this.#formation = (slot * GOLDEN_ANGLE) % (Math.PI * 2);
    this.#reach = ARRIVAL_SPREAD[slot % ARRIVAL_SPREAD.length] as number;
    this.#follow = FOLLOW_SPREAD[slot % FOLLOW_SPREAD.length] as number;
  }

  /**
   * Where this companion stands when it arrives beside (x, y) (joining the
   * channel, a story jump, catching up): on its own formation side, at its
   * own distance, so a party never lands stacked on the hero.
   */
  spotNear(x: number, y: number): { x: number; y: number } {
    return { x: x + Math.cos(this.#formation) * this.#reach, y: y + Math.sin(this.#formation) * this.#reach };
  }

  spec(x: number, y: number): PlayerSpec {
    const save = createSave(this.#content, {
      token: "0".repeat(32),
      name: this.persona.name,
      variant: this.persona.variant,
      origin: "northeast",
      seed: this.#rng.int(1, 1e9),
      demoChapter: this.#channel.chapter.id,
    });
    save.level = this.level;
    const stats = derived(this.#content, save);
    return {
      id: this.id,
      kind: "bot",
      name: this.persona.name,
      title: this.persona.title,
      sprite: this.persona.sprite,
      variant: this.persona.variant,
      level: this.level,
      derived: { ...stats, weaponAtk: stats.weaponAtk * SUPPORT_POWER },
      skills: [...save.skillSlots].slice(0, 3),
      x,
      y,
    };
  }

  /** Says `text` in the channel's chat unless this companion spoke within LINE_GAP or the channel holds it back (Channel.say). */
  say(text: string): void {
    if (this.#clock - this.#lastLine < LINE_GAP) return;
    if (this.#channel.say(this, text)) this.#lastLine = this.#clock;
  }

  #line(kind: "greet" | "battle" | "victory" | "revive" | "downed", chance = 1): void {
    const pool = this.#content.companions.lines[kind];
    if (pool.length && this.#rng.chance(chance)) this.say(this.#rng.pick(pool));
  }

  onBattleStart(): void {
    this.#line("battle", 0.25);
  }

  onVictory(): void {
    this.#line("victory", 0.3);
  }

  onDowned(): void {
    this.#downedFor = 0;
    this.#line("downed", 0.5);
  }

  onRevived(): void {
    this.#downedFor = 0;
  }

  onRevivedSomeone(): void {
    this.#line("revive", 0.7);
  }

  onAllyDowned(id: number): void {
    if (id !== this.id) this.#focus = id;
  }

  catchUp(x: number, y: number): void {
    const spot = this.spotNear(x, y);
    this.#channel.world.teleport(this.id, spot.x, spot.y);
  }

  think(dt: number, world: World): void {
    this.#clock += dt;
    if (this.#greetIn > 0) {
      this.#greetIn -= dt;
      if (this.#greetIn <= 0) this.#line("greet", 0.8);
    }
    this.#thinkTimer -= dt;
    if (this.#thinkTimer > 0) return;
    this.#thinkTimer = THINK_EVERY;
    world.setInput(this.id, this.#decide(world));
  }

  #decide(world: World): PlayerInput {
    const idle: PlayerInput = { mx: 0, my: 0, attack: false, shoot: false, dodge: false, skill: 0, interact: false };
    const query = world.query();
    const me = query.player(this.id);
    if (!me) return idle;
    if (me.downed) {
      this.#downedFor += THINK_EVERY;
      if (this.#downedFor > 7) world.selfRevive(this.id);
      return idle;
    }
    // 1. The fallen nearby (humans first via focus): the two companions
    // nearest to them revive, the others cover them instead of crowding in
    // where one sweep would fell them all.
    const downed = query.downedAllies(me.x, me.y, 14).filter((ally) => ally.id !== this.id);
    const focus = downed.find((ally) => ally.id === this.#focus) ?? downed[0];
    if (focus) {
      const distance = Math.hypot(focus.x - me.x, focus.y - me.y);
      if (this.#nearer(query, focus, distance) < REVIVERS) return distance > 0.9 ? this.#moveTo(me, focus.x, focus.y, idle) : idle;
      const enemy = query.nearestEnemy(me.x, me.y, SELF_DEFENCE) ?? query.nearestEnemy(focus.x, focus.y, GUARD_RADIUS);
      if (enemy) return this.#fight(me, enemy, focus);
      return distance > COVER ? this.#moveTo(me, focus.x, focus.y, idle) : idle;
    }
    this.#focus = null;
    // 2. Fight. In a battle a companion is the hero's supporting cast: it
    // takes on enemies at its leader's side, at the post a defend battle
    // holds, on itself, or shooting at it or its leader, and otherwise holds
    // formation, so the hero meets each wave. Elsewhere it clears enemies
    // near its leader.
    const leader = this.#leader(query);
    const battle = query.battleCentre();
    const inBattle = battle !== null && Math.hypot(battle.x - me.x, battle.y - me.y) < battle.radius + 22;
    if (inBattle && leader) {
      const post = query.defendPost();
      // Once a named commander is on the field, half the companions go for him,
      // so the climax is the commander and not the clock.
      const boss = this.id % 2 === 0 ? query.battleBoss() : null;
      if (boss) return this.#fight(me, boss, null);
      const enemy =
        query.nearestEnemy(me.x, me.y, SELF_DEFENCE) ??
        query.nearestEnemy(leader.x, leader.y, GUARD_RADIUS) ??
        (post ? query.nearestEnemy(post.x, post.y, POST_GUARD) : null) ??
        query.enemyAiming([this.id, leader.id], me.x, me.y, RETURN_FIRE);
      if (enemy) return this.#fight(me, enemy, null);
    } else if (inBattle) {
      const enemy = query.nearestEnemy(me.x, me.y, 12);
      if (enemy) return this.#fight(me, enemy, null);
      if (Math.hypot(battle.x - me.x, battle.y - me.y) > battle.radius * 0.6) return this.#moveTo(me, battle.x, battle.y, idle);
    } else {
      const enemy = query.nearestEnemy(me.x, me.y, 7);
      if (enemy && (!leader || Math.hypot(enemy.x - leader.x, enemy.y - leader.y) < 10)) return this.#fight(me, enemy, leader);
    }
    // 3. Follow the leader in formation; catch up when far behind.
    if (leader) {
      const distance = Math.hypot(leader.x - me.x, leader.y - me.y);
      if (distance > 34) {
        this.catchUp(leader.x, leader.y);
        return idle;
      }
      const spot = this.#formationSpot(query, leader);
      if (Math.hypot(spot.x - me.x, spot.y - me.y) > 1.4) return this.#moveTo(me, spot.x, spot.y, idle);
    }
    this.#stuckTimer = 0;
    return idle;
  }

  /**
   * This companion's place in the formation around its leader: on its own
   * side at its own distance (FOLLOW_SPREAD by slot), turned toward open
   * ground when a wall or tree stands there, so a party in a narrow street
   * strings out along it instead of piling onto the leader.
   */
  #formationSpot(query: ReturnType<World["query"]>, leader: { x: number; y: number }): { x: number; y: number } {
    const at = (angle: number) => ({ x: leader.x + Math.cos(angle) * this.#follow, y: leader.y + Math.sin(angle) * this.#follow });
    for (let k = 0; k < 8; k++) {
      const turn = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1) * (Math.PI / 4);
      const spot = at(this.#formation + turn);
      if (query.walkable(spot.x, spot.y)) return spot;
    }
    return at(this.#formation);
  }

  /** How many standing companions are nearer to `ally` than this one (ties go to the lower id). */
  #nearer(query: ReturnType<World["query"]>, ally: { x: number; y: number }, distance: number): number {
    let n = 0;
    for (const bot of this.#channel.bots.values()) {
      if (bot.id === this.id) continue;
      const other = query.player(bot.id);
      if (!other || other.downed) continue;
      const d = Math.hypot(ally.x - other.x, ally.y - other.y);
      if (d < distance || (d === distance && bot.id < this.id)) n++;
    }
    return n;
  }

  /** The nearest human: the one this companion follows and fights beside. */
  #leader(query: ReturnType<World["query"]>): { id: number; x: number; y: number } | null {
    let best: { id: number; x: number; y: number } | null = null;
    let bestDistance = Infinity;
    const me = query.player(this.id);
    for (const session of this.#channel.sessions.values()) {
      const player = query.player(session.id);
      if (!player || !me) continue;
      const distance = Math.hypot(player.x - me.x, player.y - me.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { id: session.id, x: player.x, y: player.y };
      }
    }
    return best;
  }

  #fight(me: { x: number; y: number }, enemy: { x: number; y: number }, ward: { x: number; y: number } | null): PlayerInput {
    const dx = enemy.x - me.x;
    const dy = enemy.y - me.y;
    const distance = Math.hypot(dx, dy) || 1;
    const input: PlayerInput = {
      mx: 0,
      my: 0,
      attack: false,
      shoot: false,
      dodge: false,
      skill: 0,
      interact: false,
      ax: dx,
      ay: dy,
    };
    this.#skillTimer -= THINK_EVERY;
    if (this.#skillTimer <= 0) {
      this.#skillTimer = this.#rng.range(SKILL_EVERY[0], SKILL_EVERY[1]);
      input.skill = this.#rng.int(1, 2);
    }
    if (this.#archer) {
      if (distance < 3.5) {
        input.mx = -dx / distance;
        input.my = -dy / distance;
      } else if (distance > 7) {
        input.mx = dx / distance;
        input.my = dy / distance;
      } else input.shoot = this.#rng.chance(0.85);
      return this.#unstick(me, input);
    }
    // Close in on the enemy's far side from whoever this companion protects
    // (`ward`: its leader in the field, or a fallen ally it covers), fanned
    // out by its formation slot; in a battle (no ward) on its own formation
    // side, so it is not drawn off a post the battle holds. Either way
    // companions ring a foe instead of piling onto it from the hero's side,
    // and their bodies and name plates do not stack on the hero.
    const fan = (this.#formation / (Math.PI * 2) - 0.5) * SURROUND_FAN;
    const side = ward ? Math.atan2(enemy.y - ward.y, enemy.x - ward.x) + fan : this.#formation;
    const sx = enemy.x + Math.cos(side) * SURROUND - me.x;
    const sy = enemy.y + Math.sin(side) * SURROUND - me.y;
    const gap = Math.hypot(sx, sy);
    if (gap > 0.35 && distance > 1.0) {
      input.mx = sx / gap;
      input.my = sy / gap;
    }
    input.attack = distance < 1.8;
    return this.#unstick(me, input);
  }

  #moveTo(me: { x: number; y: number }, x: number, y: number, base: PlayerInput): PlayerInput {
    const dx = x - me.x;
    const dy = y - me.y;
    const distance = Math.hypot(dx, dy) || 1;
    return this.#unstick(me, { ...base, mx: dx / distance, my: dy / distance });
  }

  /** Detects being stuck on terrain and sidesteps for a moment. */
  #unstick(me: { x: number; y: number }, input: PlayerInput): PlayerInput {
    const moved = Math.hypot(me.x - this.#last.x, me.y - this.#last.y);
    this.#last = { x: me.x, y: me.y };
    const wantsMove = Math.hypot(input.mx, input.my) > 0.1;
    if (this.#nudge.time > 0) {
      this.#nudge.time -= THINK_EVERY;
      return { ...input, mx: this.#nudge.x, my: this.#nudge.y };
    }
    if (wantsMove && moved < 0.05) this.#stuckTimer += THINK_EVERY;
    else this.#stuckTimer = 0;
    if (this.#stuckTimer > 0.8) {
      this.#stuckTimer = 0;
      const side = this.#rng.chance(0.5) ? 1 : -1;
      this.#nudge = { x: -input.my * side, y: input.mx * side, time: 0.8 };
    }
    return input;
  }
}
