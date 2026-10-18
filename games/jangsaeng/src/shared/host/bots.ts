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
  #focus: number | null = null;

  constructor(
    id: number,
    persona: CompanionPersona,
    level: number,
    channel: Channel,
    content: ContentIndex,
    seed: number,
  ) {
    this.id = id;
    this.persona = persona;
    this.level = level;
    this.#channel = channel;
    this.#content = content;
    this.#rng = createRng(seed);
    this.#archer = persona.sprite.includes("archer") || persona.style === "cautious";
    this.#greetIn = this.#rng.range(2, 9);
    this.#formation = this.#rng.range(0, Math.PI * 2);
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

  say(text: string): void {
    this.#channel.say(this, text);
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
    const angle = this.#rng.range(0, Math.PI * 2);
    this.#channel.world.teleport(this.id, x + Math.cos(angle) * 3, y + Math.sin(angle) * 3);
  }

  think(dt: number, world: World): void {
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
      if (enemy) return this.#fight(me, enemy);
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
      const enemy =
        query.nearestEnemy(me.x, me.y, SELF_DEFENCE) ??
        query.nearestEnemy(leader.x, leader.y, GUARD_RADIUS) ??
        (post ? query.nearestEnemy(post.x, post.y, POST_GUARD) : null) ??
        query.enemyAiming([this.id, leader.id], me.x, me.y, RETURN_FIRE);
      if (enemy) return this.#fight(me, enemy);
    } else if (inBattle) {
      const enemy = query.nearestEnemy(me.x, me.y, 12);
      if (enemy) return this.#fight(me, enemy);
      if (Math.hypot(battle.x - me.x, battle.y - me.y) > battle.radius * 0.6) return this.#moveTo(me, battle.x, battle.y, idle);
    } else {
      const enemy = query.nearestEnemy(me.x, me.y, 7);
      if (enemy && (!leader || Math.hypot(enemy.x - leader.x, enemy.y - leader.y) < 10)) return this.#fight(me, enemy);
    }
    // 3. Follow the leader in formation; catch up when far behind.
    if (leader) {
      const distance = Math.hypot(leader.x - me.x, leader.y - me.y);
      if (distance > 34) {
        this.catchUp(leader.x, leader.y);
        return idle;
      }
      const tx = leader.x + Math.cos(this.#formation) * 2.6;
      const ty = leader.y + Math.sin(this.#formation) * 2.6;
      if (Math.hypot(tx - me.x, ty - me.y) > 1.4) return this.#moveTo(me, tx, ty, idle);
    }
    this.#stuckTimer = 0;
    return idle;
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

  #fight(me: { x: number; y: number }, enemy: { x: number; y: number }): PlayerInput {
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
    if (distance > 1.1) {
      input.mx = dx / distance;
      input.my = dy / distance;
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
