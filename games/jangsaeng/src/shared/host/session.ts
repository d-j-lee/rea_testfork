// One connected human: owns their PlayerSave and runs their personal story
// (chapter steps, objectives, prompts, passage of years, ending) on top of
// the shared era channel they currently stand in.
import type { ContentIndex } from "../content/index.ts";
import { nextChapter } from "../content/index.ts";
import type {
  BattleDef,
  ChapterDef,
  ChapterId,
  Effect,
  EnemyDef,
  ObjectiveDef,
  PromptDef,
  StepDef,
} from "../content/schema.ts";
import type { GameMap } from "../map/generate.ts";
import type { ClientMsg, PlayerAction, ServerMsg } from "../protocol.ts";
import {
  advanceStepYear,
  advanceYears,
  allocatePoint,
  applyEffects,
  battleResult,
  completeWorldEvent,
  computeEnding,
  derived,
  equipItem,
  evalCond,
  heroSprite,
  LONGEVITY_MAX_PER_CHAPTER,
  longevityBlocker,
  reviveVirtue,
  selfRevive,
  slotSkill,
  suggestName,
  useItem,
  useLongevity,
  yearsPlan,
  type EffectOutcome,
  type YearsChoice,
} from "../rules/index.ts";
import type { PlayerInput, PlayerSpec } from "../sim/world.ts";
import type { Marker, ObjectiveView, PendingStory, PlayerSave, PromptView, ResultView } from "../types.ts";
import type { Channel } from "./channel.ts";
import { sanitizeChat, sanitizeName } from "./parse.ts";
import { chapterView, endingView, promptView, selfView } from "./views.ts";

export interface SessionServices {
  readonly content: ContentIndex;
  readonly map: GameMap;
  readonly mode: "online" | "offline";
  save(token: string, save: PlayerSave): void;
  /** Moves the session to the channel of save.chapter and starts it there. */
  relocate(session: Session): void;
  log(line: string): void;
}

/**
 * `year`: the story year when the card was raised (shown on it even if the step moves on first).
 * `step`: the step index when it was raised.
 * `pending`: its entry in save.pending, which keeps the card across a reload.
 */
type Queued = (
  | { type: "def"; id: string; onDone?: () => void }
  | { type: "notice"; id: string; title: string; body: string[]; onDone?: () => void }
  | { type: "result"; id: string; title: string; lines: ResultView["lines"]; onDone?: () => void }
  | { type: "years"; id: string; next: ChapterId }
  | { type: "escape"; id: string }
  | { type: "inquiry"; id: string }
) & { year?: number; step?: number; pending?: PendingStory };

type Active = Queued & { view: PromptView };

/**
 * The years plan as the client sends it. `grace` (노인성의 마지막 은혜, only when
 * the player turns it on) rides on the same message.
 */
type YearsMessage = Extract<ClientMsg, { t: "years" }> & { grace?: boolean };

/** The 사사 위기 card for the sentence `<chapter>:<year>` (save.pending id). */
const escapeCardId = (sentence: string): string => `escape:${sentence}`;

/** Demo skip moves the presenter only when the next objective is farther than this (tiles). */
const DEMO_NEAR = 8;
/** Most 건너뛰기 presses a demo entry may take to reach its step (guards malformed content). */
const DEMO_ENTRY_PRESSES = 2000;

const IDLE_INPUT: PlayerInput = {
  mx: 0,
  my: 0,
  attack: false,
  shoot: false,
  dodge: false,
  skill: 0,
  interact: false,
};

let promptSerial = 0;
const serial = (prefix: string) => `${prefix}-${++promptSerial}`;

export class Session {
  readonly id: number;
  readonly token: string;
  save: PlayerSave;
  channel: Channel | null = null;
  readonly #send: (message: ServerMsg) => void;
  readonly #services: SessionServices;
  #queue: Queued[] = [];
  #active: Active | null = null;
  #selfTimer = 0;
  #selfSignature = "";
  #saveTimer = 0;
  #reachTimer = 0;
  #chatBudget = 3;
  #chatRefill = 0;
  #denyTimer = 0;
  #talkCounter = 0;
  /** Battles started by story effects while a card was up; they start when the queue drains. */
  #heldBattles: string[] = [];
  /** While > 0, queued prompts are not shown (keeps result cards first). */
  #hold = 0;
  #refreshing = false;
  /** Nothing goes to the client (a demo entry plays its skipped steps unseen). */
  #quiet = false;
  closed = false;

  constructor(
    id: number,
    token: string,
    save: PlayerSave,
    send: (message: ServerMsg) => void,
    services: SessionServices,
  ) {
    this.id = id;
    this.token = token;
    this.save = save;
    this.#send = send;
    this.#services = services;
  }

  get content(): ContentIndex {
    return this.#services.content;
  }

  get chapter(): ChapterDef {
    return this.content.chapters[this.save.chapter];
  }

  get step(): StepDef | undefined {
    return this.chapter.steps[this.save.step];
  }

  send(message: ServerMsg): void {
    if (!this.closed && !this.#quiet) this.#send(message);
  }

  /**
   * A settled run (save.ending, also after a reload) takes no more changes:
   * every inbound message but chat and ping, and every world hook the channel
   * routes here, stops at this one gate.
   */
  #settled(): boolean {
    return this.save.ending !== undefined;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Called by the channel after the player entity exists in its world. */
  begin(): void {
    const channel = this.channel;
    if (!channel) return;
    this.send({ t: "enter", you: this.id, chapter: chapterView(this.chapter), channel: channel.label });
    this.#queue = [];
    this.#active = null;
    this.#heldBattles = [];
    if (this.#settled()) {
      this.#sendEnding();
      return;
    }
    this.#restorePending();
    this.#raiseInquiry();
    const enteredFlag = `entered:${this.chapter.id}`;
    if (!this.save.flags[enteredFlag]) {
      this.save.flags[enteredFlag] = true;
      const unlocks: Effect[] = (this.chapter.unlocks ?? []).map((skill) => ({ k: "skill", skill }));
      if (unlocks.length) this.#apply(unlocks);
      if (this.save.exile) {
        this.save.chronicle.push({ year: this.save.year, text: "유배지에서 새 시대를 맞았다.", tone: "bad" });
        this.save.exile = undefined;
      }
      if (this.save.demoEntry !== undefined) this.#playDemoEntry(this.save.demoEntry);
      else this.#enterStep(0, true);
    } else {
      this.#resumeStep();
    }
    channel.updateStep();
    // Nothing queued: battles restored from the save start now.
    if (!this.#settled()) this.#showNext();
    this.#markSelf();
    this.persist();
  }

  /**
   * A cold-open demo (save.demoEntry, from ChapterDef.demoStart) starts at that
   * step. The chapter is entered as always, and the steps before the entry are
   * played by this session's own 건너뛰기: it presses #demoSkip until the story
   * stands at the entry step and every card raised before it is answered — the
   * presses a presenter would make from the first step, so the save holds
   * exactly what they would leave. Nothing is sent meanwhile; the presenter
   * then sees the card the entry step opens with.
   */
  #playDemoEntry(stepId: string): void {
    delete this.save.demoEntry;
    const entry = this.chapter.steps.findIndex((step) => step.id === stepId);
    const behind = () =>
      this.save.step < entry || [this.#active, ...this.#queue].some((item) => item !== null && (item.step ?? entry) < entry);
    this.#quiet = true;
    try {
      this.#enterStep(0, true);
      for (let press = 0; press < DEMO_ENTRY_PRESSES && entry > 0 && behind() && !this.#settled(); press++) this.#demoSkip();
    } finally {
      this.#quiet = false;
    }
    if (entry > 0 && behind()) this.#services.log(`demo entry ${this.chapter.id}/${stepId} stopped at step ${this.save.step}`);
    if (this.#active) this.send({ t: "prompt", prompt: this.#active.view });
  }

  /** Rebuilds the cards and held battles the save still owes (save.pending), in order. */
  #restorePending(): void {
    for (const entry of this.save.pending) {
      if (entry.kind === "battle") this.#heldBattles.push(entry.id);
      else if (entry.kind === "escape") this.#enqueue({ type: "escape", id: escapeCardId(entry.id), pending: entry });
      else this.#enqueue({ type: "def", id: entry.id, pending: entry });
    }
  }

  /** The card or battle is shown or started: the save no longer owes it. */
  #forget(entry: PendingStory): void {
    this.save.pending = this.save.pending.filter((known) => known.kind !== entry.kind || known.id !== entry.id);
  }

  /** The 사헌부 card while flag `inquiry` stands (set by rules settleSuspicion), once in the queue. */
  #raiseInquiry(): void {
    if (this.save.flags.inquiry !== true) return;
    if (this.#active?.type === "inquiry" || this.#queue.some((item) => item.type === "inquiry")) return;
    this.#enqueue({ type: "inquiry", id: serial("inquiry") });
  }

  close(): void {
    if (this.closed) return;
    this.persist();
    this.closed = true;
  }

  // ── Inbound messages ───────────────────────────────────────────────────

  receive(message: ClientMsg): void {
    if (this.#settled() && message.t !== "chat" && message.t !== "ping") return;
    switch (message.t) {
      case "input":
        this.#input(message);
        break;
      case "choose":
        this.#choose(message.prompt, message.option);
        break;
      case "years":
        this.#years(message);
        break;
      case "chat":
        this.#chat(message.text);
        break;
      case "action":
        this.#action(message.action);
        break;
      case "ping":
        this.send({ t: "pong", at: message.at });
        break;
      case "hello":
        break;
    }
  }

  #input(message: Extract<ClientMsg, { t: "input" }>): void {
    const world = this.channel?.world;
    if (!world) return;
    if (this.#active) {
      world.setInput(this.id, IDLE_INPUT);
      return;
    }
    let skill = message.skill;
    if (skill === 5 && !this.#longevityAllowed()) skill = 0;
    const input: PlayerInput = {
      mx: message.mx,
      my: message.my,
      attack: message.attack,
      shoot: message.shoot,
      dodge: message.dodge,
      skill,
      interact: message.interact,
    };
    if (message.ax !== undefined && message.ay !== undefined) {
      input.ax = message.ax;
      input.ay = message.ay;
    }
    world.setInput(this.id, input);
  }

  /** Refuses slot 5 with the rule's reason (the sim slot is disabled by #refreshEntity too). */
  #longevityAllowed(): boolean {
    const reason = longevityBlocker(this.save);
    if (reason && this.#denyTimer <= 0) {
      this.#denyTimer = 2;
      this.send({ t: "toast", text: reason, tone: "warn" });
      this.#fxSelf("sfx", "denied");
    }
    return reason === null;
  }

  #chat(raw: string): void {
    const text = sanitizeChat(raw);
    if (!text || !this.channel) return;
    if (this.#chatBudget <= 0) {
      this.send({ t: "toast", text: "채팅이 너무 빠르다.", tone: "warn" });
      return;
    }
    this.#chatBudget--;
    this.channel.broadcastChat(this.save.name, text, "player");
  }

  // ── Story: steps and objectives ────────────────────────────────────────

  #enterStep(index: number, fresh: boolean): void {
    const step = this.chapter.steps[index];
    if (!step) {
      this.#chapterComplete();
      return;
    }
    this.save.step = index;
    if (fresh) this.save.objectives = {};
    const yearBefore = this.save.year;
    const passing = advanceStepYear(this.content, this.save, step.year);
    if (this.save.year !== yearBefore) this.#refreshEntity();
    if (passing.length) this.#enqueue({ type: "result", id: serial("result"), title: `${step.year}년`, lines: passing });
    this.#raiseInquiry();
    if (step.narration?.length)
      this.#enqueue({ type: "notice", id: serial("narration"), title: `${step.year}년`, body: [...step.narration] });
    if (step.onEnter?.length) this.#apply(step.onEnter);
    // An onEnter effect or an auto objective may already have moved the story on;
    // the nested #enterStep then did the rest for the later step.
    if (this.save.step === index) this.#armObjectives(step);
    if (this.save.step === index) {
      this.channel?.updateStep();
      this.#checkStep();
    }
    this.#markSelf();
    this.persist();
  }

  #resumeStep(): void {
    const step = this.step;
    if (!step) {
      this.#chapterComplete();
      return;
    }
    this.#armObjectives(step);
    if (this.step === step) this.#checkStep();
  }

  /** Opens prompt objectives and completes auto/collect ones. */
  #armObjectives(step: StepDef): void {
    for (const objective of step.objectives) {
      if (this.#isDone(objective) || !evalCond(this.content, this.save, objective.requires)) continue;
      if (objective.kind === "auto") this.#completeObjective(objective.id);
      else if (objective.kind === "prompt" && objective.target) {
        const target = objective.target;
        const onDone = () => this.#completeObjective(objective.id);
        // The same card may already wait as a pending effect prompt: it then completes the objective too.
        const waiting = [this.#active, ...this.#queue].find((item) => item?.type === "def" && item.id === target);
        if (waiting?.type === "def") waiting.onDone ??= onDone;
        else this.#enqueue({ type: "def", id: target, onDone });
      } else if (objective.kind === "collect") this.#checkCollect(objective);
    }
  }

  #visibleObjectives(): ObjectiveDef[] {
    return (this.step?.objectives ?? []).filter((objective) =>
      evalCond(this.content, this.save, objective.requires),
    );
  }

  #isDone(objective: ObjectiveDef): boolean {
    return (this.save.objectives[objective.id] ?? 0) >= (objective.count ?? 1);
  }

  #findObjective(id: string): ObjectiveDef | undefined {
    return this.step?.objectives.find((objective) => objective.id === id);
  }

  #completeObjective(id: string, amount = Number.POSITIVE_INFINITY): void {
    const objective = this.#findObjective(id);
    if (!objective || this.#isDone(objective)) return;
    const target = objective.count ?? 1;
    const before = this.save.objectives[id] ?? 0;
    this.save.objectives[id] = Math.min(target, before + (Number.isFinite(amount) ? amount : target));
    if (this.#isDone(objective)) {
      if (objective.onComplete?.length) this.#apply(objective.onComplete);
      if (!objective.optional) {
        this.send({ t: "toast", text: `목표 달성 — ${objective.text}`, tone: "good" });
        this.#fxSelf("sfx", "quest");
      }
      this.#refreshObjectives();
    }
    this.#markSelf();
  }

  /**
   * Objectives gated by `requires` activate when their condition starts to
   * hold (flags set by earlier objectives or choices): prompt objectives open,
   * auto/collect ones complete, and the step advances when nothing remains.
   */
  #refreshObjectives(): void {
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      const step = this.step;
      if (step) this.#armObjectives(step);
      this.#checkStep();
    } finally {
      this.#refreshing = false;
    }
  }

  #checkStep(): void {
    // Past the last step the chapter is complete; only #chapterComplete presents what follows.
    if (!this.step) return;
    const required = this.#visibleObjectives().filter((objective) => !objective.optional);
    if (required.every((objective) => this.#isDone(objective))) this.#enterStep(this.save.step + 1, true);
  }

  #checkCollect(objective: ObjectiveDef): void {
    if (objective.kind !== "collect" || !objective.target) return;
    const have = this.save.inventory[objective.target] ?? 0;
    if (have >= (objective.count ?? 1)) this.#completeObjective(objective.id);
  }

  /**
   * The story ran past the last step. The step index stays there (one past the
   * last), so a resume lands here again: the completion is recorded once
   * (flag `completed:<chapter>`), and only presenting what follows — the years
   * card, or the ending after the last chapter — repeats.
   */
  #chapterComplete(): void {
    this.save.step = this.chapter.steps.length;
    const completed = `completed:${this.chapter.id}`;
    if (this.save.flags[completed] !== true) {
      this.save.flags[completed] = true;
      this.save.chronicle.push({
        year: this.save.year,
        text: `「${this.chapter.title}」의 시대를 살아냈다.`,
        tone: "good",
      });
    }
    const next = nextChapter(this.chapter.id);
    if (!next) this.#finish();
    else if (this.#active?.type !== "years" && !this.#queue.some((item) => item.type === "years"))
      this.#enqueue({ type: "years", id: serial("years"), next });
    this.persist();
  }

  /** Settles the run once; a settled save is never judged again. */
  #finish(): void {
    if (this.save.ending) return;
    this.save.ending = computeEnding(this.content, this.save);
    this.persist();
    this.#sendEnding();
  }

  #sendEnding(): void {
    const view = endingView(this.content, this.save);
    if (view) this.send({ t: "ending", ending: view });
  }

  // ── World events routed by the channel ─────────────────────────────────

  onTalk(npcId: string): void {
    if (this.#settled() || this.#active) return;
    const objective = this.#visibleObjectives().find(
      (candidate) => candidate.kind === "talk" && candidate.target === npcId && !this.#isDone(candidate),
    );
    if (objective) {
      if (objective.prompt) {
        const promptId = objective.prompt;
        if (!this.#queue.some((item) => item.type === "def" && item.id === promptId))
          this.#enqueue({ type: "def", id: promptId, onDone: () => this.#completeObjective(objective.id) });
      } else this.#completeObjective(objective.id);
      return;
    }
    const npc = this.chapter.npcs.find((candidate) => candidate.id === npcId);
    if (npc && npc.talk.length) {
      const line = npc.talk[this.#talkCounter++ % npc.talk.length] as string;
      this.send({ t: "chat", from: npc.name, text: line, kind: "npc" });
    }
  }

  markerFor(npcId: string): Marker | undefined {
    for (const objective of this.#visibleObjectives())
      if (objective.kind === "talk" && objective.target === npcId)
        return this.#isDone(objective) ? undefined : "quest";
    return undefined;
  }

  onKill(enemy: EnemyDef, level: number, boss: boolean): void {
    if (this.#settled()) return;
    const exp = Math.round(5 * level * (boss ? 25 : enemy.elite ? 4 : 1));
    this.save.record.kills++;
    if (boss) this.save.record.bossKills++;
    this.#apply([{ k: "exp", add: exp }]);
    for (const objective of this.#visibleObjectives())
      if (objective.kind === "defeat" && objective.target === enemy.id && !this.#isDone(objective))
        this.#completeObjective(objective.id, 1);
  }

  onPickup(item: string): void {
    if (this.#settled()) return;
    const def = this.content.items[item];
    this.#apply([{ k: "item", item, add: 1 }]);
    if (def) this.send({ t: "toast", text: `${def.name}을(를) 얻었다.`, tone: def.id === "ginseng" ? "epic" : "info" });
    for (const objective of this.#visibleObjectives()) this.#checkCollect(objective);
  }

  /** `others`: other participants (humans or ◇ companions) in the battle. */
  onBattleEnd(battle: BattleDef, result: "victory" | "defeat", others = 0): void {
    if (this.#settled()) return;
    const won = result === "victory";
    if (won && others > 0 && !this.save.flags.vouch) {
      this.save.flags.vouch = true;
      this.send({ t: "toast", text: "함께 싸운 이들이 새 신분을 보증해 줄 것이다 (동료 보증)", tone: "info" });
    }
    // battleResult owns the rewards: victory ones once per battle, a defeat's every time.
    const outcome = this.#process(battleResult(this.content, this.save, battle, won), true);
    for (const line of outcome.lines)
      if (line.tone === "epic") this.send({ t: "toast", text: line.text, tone: "epic" });
    if (won) {
      if (!battle.great) this.send({ t: "toast", text: `${battle.title} 승리`, tone: "good" });
      for (const objective of this.#visibleObjectives())
        if (objective.kind === "battle" && objective.target === battle.id) this.#completeObjective(objective.id);
    } else this.send({ t: "toast", text: `${battle.title} — 물러났다. 다시 도전할 수 있다.`, tone: "bad" });
    this.#markSelf();
    this.persist();
  }

  onDowned(): void {
    this.send({ t: "toast", text: "사경(死境)에 빠졌다 — 동료를 기다리거나 스스로 일어서라.", tone: "bad" });
    this.#markSelf();
  }

  onRevived(byName: string | null): void {
    if (this.#settled()) return;
    if (byName === null) {
      for (const line of selfRevive(this.save)) this.send({ t: "toast", text: line.text, tone: "warn" });
      this.#refreshEntity();
    } else this.send({ t: "toast", text: `${byName}의 도움으로 일어섰다.`, tone: "good" });
    this.#markSelf();
  }

  onRevivedOther(): void {
    if (this.#settled()) return;
    this.save.record.revivesGiven++;
    const virtue = reviveVirtue(this.save);
    if (virtue > 0) this.send({ t: "toast", text: `동료를 일으켜 세웠다 — 공덕 +${virtue}`, tone: "good" });
    this.#markSelf();
  }

  /** The channel's 공동 실록 is complete with this session in it: the rules grant, the session announces. */
  onWorldEventComplete(title: string): void {
    if (this.#settled()) return;
    const { zeitgeist, virtue } = completeWorldEvent(this.save);
    const gains = [...(zeitgeist > 0 ? [`시대정신 +${zeitgeist}`] : []), ...(virtue > 0 ? [`공덕 +${virtue}`] : [])];
    this.send({ t: "toast", text: `공동 실록 「${title}」 달성${gains.length ? ` — ${gains.join(" · ")}` : ""}`, tone: "epic" });
    this.#markSelf();
    this.persist();
  }

  onLongevity(): void {
    if (this.#settled() || !useLongevity(this.save)) return;
    this.#refreshEntity();
    this.send({
      t: "toast",
      text: `천수 1년을 태웠다 — 노인성 일섬 (${this.save.longevityUses}/${LONGEVITY_MAX_PER_CHAPTER})`,
      tone: "epic",
    });
    this.#markSelf();
  }

  // ── Prompts ────────────────────────────────────────────────────────────

  #enqueue(item: Queued, front = false): void {
    item.year ??= this.save.year;
    item.step ??= this.save.step;
    if (front) this.#queue.unshift(item);
    else this.#queue.push(item);
    this.#showNext();
  }

  #showNext(): void {
    if (this.#active || this.closed || this.#hold > 0) return;
    while (this.#queue.length) {
      const item = this.#queue.shift() as Queued;
      const view = this.#viewFor(item);
      if (!view) {
        if (item.pending) this.#forget(item.pending);
        continue;
      }
      view.year = item.year ?? this.save.year;
      this.#active = { ...item, view };
      this.send({ t: "prompt", prompt: view });
      return;
    }
    // The cards are read: battles that story effects started behind them begin now.
    this.#startHeldBattles();
    this.send({ t: "prompt", prompt: null });
  }

  /** A card is up, about to be, or a choice is resolving: the player cannot fight yet. */
  #busy(): boolean {
    return this.#active !== null || this.#hold > 0 || this.#queue.length > 0;
  }

  /** Starts a story battle now, or holds it until the card queue drains (#showNext). */
  #startOrHoldBattle(battleId: string): void {
    if (!this.#busy()) {
      this.channel?.startBattle(battleId, this, true);
      return;
    }
    if (this.#heldBattles.includes(battleId)) return;
    this.#heldBattles.push(battleId);
    this.save.pending.push({ kind: "battle", id: battleId });
  }

  #startHeldBattles(): void {
    const channel = this.channel;
    if (!channel || this.#heldBattles.length === 0) return;
    const held = this.#heldBattles;
    this.#heldBattles = [];
    for (const battleId of held) {
      this.#forget({ kind: "battle", id: battleId });
      // A refusal (another battle is on) leaves the battle objective to start on foot.
      channel.startBattle(battleId, this, true);
    }
  }

  #viewFor(item: Queued): PromptView | null {
    switch (item.type) {
      case "def": {
        const def = this.#promptDef(item.id);
        if (!def) return null;
        return promptView(this.content, this.save, def);
      }
      case "notice":
        return {
          id: item.id,
          kind: "notice",
          title: item.title,
          body: item.body,
          options: [{ id: "ok", text: "계속" }],
          year: this.save.year,
        };
      case "result":
        return {
          id: item.id,
          kind: "result",
          title: item.title,
          body: [],
          options: [{ id: "ok", text: "계속" }],
          year: this.save.year,
          data: { type: "result", lines: item.lines },
        };
      case "years": {
        const next = this.content.chapters[item.next];
        const plan = yearsPlan(this.content, this.save, item.next);
        return {
          id: item.id,
          kind: "years",
          title: "세월이 흐른다",
          body: [
            // The tokens stand for the whole era, as the planner heading (plan.summary) says.
            `${plan.eraFrom}년부터 ${plan.eraTo}년까지 ${plan.eraTo - plan.eraFrom}년, 이 시대의 세월을 ${plan.tokens}마디로 보낸다.`,
            `다음 시대: ${next.title} — ${next.subtitle}`,
            `새 이름 제안: ${suggestName(this.save, item.next)}`,
          ],
          options: [{ id: "confirm", text: "세월을 보낸다" }],
          year: this.save.year,
          data: plan,
        };
      }
      case "inquiry":
        return {
          id: item.id,
          kind: "identity",
          title: "사헌부의 조사",
          body: [
            "\"저 어른은 이십 년째 얼굴이 그대로라 합니다.\" 수군거림이 사헌부까지 닿았다.",
            "아전이 호적을 들고 찾아왔다. 어떻게 넘길 것인가.",
          ],
          options: [
            { id: "talk", text: "능청스럽게 말로 넘긴다", hint: `처세 판정 (${Math.min(95, 30 + 2 * this.save.stats.tact)}%) · 성공 의심도 −20, 실패 +10` },
            {
              id: "bribe",
              text: "아전에게 300전을 쥐여 준다",
              hint: "의심도 −20",
              ...(this.save.points.money < 300 ? { disabled: "전이 모자란다" } : {}),
            },
            { id: "wash", text: "고향으로 내려가 후손 행세를 한다", hint: "즉시 신분 세탁" },
          ],
          year: this.save.year,
        };
      case "escape":
        return {
          id: item.id,
          kind: "death",
          title: "사사(賜死)의 명",
          body: [
            "의금부 도사가 사약을 들고 문 앞에 섰다.",
            "오백 년을 살아온 몸이라 해도 이 자리에서 끝날 수는 없다.",
          ],
          options: [
            { id: "flee", text: "밤을 틈타 담을 넘는다", hint: "신법 판정 · 성공 시 전사 위장" },
            { id: "plead", text: "끝까지 결백을 주장한다", hint: "처세 판정 · 실패 시 유배" },
          ],
          year: this.save.year,
        };
    }
  }

  #promptDef(id: string): PromptDef | undefined {
    return this.chapter.prompts.find((prompt) => prompt.id === id);
  }

  #choose(promptId: string, optionId: string): void {
    const active = this.#active;
    if (!active || active.view.id !== promptId) return;
    const option = active.view.options.find((candidate) => candidate.id === optionId);
    if (!option || option.disabled) {
      this.#fxSelf("sfx", "denied");
      return;
    }
    this.#active = null;
    if (active.pending) this.#forget(active.pending);
    this.#hold++;
    try {
      switch (active.type) {
        case "def":
          this.#resolveDef(active, optionId);
          break;
        case "notice":
        case "result":
          active.onDone?.();
          break;
        case "years": {
          // Plain "confirm" (or a demo skip): the plan the rules suggest.
          const suggested = active.view.data?.type === "years" ? active.view.data.suggested : { activities: [], offer: false };
          this.#years({ t: "years", prompt: promptId, activities: suggested.activities, offer: suggested.offer }, active);
          break;
        }
        case "escape":
          this.#resolveEscape(optionId);
          break;
        case "inquiry":
          this.#resolveInquiry(optionId);
          break;
      }
    } finally {
      this.#hold--;
    }
    this.#refreshObjectives();
    this.#markSelf();
    this.persist();
    this.#showNext();
  }

  #resolveDef(active: Active & { type: "def" }, optionId: string): void {
    const def = this.#promptDef(active.id);
    const option = def?.options.find((candidate) => candidate.id === optionId);
    if (!def || !option) return;
    if (!evalCond(this.content, this.save, option.requires)) return;
    if (!this.save.promptsDone.includes(def.id)) this.save.promptsDone.push(def.id);
    this.#fxSelf("sfx", "choice");
    const outcome = this.#apply(option.effects, true);
    if (def.options.length > 1 && outcome.lines.length)
      this.#enqueue({ type: "result", id: serial("result"), title: def.title, lines: outcome.lines }, true);
    active.onDone?.();
  }

  #resolveEscape(optionId: string): void {
    const flee = optionId === "flee";
    const effects: Effect[] = [
      {
        k: "check",
        id: `escape:${this.save.chapter}:${this.save.year}:${optionId}`,
        label: flee ? "도주" : "결백 주장",
        stat: flee ? "agility" : "tact",
        base: flee ? 40 : 25,
        per: 1.5,
        success: flee
          ? [
              { k: "flag", flag: "escaped" },
              { k: "wash", method: "fakeDeath" },
              { k: "chronicle", text: "사약을 피해 전사로 위장하고 새 이름을 얻었다." },
            ]
          : [{ k: "rank", add: -2 }, { k: "chronicle", text: "결백을 끝내 인정받아 목숨을 건졌다." }],
        failure: [
          { k: "life", add: -3 },
          { k: "exile", site: "jeju" },
          { k: "chronicle", text: "옥고 끝에 제주로 유배되었다." },
        ],
      },
    ];
    const outcome = this.#apply(effects, true);
    this.#enqueue({ type: "result", id: serial("result"), title: "사사의 밤", lines: outcome.lines }, true);
  }

  #resolveInquiry(optionId: string): void {
    const effects: Effect[] =
      optionId === "bribe"
        ? [{ k: "point", point: "money", add: -300 }, { k: "suspicion", add: -20 }]
        : optionId === "wash"
          ? [{ k: "wash", method: "descendant" }]
          : [
              {
                k: "check",
                id: `inquiry:${this.save.chapter}:${this.save.identities.length}`,
                label: "사헌부 조사",
                stat: "tact",
                base: 30,
                per: 2,
                success: [{ k: "suspicion", add: -20 }],
                failure: [{ k: "suspicion", add: 10 }],
              },
            ];
    this.save.flags.inquiry = false;
    const outcome = this.#apply(effects, true);
    if (outcome.lines.length)
      this.#enqueue({ type: "result", id: serial("result"), title: "사헌부의 조사", lines: outcome.lines }, true);
  }

  /**
   * Runs the passage of years. The plan goes to the rules as sent: they own
   * which activity runs for a missing, unknown or blocked token and whether a
   * wash is allowed, and say so in the result lines.
   */
  #years(message: YearsMessage, fallback?: Active): void {
    const active = fallback ?? this.#active;
    if (!active || active.type !== "years" || active.view.id !== message.prompt) return;
    this.#active = null;
    const choice: YearsChoice = { activities: [...message.activities], offer: message.offer, grace: message.grace === true };
    if (message.wash) {
      choice.wash = message.wash;
      choice.newName = (message.name ? sanitizeName(message.name) : null) ?? suggestName(this.save, active.next);
    }
    const lines = advanceYears(this.content, this.save, active.next, choice);
    this.#fxSelf("sfx", "years_pass");
    this.persist();
    this.#enqueue({
      type: "result",
      id: serial("result"),
      title: "세월이 흘렀다",
      lines,
      onDone: () => this.#services.relocate(this),
    }, true);
  }

  // ── Actions ────────────────────────────────────────────────────────────

  #action(action: PlayerAction): void {
    const world = this.channel?.world;
    switch (action.kind) {
      case "allocate":
        if (allocatePoint(this.save, action.stat)) this.#refreshEntity();
        break;
      case "equip":
        if (equipItem(this.content, this.save, action.item)) this.#refreshEntity();
        break;
      case "use":
        this.#use(action.item);
        break;
      case "slot":
        if (slotSkill(this.save, action.skill, action.slot)) this.#refreshEntity();
        break;
      case "travel":
        this.#travel(action.site);
        break;
      case "selfRevive":
        if (world?.playerStatus(this.id)?.downed !== null) world?.selfRevive(this.id);
        break;
      case "emote":
        this.channel?.broadcastChat(this.save.name, `(${action.emote})`, "player");
        break;
      case "demoSkip":
        if (this.save.demo) this.#demoSkip();
        break;
    }
    this.#markSelf();
  }

  #use(itemId: string): void {
    const result = useItem(this.content, this.save, itemId);
    if (!result.ok) return;
    if (result.life) this.#refreshEntity();
    if (result.heal) this.channel?.world.heal(this.id, result.heal);
    for (const line of result.lines)
      this.send({ t: "toast", text: line.text, tone: result.life ? "epic" : "info" });
    this.#fxSelf(result.heal || result.life ? "heal" : "sfx", result.heal || result.life ? undefined : "coin");
  }

  #travel(siteId: string): void {
    const world = this.channel?.world;
    const site = this.#services.map.sites.find((candidate) => candidate.id === siteId);
    if (!world || !site) return;
    const deny = (text: string) => this.send({ t: "toast", text, tone: "warn" });
    if (!(this.save.inventory.mapae ?? 0)) return deny("마패가 있어야 역마를 탈 수 있다.");
    if (!site.station) return deny("역참이 있는 고을로만 달릴 수 있다.");
    if (world.battleView()) return deny("전투 중에는 떠날 수 없다.");
    if (world.playerStatus(this.id)?.downed !== null) return;
    world.teleport(this.id, site.x + 0.5, site.y + 1.5);
    this.send({ t: "toast", text: `역마를 달려 ${site.name}에 닿았다.`, tone: "info" });
  }

  /**
   * Demo mode's 건너뛰기, for this session only: answers the open card with its
   * first option (the years card with the suggested plan), wins a battle this
   * player is in, or completes the next objective — and then carries the
   * presenter (and the companions) to the objective after it. A battle
   * objective far away first moves the presenter to its ring, so the fight
   * starts in view; the next press wins it.
   */
  #demoSkip(): void {
    const active = this.#active;
    if (active) {
      const option = active.view.options.find((candidate) => !candidate.disabled);
      if (option) this.#choose(active.view.id, option.id);
      return;
    }
    const channel = this.channel;
    const world = channel?.world;
    if (!channel || !world) return;
    const battle = world.battleView();
    if (battle && (world.battleParticipants().includes(this.id) || this.#openObjective("battle", battle.id))) {
      const def = this.chapter.battles.find((candidate) => candidate.id === battle.id);
      if (def) channel.skipBattle(this, def);
      this.#moveToNextObjective();
      return;
    }
    const objective = this.#nextObjective();
    if (!objective) return;
    if (objective.kind === "battle" && objective.target) {
      const def = this.chapter.battles.find((candidate) => candidate.id === objective.target);
      if (!def || this.#moveToObjective(objective)) return;
      channel.skipBattle(this, def);
    } else if (objective.kind === "talk" && objective.target) this.onTalk(objective.target);
    else this.#completeObjective(objective.id);
    this.#moveToNextObjective();
  }

  /** The first required objective of the step still open. */
  #nextObjective(): ObjectiveDef | undefined {
    return this.#visibleObjectives().find((candidate) => !this.#isDone(candidate) && !candidate.optional);
  }

  #openObjective(kind: ObjectiveDef["kind"], target: string): ObjectiveDef | undefined {
    return this.#visibleObjectives().find(
      (candidate) => candidate.kind === kind && candidate.target === target && !this.#isDone(candidate),
    );
  }

  #moveToNextObjective(): void {
    const objective = this.#nextObjective();
    if (objective) this.#moveToObjective(objective);
  }

  /**
   * Teleports the player (and the companions) to where `objective` is played —
   * beside its NPC or place, or at the edge of its battle ring — when that is
   * more than DEMO_NEAR tiles away. Returns whether it moved.
   */
  #moveToObjective(objective: ObjectiveDef): boolean {
    const channel = this.channel;
    const world = channel?.world;
    const status = world?.playerStatus(this.id);
    if (!channel || !world || !status || status.downed !== null) return false;
    let spot: { x: number; y: number } | null = null;
    if (objective.kind === "battle") {
      const def = this.chapter.battles.find((candidate) => candidate.id === objective.target);
      const centre = def ? channel.battleCentre(def) : null;
      if (def && centre) spot = { x: centre.x, y: centre.y + def.radius + 2 };
    } else {
      const place = this.#objectivePlace(objective).place;
      if (place) spot = { x: place.x, y: place.y + 1.5 };
    }
    if (!spot || Math.hypot(spot.x - status.x, spot.y - status.y) <= DEMO_NEAR) return false;
    world.teleport(this.id, spot.x, spot.y);
    channel.catchUpCompanions(spot.x, spot.y);
    return true;
  }

  // ── Effects ────────────────────────────────────────────────────────────

  #apply(effects: readonly Effect[], collectLines = false): EffectOutcome {
    return this.#process(applyEffects(this.content, this.save, effects), collectLines);
  }

  /** Performs the runtime half of an effect outcome (single owner for both rule entry points). */
  #process(outcome: EffectOutcome, collectLines = false): EffectOutcome {
    for (const toast of outcome.toasts) this.send({ t: "toast", text: toast.text, tone: toast.tone });
    if (outcome.levelsGained > 0) {
      this.send({ t: "toast", text: `레벨 ${this.save.level}!`, tone: "epic" });
      this.#fxSelf("levelup");
      this.#fxSelf("sfx", "levelup");
    }
    if (outcome.washed)
      this.send({ t: "toast", text: `이제부터 이름은 ${this.save.name}.`, tone: "info" });
    this.#refreshEntity();
    for (const prompt of outcome.prompts) this.#queuePending("prompt", prompt);
    for (const objective of outcome.objectives) this.#completeObjective(objective);
    if (outcome.goto) {
      const site = this.#services.map.sites.find((candidate) => candidate.id === outcome.goto?.site);
      if (site) {
        const [dx, dy] = outcome.goto.offset ?? [0, 0];
        this.channel?.world.teleport(this.id, site.x + 0.5 + dx, site.y + 1.5 + dy);
      }
    }
    if (outcome.worldEvent) this.channel?.addWorldEvent(outcome.worldEvent);
    if (outcome.escape) this.#queuePending("escape", `${this.save.chapter}:${this.save.year}`);
    for (const battleId of outcome.battles) this.#startOrHoldBattle(battleId);
    if (!collectLines) outcome.lines.length = 0;
    this.#markSelf();
    return outcome;
  }

  /**
   * Queues a card the step cannot rebuild and keeps it in save.pending, in the
   * order it will come, until it is answered: an effect's prompt (behind what
   * waits), or the 사사 escape card (in front of everything).
   */
  #queuePending(kind: "prompt" | "escape", id: string): void {
    const type = kind === "escape" ? "escape" : "def";
    const cardId = kind === "escape" ? escapeCardId(id) : id;
    if ([this.#active, ...this.#queue].some((item) => item?.type === type && item.id === cardId)) return;
    const entry: PendingStory = { kind, id };
    if (kind === "escape") {
      this.save.pending.unshift(entry);
      this.#enqueue({ type: "escape", id: cardId, pending: entry }, true);
    } else {
      this.save.pending.push(entry);
      this.#enqueue({ type: "def", id: cardId, pending: entry });
    }
  }

  /** Pushes level/derived/sprite/skills/name and the 노인성 일섬 gate to the world entity. */
  #refreshEntity(): void {
    const world = this.channel?.world;
    if (!world) return;
    world.updatePlayer(this.id, {
      name: this.save.name,
      title: this.#title(),
      sprite: heroSprite(this.save),
      variant: this.save.variant,
      level: this.save.level,
      derived: derived(this.content, this.save),
      skills: [...this.save.skillSlots],
    });
    world.setLongevityEnabled(this.id, longevityBlocker(this.save) === null);
  }

  #title(): string {
    return this.save.titles[this.save.titles.length - 1] ?? this.content.origins[this.save.origin]?.name ?? "";
  }

  playerSpec(x: number, y: number): PlayerSpec {
    return {
      id: this.id,
      kind: "player",
      name: this.save.name,
      title: this.#title(),
      sprite: heroSprite(this.save),
      variant: this.save.variant,
      level: this.save.level,
      derived: derived(this.content, this.save),
      skills: [...this.save.skillSlots],
      longevityEnabled: longevityBlocker(this.save) === null,
      x,
      y,
    };
  }

  #fxSelf(kind: "sfx" | "levelup" | "heal", sfx?: string): void {
    const status = this.channel?.world.playerStatus(this.id);
    if (!status) return;
    this.send({
      t: "fx",
      fx: [kind === "sfx" ? { k: "sfx", x: status.x, y: status.y, sfx: sfx ?? "ui_click" } : { k: kind, x: status.x, y: status.y }],
    });
  }

  // ── Per-tick work driven by the channel ────────────────────────────────

  tick(dt: number): void {
    this.#denyTimer = Math.max(0, this.#denyTimer - dt);
    this.#chatRefill += dt;
    if (this.#chatRefill >= 1.5) {
      this.#chatRefill = 0;
      this.#chatBudget = Math.min(3, this.#chatBudget + 1);
    }
    this.#reachTimer += dt;
    if (this.#reachTimer >= 0.25) {
      this.#reachTimer = 0;
      this.#checkPlaces();
    }
    this.#selfTimer += dt;
    if (this.#selfTimer >= 0.25) {
      this.#selfTimer = 0;
      this.#sendSelfIfChanged();
    }
    this.#saveTimer += dt;
    if (this.#saveTimer >= 30) this.persist();
  }

  #checkPlaces(): void {
    const channel = this.channel;
    const world = channel?.world;
    const status = world?.playerStatus(this.id);
    if (!channel || !world || !status || this.#active) return;
    const here = world.siteOf(this.id);
    for (const objective of this.#visibleObjectives()) {
      if (this.#isDone(objective) || !objective.target) continue;
      if (objective.kind === "reach") {
        const site = world.sitePosition(objective.target);
        const near = site ? Math.hypot(site.x - status.x, site.y - status.y) <= 4 : false;
        if (here === objective.target || near) this.#completeObjective(objective.id);
      } else if (objective.kind === "battle" && !world.battleView() && status.downed === null) {
        const def = this.chapter.battles.find((candidate) => candidate.id === objective.target);
        const centre = def ? channel.battleCentre(def) : null;
        if (def && centre && Math.hypot(centre.x - status.x, centre.y - status.y) <= def.radius + 6)
          channel.startBattle(def.id, this, false);
      }
    }
  }

  /** Where an objective is played (marker, demo skip): its NPC, place or battle ring, and the site it names. */
  #objectivePlace(objective: ObjectiveDef): { place: { x: number; y: number } | null; siteId: string | undefined } {
    const channel = this.channel;
    const world = channel?.world;
    let place: { x: number; y: number } | null = null;
    let siteId = objective.site;
    if (world && objective.target) {
      if (objective.kind === "talk") place = world.npcPosition(objective.target);
      else if (objective.kind === "reach") {
        place = world.sitePosition(objective.target);
        siteId = objective.target;
      } else if (objective.kind === "battle") {
        const def = this.chapter.battles.find((candidate) => candidate.id === objective.target);
        if (def) {
          place = channel?.battleCentre(def) ?? null;
          siteId = def.site;
        }
      }
    }
    if (!place && siteId && world) place = world.sitePosition(siteId);
    if (place && objective.offset && !(objective.kind === "talk")) {
      place = { x: place.x + objective.offset[0], y: place.y + objective.offset[1] };
    }
    return { place, siteId };
  }

  #objectiveViews(): ObjectiveView[] {
    return this.#visibleObjectives().map((objective) => {
      const view: ObjectiveView = {
        id: objective.id,
        text: objective.text,
        done: this.#isDone(objective),
        optional: objective.optional ?? false,
      };
      if ((objective.count ?? 1) > 1)
        view.progress = [this.save.objectives[objective.id] ?? 0, objective.count ?? 1];
      const { place, siteId } = this.#objectivePlace(objective);
      if (place) {
        view.x = place.x;
        view.y = place.y;
      }
      if (siteId) {
        const site = this.#services.map.sites.find((candidate) => candidate.id === siteId);
        if (site) view.siteName = site.name;
      }
      return view;
    });
  }

  #markSelf(): void {
    this.#selfSignature = "";
  }

  #sendSelfIfChanged(): void {
    const channel = this.channel;
    if (!channel || this.closed) return;
    const world = channel.world;
    const status = world.playerStatus(this.id);
    const battle = world.battleView();
    const signature = JSON.stringify([
      status && [Math.ceil(status.hp), Math.floor(status.energy), Math.floor(status.stamina), status.downed !== null && Math.ceil(status.downed), status.cooldowns.map((c) => Math.ceil(c * 2)), Math.ceil(status.longevityReady)],
      battle && [battle.timeLeft !== undefined && Math.ceil(battle.timeLeft), battle.wave, battle.boss?.hp, battle.defend?.hp, battle.morale, battle.participants],
      channel.worldEventProgress,
    ]);
    if (signature === this.#selfSignature) return;
    this.#selfSignature = signature;
    const step = this.step;
    const context: Parameters<typeof selfView>[2] = {
      id: this.id,
      world,
      status,
      battle,
      stepYear: step?.year ?? this.save.year,
      channel: channel.channelInfo(),
      objectives: this.#objectiveViews(),
    };
    const event = channel.worldEventView();
    if (event) context.worldEvent = event;
    this.send({ t: "self", self: selfView(this.content, this.save, context) });
  }

  persist(): void {
    this.#saveTimer = 0;
    const status = this.channel?.world.playerStatus(this.id);
    if (status && status.downed === null && !this.channel?.world.battleView())
      this.save.position = { x: status.x, y: status.y };
    this.#services.save(this.token, this.save);
  }

  resetPosition(): void {
    this.save.position = undefined;
  }
}
