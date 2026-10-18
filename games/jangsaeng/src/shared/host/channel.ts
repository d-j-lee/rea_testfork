// An era channel: one World for one chapter shard, the humans standing in it,
// and simulated companions. Routes world hooks to sessions and fans out
// snapshots, effects, chat and the shared 공동 실록 gauge.
import type { ContentIndex } from "../content/index.ts";
import type { BattleDef, ChapterDef, EnemyDef } from "../content/schema.ts";
import type { GameMap } from "../map/generate.ts";
import type { ServerMsg } from "../protocol.ts";
import { createRng, type Rng } from "../rng.ts";
import { World } from "../sim/world.ts";
import type { FxEvent, Marker, RosterEntry, SelfView } from "../types.ts";
import { Bot } from "./bots.ts";
import type { Session } from "./session.ts";

export interface ChannelServices {
  readonly content: ContentIndex;
  readonly map: GameMap;
  readonly seed: string;
  readonly mode: "online" | "offline";
  readonly botsPerChannel: number;
  nextId(): number;
  log(line: string): void;
}

const FX_RADIUS = 30;
/** Snapshot cadence in ticks: 20 Hz in-page (free), 10 Hz over the network. */
const SNAP_EVERY = { offline: 1, online: 2 } as const;

export class Channel {
  readonly key: string;
  readonly label: string;
  readonly chapter: ChapterDef;
  readonly world: World;
  readonly sessions = new Map<number, Session>();
  readonly bots = new Map<number, Bot>();
  worldEventProgress = 0;
  emptyFor = 0;
  readonly #services: ChannelServices;
  readonly #rng: Rng;
  #ticks = 0;
  #chatterTimer = 45;
  #simulatedTimer = 20;
  #worldEventDone = false;

  constructor(services: ChannelServices, chapter: ChapterDef, shard: number) {
    this.#services = services;
    this.chapter = chapter;
    this.key = `${chapter.id}#${shard}`;
    this.label = `${chapter.title} · ${shard}채널`;
    this.#rng = createRng(`${services.seed}:${this.key}`);
    this.world = new World({
      content: services.content,
      chapter,
      map: services.map,
      year: chapter.steps[0]?.year ?? chapter.years[0],
      seed: `${services.seed}:${this.key}`,
      hooks: {
        onKill: (enemy, level, boss, killers) => this.#onKill(enemy, level, boss, killers),
        onBattleEnd: (battleId, result, participants) => this.#onBattleEnd(battleId, result, participants),
        onTalk: (playerId, npcId) => this.sessions.get(playerId)?.onTalk(npcId),
        onPickup: (playerId, item) => this.sessions.get(playerId)?.onPickup(item),
        onDowned: (playerId) => {
          this.sessions.get(playerId)?.onDowned();
          this.bots.get(playerId)?.onDowned();
          for (const bot of this.bots.values()) bot.onAllyDowned(playerId);
        },
        onRevived: (playerId, by) => this.#onRevived(playerId, by),
        onLongevity: (playerId) => this.sessions.get(playerId)?.onLongevity(),
        npcMarker: (playerId, npcId): Marker | undefined => this.sessions.get(playerId)?.markerFor(npcId),
      },
    });
  }

  get humans(): number {
    return this.sessions.size;
  }

  // ── Membership ─────────────────────────────────────────────────────────

  add(session: Session): void {
    const start = this.#startPosition(session);
    session.channel = this;
    this.sessions.set(session.id, session);
    this.world.addPlayer(session.playerSpec(start.x, start.y));
    this.emptyFor = 0;
    this.#fillBots();
    session.begin();
    this.broadcastRoster();
    this.#system(`${session.save.name} 님이 ${this.chapter.title}의 시대에 들어섰다.`);
  }

  remove(session: Session): void {
    if (!this.sessions.delete(session.id)) return;
    this.world.removePlayer(session.id);
    session.channel = null;
    if (this.sessions.size === 0) {
      for (const bot of this.bots.values()) this.world.removePlayer(bot.id);
      this.bots.clear();
    }
    this.updateStep();
    this.broadcastRoster();
  }

  #startPosition(session: Session): { x: number; y: number } {
    const save = session.save;
    const siteId = save.exile ?? (save.position ? null : this.chapter.start.site);
    if (!siteId && save.position) return { ...save.position };
    const site = this.#services.map.sites.find((candidate) => candidate.id === siteId);
    const [dx, dy] = save.exile ? [0, 0] : (this.chapter.start.offset ?? [0, 0]);
    return site ? { x: site.x + 0.5 + dx, y: site.y + 1.5 + dy } : { x: 90, y: 150 };
  }

  #fillBots(): void {
    const personas = this.#services.content.companions.personas;
    const target = Math.min(this.#services.botsPerChannel, this.chapter.companions, personas.length);
    const leader = [...this.sessions.values()][0];
    const anchor = leader ? this.world.playerStatus(leader.id) : null;
    if (!anchor) return;
    const used = new Set([...this.bots.values()].map((bot) => bot.persona.name));
    const order = personas.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.#rng.int(0, i);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    for (const index of order) {
      if (this.bots.size >= target) break;
      const persona = personas[index];
      if (!persona || used.has(persona.name)) continue;
      const level = Math.max(1, this.#averageLevel() + this.#rng.int(-2, 2));
      const angle = this.#rng.range(0, Math.PI * 2);
      const bot = new Bot(this.#services.nextId(), persona, level, this, this.#services.content, this.#rng.int(1, 1e9));
      this.bots.set(bot.id, bot);
      this.world.addPlayer(bot.spec(anchor.x + Math.cos(angle) * 3, anchor.y + Math.sin(angle) * 3));
    }
  }

  #averageLevel(): number {
    let total = 0;
    for (const session of this.sessions.values()) total += session.save.level;
    return Math.round(total / Math.max(1, this.sessions.size));
  }

  updateStep(): void {
    let maxStep = 0;
    for (const session of this.sessions.values()) maxStep = Math.max(maxStep, session.save.step);
    const step = this.chapter.steps[Math.min(maxStep, this.chapter.steps.length - 1)];
    if (step) this.world.setStep(step.id);
  }

  // ── Battles ────────────────────────────────────────────────────────────

  battleCentre(def: BattleDef): { x: number; y: number } | null {
    const site = this.world.sitePosition(def.site);
    if (!site) return null;
    const [dx, dy] = def.offset ?? [0, 0];
    return { x: site.x + dx, y: site.y + dy };
  }

  startBattle(battleId: string, session: Session, fromStory: boolean): boolean {
    const def = this.chapter.battles.find((candidate) => candidate.id === battleId);
    if (!def) return false;
    if (this.world.battleView()) {
      if (fromStory) session.send({ t: "toast", text: "다른 전투가 이미 벌어지고 있다.", tone: "warn" });
      return false;
    }
    const centre = this.battleCentre(def);
    const status = this.world.playerStatus(session.id);
    if (fromStory && centre && status && Math.hypot(centre.x - status.x, centre.y - status.y) > def.radius) {
      this.world.teleport(session.id, centre.x, centre.y + Math.min(3, def.radius / 2));
      for (const bot of this.bots.values()) bot.catchUp(centre.x, centre.y);
    }
    const started = this.world.startBattle(battleId, session.id);
    if (started) {
      for (const bot of this.bots.values()) bot.onBattleStart();
      for (const member of this.sessions.values())
        member.send({ t: "toast", text: `${def.title}${def.subtitle ? ` — ${def.subtitle}` : ""}`, tone: "epic" });
      if (def.intro?.length)
        for (const line of def.intro) this.#broadcast({ t: "chat", from: def.title, text: line, kind: "system" });
    }
    return started;
  }

  /** Resolves a battle for sessions bound to it (world end or demo skip). */
  endBattle(def: BattleDef, result: "victory" | "defeat", participants?: readonly number[]): void {
    const centre = this.battleCentre(def);
    for (const session of this.sessions.values()) {
      const status = this.world.playerStatus(session.id);
      const near =
        centre && status ? Math.hypot(centre.x - status.x, centre.y - status.y) <= def.radius + 12 : false;
      if (participants?.includes(session.id) || near || !participants) session.onBattleEnd(def, result);
    }
    if (result === "victory") {
      this.addWorldEvent(def.great ? 3 : 1);
      for (const bot of this.bots.values()) bot.onVictory();
    }
  }

  #onBattleEnd(battleId: string, result: "victory" | "defeat", participants: readonly number[]): void {
    const def = this.chapter.battles.find((candidate) => candidate.id === battleId);
    if (def) this.endBattle(def, result, participants);
  }

  #onKill(enemy: EnemyDef, level: number, boss: boolean, killers: readonly number[]): void {
    const credited = new Set<number>();
    for (const id of killers) {
      const session = this.sessions.get(id);
      if (session && !credited.has(id)) {
        credited.add(id);
        session.onKill(enemy, level, boss);
      }
    }
    if (this.world.battleView() && this.#rng.chance(0.15)) this.addWorldEvent(1);
  }

  #onRevived(playerId: number, by: number | null): void {
    const reviver = by === null ? null : (this.sessions.get(by)?.save.name ?? this.bots.get(by)?.persona.name ?? null);
    this.sessions.get(playerId)?.onRevived(reviver);
    this.bots.get(playerId)?.onRevived();
    if (by !== null) {
      this.sessions.get(by)?.onRevivedOther();
      this.bots.get(by)?.onRevivedSomeone();
    }
  }

  // ── 공동 실록 ──────────────────────────────────────────────────────────

  addWorldEvent(amount: number): void {
    const event = this.chapter.worldEvent;
    if (!event || this.#worldEventDone) return;
    this.worldEventProgress = Math.min(event.goal, this.worldEventProgress + amount);
    if (this.worldEventProgress >= event.goal) {
      this.#worldEventDone = true;
      for (const session of this.sessions.values()) {
        const flags = session.save.flags;
        if (!flags[`zeitgeist:${this.chapter.id}`]) {
          flags[`zeitgeist:${this.chapter.id}`] = true;
          flags.zeitgeist = Math.min(5, Number(flags.zeitgeist ?? 0) + 1);
        }
        session.send({ t: "toast", text: `공동 실록 「${event.title}」 달성 — 시대정신 +1`, tone: "epic" });
      }
      this.#system(`공동 실록 「${event.title}」이(가) 완성되었다.`);
    }
  }

  worldEventView(): SelfView["worldEvent"] | undefined {
    const event = this.chapter.worldEvent;
    if (!event) return undefined;
    return { title: event.title, desc: event.desc, progress: this.worldEventProgress / Math.max(1, event.goal) };
  }

  channelInfo(): SelfView["channel"] {
    return { id: this.key, name: this.label, players: this.sessions.size, companions: this.bots.size };
  }

  // ── Chat and broadcast ─────────────────────────────────────────────────

  broadcastChat(from: string, text: string, kind: "player" | "bot" | "system" | "npc"): void {
    this.#broadcast({ t: "chat", from, text, kind });
  }

  #system(text: string): void {
    this.#broadcast({ t: "chat", from: "알림", text, kind: "system" });
  }

  broadcastRoster(): void {
    const players: RosterEntry[] = [
      ...[...this.sessions.values()].map((session) => ({
        name: session.save.name,
        kind: "player" as const,
        level: session.save.level,
        title: session.save.titles[session.save.titles.length - 1] ?? "장생인",
      })),
      ...[...this.bots.values()].map((bot) => ({
        name: bot.persona.name,
        kind: "bot" as const,
        level: bot.level,
        title: bot.persona.title,
      })),
    ];
    this.#broadcast({ t: "roster", players });
  }

  #broadcast(message: ServerMsg): void {
    for (const session of this.sessions.values()) session.send(message);
  }

  // ── Tick ───────────────────────────────────────────────────────────────

  tick(dt: number): void {
    if (this.sessions.size === 0) {
      this.emptyFor += dt;
      return;
    }
    this.#ticks++;
    for (const bot of this.bots.values()) bot.think(dt, this.world);
    this.world.tick(dt);
    const fx = this.world.drainFx();
    if (fx.length) this.#sendFx(fx);
    if (this.#ticks % SNAP_EVERY[this.#services.mode] === 0)
      for (const session of this.sessions.values()) {
        const snap = this.world.snapshotFor(session.id);
        session.send({ t: "snap", tick: this.#ticks, ents: snap.ents, gone: snap.gone });
      }
    for (const session of [...this.sessions.values()]) session.tick(dt);
    this.#ambient(dt);
  }

  #sendFx(fx: FxEvent[]): void {
    for (const session of this.sessions.values()) {
      const status = this.world.playerStatus(session.id);
      if (!status) continue;
      const near = fx.filter(
        (event) => event.k === "shake" || event.k === "hitstop"
          ? Math.hypot(event.x - status.x, event.y - status.y) <= 14
          : Math.hypot(event.x - status.x, event.y - status.y) <= FX_RADIUS,
      );
      if (near.length) session.send({ t: "fx", fx: near });
    }
  }

  #ambient(dt: number): void {
    const lines = this.#services.content.companions.lines;
    this.#chatterTimer -= dt;
    if (this.#chatterTimer <= 0 && this.bots.size) {
      this.#chatterTimer = this.#rng.range(55, 120);
      const bots = [...this.bots.values()];
      const bot = this.#rng.pick(bots);
      const chapterLines = lines.byChapter[this.chapter.id] ?? [];
      const pool = chapterLines.length && this.#rng.chance(0.6) ? chapterLines : lines.idle;
      if (pool.length) bot.say(this.#rng.pick(pool));
    }
    if (this.#services.mode === "offline" && this.chapter.worldEvent) {
      this.#simulatedTimer -= dt;
      if (this.#simulatedTimer <= 0) {
        this.#simulatedTimer = this.#rng.range(15, 30);
        this.addWorldEvent(1);
      }
    }
  }

  say(bot: Bot, text: string): void {
    this.#broadcast({ t: "chat", from: bot.persona.name, text, kind: "bot" });
  }
}
