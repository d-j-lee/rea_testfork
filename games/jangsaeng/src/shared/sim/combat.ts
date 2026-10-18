// Damage resolution: one owner for the formula, poise, credit, knockback,
// i-frames/parry/guard checks, deaths, downing and revives.
//   damage = power × coef × 100/(100 + def·4) × crit(1.6) × variance(0.95–1.05)
// where power = weaponAtk × (melee|bow|skill multiplier) for players and the
// level-scaled atk for enemies.
import { moveBody } from "./physics.ts";
import { releaseToken, releaseTokensOn, spawnDrops } from "./entities.ts";
import {
  C,
  COLOR,
  emit,
  feel,
  floatText,
  inFront,
  isDowned,
  later,
  setAnim,
  sound,
  type Actor,
  type DamageKind,
  type HitSource,
  type Sim,
} from "./state.ts";

export function sourceOf(sim: Sim, a: Actor, kind: DamageKind): HitSource {
  const buff = a.buffUntil > sim.time ? 1.15 : 1;
  let power = 0;
  let crit = 0;
  if (a.pl) {
    const d = a.pl.derived;
    const mult = kind === "melee" ? d.melee : kind === "bow" ? d.bow : kind === "skill" ? d.skill : 1;
    power = d.weaponAtk * mult * buff;
    crit = d.critChance;
  } else if (a.en) power = a.en.atk * buff;
  else if (a.fi) power = a.fi.atk * buff;
  return { owner: a.id, side: a.side, power, crit, player: a.pl !== null, x: a.x, y: a.y };
}

export interface HitOpts {
  coef: number;
  heavy?: boolean;
  /** Knockback distance in tiles. */
  knock?: number;
  sfx?: "blade" | "arrow" | "bullet" | "blast" | "fire";
  burn?: number;
  poiseBreak?: boolean;
  forceCrit?: boolean;
  /** Direction source for front checks (defaults to the attacker). */
  fromX?: number;
  fromY?: number;
  /** No hitstop/shake (damage over time). */
  quiet?: boolean;
}

const KNOCK = 9;

/** Applies one hit; returns the damage dealt (0 when avoided). */
export function hit(sim: Sim, src: HitSource, target: Actor, o: HitOpts): number {
  const t = sim.time;
  if (!target.alive || target.removed || isDowned(target) || target.side === src.side) return 0;
  if (target.side === "none") return 0;
  const battle = sim.battle;
  if (battle && battle.def.kind === "duel") {
    // Duels are one-on-one both ways.
    if (target.en?.battle && src.owner !== battle.starter) return 0;
    if (target.pl && target.id !== battle.starter && sim.actors.get(src.owner)?.en?.battle) return 0;
  }
  const fromX = o.fromX ?? src.x;
  const fromY = o.fromY ?? src.y;
  const pl = target.pl;
  if (pl) {
    const sinceRoll = t - pl.rollStart;
    if (sinceRoll >= C.IFRAME_FROM && sinceRoll <= C.IFRAME_TO) {
      dodged(sim, target, sinceRoll);
      return 0;
    }
    if (target.invulnUntil > t) return 0;
    if (pl.parryUntil > t && inFront(target, fromX, fromY, Math.PI / 2.5)) {
      blocked(sim, target);
      return 0;
    }
  } else if (target.invulnUntil > t) return 0;
  const boss = target.en?.boss;
  if (boss?.guard && inFront(target, fromX, fromY, (70 * Math.PI) / 180)) {
    blocked(sim, target);
    return 0;
  }
  const attacker = sim.actors.get(src.owner);
  const forced = o.forceCrit === true || (attacker?.pl?.critNext ?? false);
  const crit = src.player && (forced || (src.crit > 0 && sim.rng.next() < src.crit));
  if (crit && attacker?.pl) attacker.pl.critNext = false;
  let damage = src.power * o.coef * (100 / (100 + target.def * 4)) * sim.rng.range(0.95, 1.05);
  if (crit) damage *= C.CRIT;
  if (target.stunUntil > t) damage *= C.STUN_BONUS;
  let shielded = false;
  if (target.en?.def.behavior === "shield" && inFront(target, fromX, fromY, Math.PI / 3)) {
    damage *= 0.3;
    shielded = true;
  }
  const amount = Math.max(1, Math.round(damage));
  if (!target.immortal) target.hp -= amount;
  target.lastHurt = t;
  // Feedback.
  const color = pl ? COLOR.hurt : crit ? COLOR.crit : COLOR.normal;
  floatText(sim, target.x, target.y, String(amount), color, crit);
  emit(sim, { k: "spark", x: target.x, y: target.y, color: shielded ? COLOR.block : crit ? COLOR.crit : undefined });
  if (shielded) sound(sim, "block", target.x, target.y);
  else if (pl) sound(sim, "hurt", target.x, target.y);
  else if (crit) sound(sim, "crit", target.x, target.y);
  else if (o.sfx === "arrow") sound(sim, "arrow_hit", target.x, target.y);
  else sound(sim, o.heavy ? "hit_heavy" : "hit", target.x, target.y);
  if (!o.quiet) {
    if (src.player) {
      const heavy = o.heavy === true;
      feel(sim, src.owner, target.x, target.y, heavy ? 100 : crit ? 80 : 50, heavy || crit ? 2 : 1);
    } else if (pl) feel(sim, target.id, target.x, target.y, o.heavy ? 60 : 0, o.heavy ? 4 : 2);
  }
  // Knockback (bosses and shield bearers hold their ground).
  const knock = o.knock ?? 0;
  if (knock > 0 && target.en?.def.behavior !== "boss" && !target.defend) {
    const dx = target.x - fromX;
    const dy = target.y - fromY;
    const l = Math.hypot(dx, dy) || 1;
    const scale = target.en?.def.behavior === "brute" || target.en?.def.behavior === "shield" ? 0.4 : 1;
    target.kx += (dx / l) * knock * KNOCK * scale;
    target.ky += (dy / l) * knock * KNOCK * scale;
  }
  if (o.burn && o.burn > 0) {
    target.burnUntil = t + o.burn;
    target.burnDps = Math.max(1, src.power * o.coef * 0.2);
    target.burnOwner = src.owner;
    if (target.burnNext < t) target.burnNext = t + 0.5;
  }
  if (attacker?.pl) {
    const p = attacker.pl;
    p.energy = Math.min(p.derived.maxEnergy, p.energy + C.ENERGY_PER_HIT);
    p.lastCombat = t;
  }
  if (pl) pl.lastCombat = t;
  const en = target.en;
  if (en) {
    if (src.player) {
      const i = en.credit.findIndex((c) => c.id === src.owner);
      if (i >= 0) en.credit.splice(i, 1);
      en.credit.unshift({ id: src.owner, at: t });
    }
    if (en.state === "idle" || en.state === "alert") {
      en.target = src.owner;
      en.state = "chase";
      target.markUntil = t + 0.6;
    }
    en.poise -= amount * 0.5;
    if (o.poiseBreak) en.poise = 0;
    if (en.poise <= 0 && target.stunUntil <= t && target.hp > 0) stun(sim, target);
  }
  if (target.hp <= 0 && !target.immortal) {
    if (pl) downPlayer(sim, target);
    else kill(sim, target, src);
  } else if (!pl && target.anim !== "attack" && target.anim !== "shoot" && target.anim !== "cast") {
    setAnim(sim, target, "hurt", Math.max(target.animUntil, t + 0.15));
  }
  return amount;
}

function dodged(sim: Sim, target: Actor, sinceRoll: number): void {
  const pl = target.pl;
  if (!pl || pl.perfectUsed) return;
  pl.perfectUsed = true;
  if (sinceRoll <= C.PERFECT_DODGE) {
    pl.critNext = true;
    pl.energy = Math.min(pl.derived.maxEnergy, pl.energy + 15);
    floatText(sim, target.x, target.y, "완벽 회피", COLOR.perfect, true);
    emit(sim, { k: "hitstop", x: target.x, y: target.y, power: 250 });
  } else floatText(sim, target.x, target.y, "회피", COLOR.dodge);
}

function blocked(sim: Sim, target: Actor): void {
  floatText(sim, target.x, target.y, "막음", COLOR.block);
  emit(sim, { k: "spark", x: target.x, y: target.y, color: COLOR.block });
  sound(sim, "block", target.x, target.y);
}

export function stun(sim: Sim, a: Actor): void {
  const en = a.en;
  if (!en) return;
  a.stunUntil = sim.time + C.STUN;
  en.stunned = true;
  en.act = null;
  en.poise = 0;
  setAnim(sim, a, "hurt", a.stunUntil);
  floatText(sim, a.x, a.y, "경직", COLOR.crit);
  sound(sim, "hit_heavy", a.x, a.y);
}

/** Player ids credited for a kill: damaged it within 10 s, most recent first. */
export function killers(sim: Sim, a: Actor): number[] {
  const en = a.en;
  if (!en) return [];
  return en.credit.filter((c) => sim.time - c.at <= C.CREDIT_SECONDS).map((c) => c.id);
}

export function kill(sim: Sim, a: Actor, src: HitSource | null): void {
  if (!a.alive) return;
  a.alive = false;
  a.hp = 0;
  a.diedAt = sim.time;
  a.removeAt = sim.time + C.CORPSE;
  a.moving = false;
  a.burnUntil = 0;
  setAnim(sim, a, "dead");
  const en = a.en;
  if (en) {
    en.act = null;
    releaseToken(sim, a);
    sound(sim, "enemy_death", a.x, a.y);
    const boss = en.boss !== null;
    if (src?.player) feel(sim, src.owner, a.x, a.y, boss ? 200 : 65, boss ? 5 : 1);
    if (boss) emit(sim, { k: "smoke", x: a.x, y: a.y });
    spawnDrops(sim, a);
    const credited = killers(sim, a);
    const def = en.def;
    const level = en.level;
    later(sim, () => sim.hooks.onKill(def, level, boss, credited));
  } else {
    releaseTokensOn(sim, a.id);
    sound(sim, a.defend ? "explosion" : "death", a.x, a.y);
    if (a.defend) emit(sim, { k: "explosion", x: a.x, y: a.y });
  }
}

export function downPlayer(sim: Sim, a: Actor): void {
  const pl = a.pl;
  if (!pl || pl.downedAt >= 0) return;
  a.hp = 0;
  pl.downedAt = sim.time;
  pl.downEnd = sim.time + pl.derived.downSeconds;
  pl.revive = 0;
  pl.cast = null;
  pl.drawStart = -1;
  pl.swingEnd = sim.time;
  pl.rollEnd = 0;
  a.moving = false;
  a.burnUntil = 0;
  setAnim(sim, a, "dead");
  releaseTokensOn(sim, a.id);
  sound(sim, "death", a.x, a.y);
  const id = a.id;
  later(sim, () => sim.hooks.onDowned(id));
}

/**
 * Gets a downed player up with `ratio` of their max HP and a moment of
 * invulnerability. No hook: a revive reports itself (revivePlayer); a lost
 * battle's withdrawal is reported as the defeat (sim/battle.ts withdraw).
 * False when `a` was not down.
 */
export function standUp(sim: Sim, a: Actor, ratio: number): boolean {
  const pl = a.pl;
  if (!pl || pl.downedAt < 0) return false;
  pl.downedAt = -1;
  pl.revive = 0;
  a.hp = Math.max(1, Math.round(a.maxHp * ratio));
  a.invulnUntil = sim.time + 1.5;
  setAnim(sim, a, "idle");
  emit(sim, { k: "heal", x: a.x, y: a.y });
  floatText(sim, a.x, a.y, `+${a.hp}`, COLOR.heal);
  sound(sim, "heal", a.x, a.y);
  return true;
}

/** A revive by an ally (`by`) or by the player themself (null): stands them up and tells the host (WorldHooks.onRevived). */
export function revivePlayer(sim: Sim, a: Actor, ratio: number, by: number | null): void {
  if (!standUp(sim, a, ratio)) return;
  const id = a.id;
  later(sim, () => sim.hooks.onRevived(id, by));
}

/** Damage over time from fire; ticks every 0.5 s. */
export function tickBurn(sim: Sim, a: Actor): void {
  if (a.burnUntil <= sim.time || sim.time < a.burnNext) return;
  a.burnNext = sim.time + 0.5;
  if (!a.alive || isDowned(a) || a.immortal) return;
  const amount = Math.max(1, Math.round(a.burnDps * 0.5));
  a.hp -= amount;
  floatText(sim, a.x, a.y, String(amount), COLOR.burn);
  if (a.hp <= 0) {
    const owner = sim.actors.get(a.burnOwner);
    if (a.pl) downPlayer(sim, a);
    else kill(sim, a, owner ? sourceOf(sim, owner, "skill") : null);
  }
}

/** Integrates knockback velocity (exponential decay). */
export function applyKnock(sim: Sim, a: Actor, dt: number): void {
  if (Math.abs(a.kx) < 0.05 && Math.abs(a.ky) < 0.05) {
    a.kx = 0;
    a.ky = 0;
    return;
  }
  moveBody(sim.grid, a, a.kx * dt, a.ky * dt);
  const decay = Math.exp(-12 * dt);
  a.kx *= decay;
  a.ky *= decay;
}
