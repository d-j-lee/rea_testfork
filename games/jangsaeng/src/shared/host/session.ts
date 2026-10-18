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
  WashMethod,
} from "../content/schema.ts";
import type { GameMap } from "../map/generate.ts";
import type { ClientMsg, PlayerAction, ServerMsg } from "../protocol.ts";
import {
  advanceStepYear,
  advanceYears,
  allocatePoint,
  applyEffects,
  battleResult,
  computeEnding,
  derived,
  equipItem,
  evalCond,
  heroSprite,
  selfRevive,
  slotSkill,
  suggestName,
  useItem,
  useLongevity,
  yearsPlan,
  type EffectOutcome,
} from "../rules/index.ts";
import type { PlayerInput, PlayerSpec } from "../sim/world.ts";
import type { Marker, ObjectiveView, PlayerSave, PromptView, ResultView } from "../types.ts";
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

type Queued =
  | { type: "def"; id: string; onDone?: () => void }
  | { type: "notice"; id: string; title: string; body: string[]; onDone?: () => void }
  | { type: "result"; id: string; title: string; lines: ResultView["lines"]; onDone?: () => void }
  | { type: "years"; id: string; next: ChapterId }
  | { type: "escape"; id: string };

type Active = Queued & { view: PromptView };

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
  #ended = false;
  /** While > 0, queued prompts are not shown (keeps result cards first). */
  #hold = 0;
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
    if (!this.closed) this.#send(message);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Called by the channel after the player entity exists in its world. */
  begin(): void {
    const channel = this.channel;
    if (!channel) return;
    this.send({ t: "enter", you: this.id, chapter: chapterView(this.chapter), channel: channel.label });
    this.#queue = [];
    this.#active = null;
    if (this.save.ending) {
      this.#sendEnding();
      return;
    }
    const enteredFlag = `entered:${this.chapter.id}`;
    if (!this.save.flags[enteredFlag]) {
      this.save.flags[enteredFlag] = true;
      const unlocks: Effect[] = (this.chapter.unlocks ?? []).map((skill) => ({ k: "skill", skill }));
      if (unlocks.length) this.#apply(unlocks);
      if (this.save.exile) {
        this.save.chronicle.push({ year: this.save.year, text: "유배지에서 새 시대를 맞았다.", tone: "bad" });
        this.save.exile = undefined;
      }
      this.#enterStep(0, true);
    } else {
      this.#resumeStep();
    }
    channel.updateStep();
    this.#markSelf();
    this.persist();
  }

  close(): void {
    if (this.closed) return;
    this.persist();
    this.closed = true;
  }

  // ── Inbound messages ───────────────────────────────────────────────────

  receive(message: ClientMsg): void {
    if (this.#ended && message.t !== "chat" && message.t !== "ping") return;
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

  #longevityAllowed(): boolean {
    const reason =
      this.save.longevityUses >= 3
        ? "이 시대에는 더 이상 노인성 일섬을 쓸 수 없다 (3/3)."
        : this.save.lifeEnd <= this.save.year
          ? "남은 천수가 없다."
          : null;
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
    const passing = advanceStepYear(this.content, this.save, step.year);
    if (passing.length) {
      this.#refreshEntity();
      this.#enqueue({ type: "result", id: serial("result"), title: `${step.year}년`, lines: passing });
    }
    if (step.narration?.length)
      this.#enqueue({ type: "notice", id: serial("narration"), title: `${step.year}년`, body: [...step.narration] });
    if (step.onEnter?.length) this.#apply(step.onEnter);
    this.#armObjectives(step);
    this.channel?.updateStep();
    this.#checkStep();
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
    this.#checkStep();
  }

  /** Opens prompt objectives and completes auto/collect ones. */
  #armObjectives(step: StepDef): void {
    for (const objective of step.objectives) {
      if (this.#isDone(objective) || !evalCond(this.content, this.save, objective.requires)) continue;
      if (objective.kind === "auto") this.#completeObjective(objective.id);
      else if (objective.kind === "prompt" && objective.target) {
        const target = objective.target;
        if (!this.#queue.some((item) => item.type === "def" && item.id === target) && this.#active?.id !== target)
          this.#enqueue({ type: "def", id: target, onDone: () => this.#completeObjective(objective.id) });
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
      this.#checkStep();
    }
    this.#markSelf();
  }

  #checkStep(): void {
    const required = this.#visibleObjectives().filter((objective) => !objective.optional);
    if (required.every((objective) => this.#isDone(objective))) this.#enterStep(this.save.step + 1, true);
  }

  #checkCollect(objective: ObjectiveDef): void {
    if (objective.kind !== "collect" || !objective.target) return;
    const have = this.save.inventory[objective.target] ?? 0;
    if (have >= (objective.count ?? 1)) this.#completeObjective(objective.id);
  }

  #chapterComplete(): void {
    const next = nextChapter(this.chapter.id);
    this.save.chronicle.push({
      year: this.save.year,
      text: `「${this.chapter.title}」의 시대를 살아냈다.`,
      tone: "good",
    });
    if (next) this.#enqueue({ type: "years", id: serial("years"), next });
    else this.#finish();
    this.persist();
  }

  #finish(): void {
    this.save.ending = computeEnding(this.content, this.save);
    this.#ended = true;
    this.persist();
    this.#sendEnding();
  }

  #sendEnding(): void {
    const view = endingView(this.content, this.save);
    if (view) this.send({ t: "ending", ending: view });
  }

  // ── World events routed by the channel ─────────────────────────────────

  onTalk(npcId: string): void {
    if (this.#active) return;
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
    const exp = Math.round(5 * level * (boss ? 25 : enemy.elite ? 4 : 1));
    this.save.record.kills++;
    if (boss) this.save.record.bossKills++;
    this.#apply([{ k: "exp", add: exp }]);
    for (const objective of this.#visibleObjectives())
      if (objective.kind === "defeat" && objective.target === enemy.id && !this.#isDone(objective))
        this.#completeObjective(objective.id, 1);
  }

  onPickup(item: string): void {
    const def = this.content.items[item];
    this.#apply([{ k: "item", item, add: 1 }]);
    if (def) this.send({ t: "toast", text: `${def.name}을(를) 얻었다.`, tone: def.id === "ginseng" ? "epic" : "info" });
    for (const objective of this.#visibleObjectives()) this.#checkCollect(objective);
  }

  onBattleEnd(battle: BattleDef, result: "victory" | "defeat"): void {
    const won = result === "victory";
    const first = won && !this.save.battlesWon.includes(battle.id);
    // Victory rewards are granted once per battle; defeats always apply.
    if (!won || first) {
      const outcome = this.#process(battleResult(this.content, this.save, battle, won), true);
      for (const line of outcome.lines)
        if (line.tone === "epic") this.send({ t: "toast", text: line.text, tone: "epic" });
    }
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
    if (byName === null) {
      for (const line of selfRevive(this.save)) this.send({ t: "toast", text: line.text, tone: "warn" });
    } else this.send({ t: "toast", text: `${byName}의 도움으로 일어섰다.`, tone: "good" });
    this.#markSelf();
  }

  onRevivedOther(): void {
    this.save.record.revivesGiven++;
  }

  onLongevity(): void {
    if (!useLongevity(this.save)) return;
    this.send({
      t: "toast",
      text: `천수 1년을 태웠다 — 노인성 일섬 (${this.save.longevityUses}/3)`,
      tone: "epic",
    });
    this.#markSelf();
  }

  // ── Prompts ────────────────────────────────────────────────────────────

  #enqueue(item: Queued, front = false): void {
    if (front) this.#queue.unshift(item);
    else this.#queue.push(item);
    this.#showNext();
  }

  #showNext(): void {
    if (this.#active || this.closed || this.#hold > 0) return;
    while (this.#queue.length) {
      const item = this.#queue.shift() as Queued;
      const view = this.#viewFor(item);
      if (!view) continue;
      this.#active = { ...item, view };
      this.send({ t: "prompt", prompt: view });
      return;
    }
    this.send({ t: "prompt", prompt: null });
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
            `${this.save.year}년에서 ${next.years[0]}년까지, ${next.years[0] - this.save.year}년의 세월.`,
            `다음 시대: ${next.title} — ${next.subtitle}`,
            `새 이름 제안: ${suggestName(this.save, item.next)}`,
          ],
          options: [{ id: "confirm", text: "세월을 보낸다" }],
          year: this.save.year,
          data: plan,
        };
      }
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
        case "years":
          // Plain "confirm" without a plan: the default activity for every token.
          this.#years({ t: "years", prompt: promptId, activities: [], offer: false }, active);
          break;
        case "escape":
          this.#resolveEscape(optionId);
          break;
      }
    } finally {
      this.#hold--;
    }
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
          ? [{ k: "wash", method: "fakeDeath" }, { k: "chronicle", text: "사약을 피해 전사로 위장하고 새 이름을 얻었다." }]
          : [{ k: "rank", add: -2 }, { k: "chronicle", text: "결백을 끝내 인정받아 목숨을 건졌다." }],
        failure: [
          { k: "life", add: -5 },
          { k: "exile", site: "jeju" },
          { k: "chronicle", text: "옥고 끝에 제주로 유배되었다." },
        ],
      },
    ];
    const outcome = this.#apply(effects, true);
    this.#enqueue({ type: "result", id: serial("result"), title: "사사의 밤", lines: outcome.lines }, true);
  }

  #years(message: Extract<ClientMsg, { t: "years" }>, fallback?: Active): void {
    const active = fallback ?? this.#active;
    if (!active || active.type !== "years" || active.view.id !== message.prompt) return;
    this.#active = null;
    const plan = active.view.data?.type === "years" ? active.view.data : null;
    const tokens = plan?.tokens ?? 1;
    const allowed = new Set(
      (plan?.activities ?? []).filter((activity) => !activity.disabled).map((activity) => activity.id),
    );
    const fallbackActivity = allowed.has("martial") ? "martial" : ([...allowed][0] ?? "martial");
    const activities = Array.from({ length: tokens }, (_, index) => {
      const wanted = message.activities[index];
      return wanted && allowed.has(wanted) ? wanted : fallbackActivity;
    });
    let wash: WashMethod | undefined;
    if (message.wash && plan?.washes.some((method) => method.id === message.wash && !method.disabled))
      wash = message.wash;
    const name = message.name ? sanitizeName(message.name) : null;
    const choice: Parameters<typeof advanceYears>[3] = { activities, offer: message.offer };
    if (wash) {
      choice.wash = wash;
      choice.newName = name ?? suggestName(this.save, active.next);
    }
    const lines = advanceYears(this.content, this.save, active.next, choice);
    this.#fxSelf("sfx", "years_pass");
    this.persist();
    this.#active = null;
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

  #demoSkip(): void {
    if (this.#active) {
      const option = this.#active.view.options.find((candidate) => !candidate.disabled);
      if (this.#active.type === "years")
        this.#years({ t: "years", prompt: this.#active.view.id, activities: [], offer: true });
      else if (option) this.#choose(this.#active.view.id, option.id);
      return;
    }
    const world = this.channel?.world;
    const battle = world?.battleView();
    if (battle && world) {
      const def = this.chapter.battles.find((candidate) => candidate.id === battle.id);
      world.abortBattle();
      if (def) this.channel?.endBattle(def, "victory");
      return;
    }
    const objective = this.#visibleObjectives().find((candidate) => !this.#isDone(candidate) && !candidate.optional);
    if (!objective) return;
    if (objective.kind === "talk" && objective.target) this.onTalk(objective.target);
    else if (objective.kind === "battle" && objective.target) {
      const def = this.chapter.battles.find((candidate) => candidate.id === objective.target);
      if (def) this.channel?.endBattle(def, "victory");
    } else this.#completeObjective(objective.id);
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
    for (const prompt of outcome.prompts) this.#enqueue({ type: "def", id: prompt });
    for (const objective of outcome.objectives) this.#completeObjective(objective);
    if (outcome.goto) {
      const site = this.#services.map.sites.find((candidate) => candidate.id === outcome.goto?.site);
      if (site) {
        const [dx, dy] = outcome.goto.offset ?? [0, 0];
        this.channel?.world.teleport(this.id, site.x + 0.5 + dx, site.y + 1.5 + dy);
      }
    }
    if (outcome.worldEvent) this.channel?.addWorldEvent(outcome.worldEvent);
    for (const battleId of outcome.battles) this.channel?.startBattle(battleId, this, true);
    if (outcome.escape) this.#enqueue({ type: "escape", id: serial("escape") }, true);
    if (!collectLines) outcome.lines.length = 0;
    this.#markSelf();
    return outcome;
  }

  /** Pushes level/derived/sprite/skills/name to the world entity. */
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

  #objectiveViews(): ObjectiveView[] {
    const channel = this.channel;
    const world = channel?.world;
    return this.#visibleObjectives().map((objective) => {
      const view: ObjectiveView = {
        id: objective.id,
        text: objective.text,
        done: this.#isDone(objective),
        optional: objective.optional ?? false,
      };
      if ((objective.count ?? 1) > 1)
        view.progress = [this.save.objectives[objective.id] ?? 0, objective.count ?? 1];
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
