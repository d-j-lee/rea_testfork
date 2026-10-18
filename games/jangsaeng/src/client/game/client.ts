// The game client core: consumes ServerMsgs (world state), samples input and
// sends it at 20 Hz (and on edges), runs the frame loop (interpolation,
// camera, scene, fx, music) and feeds the UI its per-frame info. Transport
// agnostic; the UI is reached through the small UiPort below.

import type { GameMap } from "../../shared/map/generate.ts";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../../shared/protocol.ts";
import { TILE_PX, type Dir } from "../../shared/sprites.ts";
import type { ChapterView, EndingView, SelfView } from "../../shared/types.ts";
import type { AudioEngine } from "../audio/types.ts";
import type { Input } from "../input.ts";
import type { Transport } from "../net/transport.ts";
import type { FrameInfo } from "../ui/index.ts";
import { CameraRig, cssScaleFor } from "./camera.ts";
import { drawDevOverlay, FrameStats } from "./dev.ts";
import { FxRouter } from "./fx.ts";
import { MusicRouter, type MusicState } from "./music.ts";
import { Scene, type SceneFrame } from "./scene.ts";
import { EntityStore, type DelayConfig } from "./snapshots.ts";
import type { GameCanvas } from "./surface.ts";

/** What the core needs from the DOM UI. */
export interface UiPort {
  handle(message: ServerMsg): void;
  frame(info: FrameInfo): void;
  readonly blocking: boolean;
  enterGame(): void;
  showError(text: string): void;
}

export interface GameClientDeps {
  surface: GameCanvas;
  map: GameMap;
  audio: AudioEngine;
  input: Input;
  ui: UiPort;
}

export interface SessionHooks {
  mode: "offline" | "online";
  /** Runs at the start of every frame (offline: advance the in-page host). */
  pump?: () => void;
  onWelcome?(message: Extract<ServerMsg, { t: "welcome" }>): void;
  onSelf?(self: SelfView): void;
  onClose?(reason: string): void;
}

const INPUT_MS = 50;
const CHANGE_MIN_MS = 30;
const PING_MS = 2000;
const DELAYS: Record<"offline" | "online", DelayConfig> = {
  offline: { remoteMin: 50, selfMin: 16 },
  online: { remoteMin: 100, selfMin: 40 },
};
const SELF_TAU: Record<"offline" | "online", number> = { offline: 14, online: 45 };
const DIR_VEC: Record<Dir, readonly [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

const q2 = (v: number) => Math.round(v * 100) / 100;

export class GameClient {
  readonly scene: Scene;
  readonly store = new EntityStore();
  readonly rig = new CameraRig();
  readonly fx: FxRouter;
  readonly stats = new FrameStats();
  readonly #deps: GameClientDeps;
  readonly #music: MusicRouter;
  #transport: Transport | null = null;
  #hooks: SessionHooks | null = null;
  #raf = 0;
  #last = 0;
  #visualNow = 0;
  #debt = 0;
  #hitstopUntil = 0;
  #inGame = false;
  #chapter: ChapterView | null = null;
  #self: SelfView | null = null;
  #promptKind: string | null = null;
  #ending: EndingView | null = null;
  // Input sending.
  #seq = 0;
  #lastSend = Number.NEGATIVE_INFINITY;
  #sent = { mx: 0, my: 0, attack: false, shoot: false, dodge: false };
  #zeroSent = true;
  #steering = false;
  #aimX = 0;
  #aimY = 0;
  // Own entity smoothing.
  #sx = 0;
  #sy = 0;
  #selfPlaced = false;
  // Ping.
  #lastPing = 0;
  #rtt: number | null = null;
  // Diagnostics.
  #dev = false;
  #zoom = 0;
  readonly #errors = new Set<string>();
  #cleared = false;
  readonly #info: FrameInfo;
  readonly #musicState: MusicState = { chapter: null, battle: undefined, promptKind: null, ending: null };
  readonly #sceneFrame: SceneFrame;
  readonly #selfTiles = { x: 0, y: 0 };
  readonly #playerScreen = { x: 0, y: 0 };
  frames = 0;

  constructor(deps: GameClientDeps) {
    this.#deps = deps;
    this.scene = new Scene(deps.map);
    this.#music = new MusicRouter(deps.audio);
    this.fx = new FxRouter({
      effects: this.scene.effects,
      seals: this.scene.seals,
      audio: deps.audio,
      rig: this.rig,
      hitstop: (ms) => {
        this.#hitstopUntil = Math.max(this.#hitstopUntil, performance.now() + ms);
      },
    });
    this.#sceneFrame = {
      now: 0,
      visualNow: 0,
      visualDt: 0,
      store: this.store,
      rig: this.rig,
      fx: this.fx,
      self: null,
      chapter: null,
      unit: 1,
    };
    this.#info = {
      dtMs: 0,
      fps: 60,
      ping: null,
      self: null,
      ents: this.store.snaps,
      playerScreen: this.#playerScreen,
    };
    window.addEventListener("keydown", (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing || event.repeat) return;
      if (event.code === "F3") {
        event.preventDefault();
        this.#dev = !this.#dev;
      } else if (this.#inGame && !deps.ui.blocking && (event.code === "Equal" || event.code === "NumpadAdd")) {
        this.#zoom = Math.min(2, this.#zoom + 1);
      } else if (this.#inGame && !deps.ui.blocking && (event.code === "Minus" || event.code === "NumpadSubtract")) {
        this.#zoom = Math.max(-1, this.#zoom - 1);
      }
    });
  }

  get inGame(): boolean {
    return this.#inGame;
  }

  get self(): SelfView | null {
    return this.#self;
  }

  /** Sends a message on the current transport (dropped when none). */
  send(message: ClientMsg): void {
    this.#transport?.send(message);
  }

  /** Binds a connected transport and greets the host. */
  attach(transport: Transport, hooks: SessionHooks, hello: Extract<ClientMsg, { t: "hello" }>): void {
    this.#transport = transport;
    this.#hooks = hooks;
    transport.onMessage((message) => this.handle(message));
    transport.onClose((reason) => {
      if (this.#transport !== transport) return;
      this.#transport = null;
      hooks.onClose?.(reason);
    });
    transport.send(hello);
  }

  start(): void {
    if (this.#raf) return;
    this.#last = performance.now();
    this.#visualNow = this.#last;
    const loop = () => {
      this.#raf = requestAnimationFrame(loop);
      this.#tick();
    };
    this.#raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  #report(where: string, error: unknown): void {
    const text = `${where}: ${error instanceof Error ? error.message : String(error)}`;
    if (this.#errors.has(text) || this.#errors.size > 8) return;
    this.#errors.add(text);
    console.error(`[game] ${where}`, error);
  }

  // ── Messages ─────────────────────────────────────────────────────────

  handle(message: ServerMsg): void {
    if (!message || typeof message !== "object" || typeof message.t !== "string") return;
    const now = performance.now();
    try {
      this.#apply(message, now);
    } catch (error) {
      this.#report(`message ${message.t}`, error);
    }
    try {
      this.#deps.ui.handle(message);
    } catch (error) {
      this.#report(`ui.handle ${message.t}`, error);
    }
  }

  #apply(message: ServerMsg, now: number): void {
    switch (message.t) {
      case "welcome":
        if (message.v !== PROTOCOL_VERSION)
          this.#deps.ui.showError(`서버 버전(${message.v})이 클라이언트(${PROTOCOL_VERSION})와 다릅니다. 새로고침해 주세요.`);
        this.#hooks?.onWelcome?.(message);
        return;
      case "enter": {
        this.store.clear();
        this.fx.clear();
        this.scene.clear();
        this.store.selfId = message.you;
        this.#selfPlaced = false;
        this.rig.unplace();
        this.#applyChapter(message.chapter);
        if (!this.#inGame) {
          this.#inGame = true;
          this.#deps.ui.enterGame();
        }
        return;
      }
      case "snap":
        this.store.applySnap(message.tick, message.ents ?? [], message.gone ?? [], now);
        return;
      case "self": {
        const prev = this.#self;
        const self = message.self;
        this.#self = self;
        if (self.chapter && Number.isFinite(self.chapter.stepYear)) this.scene.world.setYear(self.chapter.stepYear);
        if (prev && prev.id === self.id && self.hp < prev.hp && self.maxHp > 0) {
          const loss = (prev.hp - self.hp) / self.maxHp;
          this.scene.vignette.trigger(now + this.store.visibleDelay() * 0.6, Math.min(0.9, 0.35 + loss * 3));
        }
        this.#hooks?.onSelf?.(self);
        return;
      }
      case "prompt":
        this.#promptKind = message.prompt?.kind ?? null;
        return;
      case "fx":
        if (Array.isArray(message.fx)) this.fx.push(message.fx, now + this.store.visibleDelay());
        return;
      case "ending":
        this.#ending = message.ending;
        return;
      case "pong":
        if (typeof message.at === "number") {
          const rtt = now - message.at;
          if (rtt >= 0 && rtt < 30000) this.#rtt = this.#rtt === null ? rtt : this.#rtt * 0.7 + rtt * 0.3;
        }
        return;
      default:
        return;
    }
  }

  #applyChapter(chapter: ChapterView): void {
    this.#chapter = chapter;
    this.#ending = null;
    const world = this.scene.world;
    world.setSeason(chapter.season);
    const year = Array.isArray(chapter.years) ? chapter.years[0] : undefined;
    if (typeof year === "number") world.setYear(year);
  }

  // ── Frame ────────────────────────────────────────────────────────────

  #tick(): void {
    const start = performance.now();
    const gap = Math.min(250, Math.max(0, start - this.#last));
    this.#last = start;
    try {
      this.#frame(start, gap);
    } catch (error) {
      this.#report("frame", error);
      this.#deps.surface.resetState();
    }
    this.frames++;
    this.stats.record(gap, performance.now() - start);
  }

  #frame(now: number, dt: number): void {
    const { surface, ui } = this.#deps;
    this.#hooks?.pump?.();
    if (surface.fit()) this.#cleared = false;
    const unit = surface.unit;
    const cssScale = cssScaleFor(surface.cssWidth, surface.cssHeight, this.#zoom);
    const scale = Math.max(1, Math.round(cssScale * unit));
    this.rig.resize(surface.width, surface.height, scale);

    // Hitstop freezes the visual clock, then it catches up at 1.6×.
    if (now < this.#hitstopUntil) this.#debt += dt;
    else if (this.#debt > 0) this.#debt = Math.max(0, this.#debt - dt * 0.6);
    this.#debt = Math.min(this.#debt, 250);
    const visualNow = now - this.#debt;
    const visualDt = Math.max(0, visualNow - this.#visualNow);
    this.#visualNow = visualNow;

    if (this.#inGame) this.#sampleInput(now, scale / unit);
    else this.#deps.input.state(); // drain edges typed on menus
    const mode = this.#hooks?.mode ?? "offline";
    if (this.#inGame) {
      this.store.update(visualNow, DELAYS[mode], this.#steering);
      this.#followSelf(dt, mode);
      this.rig.update(dt);
      this.fx.update(now);
      const music = this.#musicState;
      music.chapter = this.#chapter;
      music.battle = this.#self?.battle;
      music.promptKind = this.#promptKind;
      music.ending = this.#ending;
      this.#music.update(music);
      const f = this.#sceneFrame;
      f.now = now;
      f.visualNow = visualNow;
      f.visualDt = visualDt;
      f.self = this.#self;
      f.chapter = this.#chapter;
      f.unit = unit;
      this.scene.draw(surface.ctx, f);
    } else if (!this.#cleared) {
      // The title and loading screens cover the canvas; draw nothing.
      surface.ctx.fillStyle = "#12131a";
      surface.ctx.fillRect(0, 0, surface.width, surface.height);
      this.#cleared = true;
    }
    if (this.#dev) this.#drawDev(unit);

    if (mode === "online" && this.#transport && now - this.#lastPing > PING_MS) {
      this.#lastPing = now;
      this.#transport.send({ t: "ping", at: now });
    }
    const info = this.#info;
    info.dtMs = dt;
    info.fps = this.stats.fps;
    info.ping = mode === "online" && this.#rtt !== null ? Math.round(this.#rtt) : null;
    info.ents = this.store.snaps;
    info.self = this.#selfPlaced ? this.#selfTiles : null;
    try {
      ui.frame(info);
    } catch (error) {
      this.#report("ui.frame", error);
    }
  }

  #followSelf(dt: number, mode: "offline" | "online"): void {
    const track = this.store.self;
    const target = track?.newest;
    if (!track || !target || !track.seen) return;
    const far = Math.abs(track.x - this.#sx) + Math.abs(track.y - this.#sy) > 3;
    if (!this.#selfPlaced || far) {
      this.#sx = track.x;
      this.#sy = track.y;
    } else {
      const k = 1 - Math.exp(-dt / SELF_TAU[mode]);
      this.#sx += (track.x - this.#sx) * k;
      this.#sy += (track.y - this.#sy) * k;
    }
    track.x = this.#sx;
    track.y = this.#sy;
    this.#selfTiles.x = this.#sx;
    this.#selfTiles.y = this.#sy;
    const wx = this.#sx * TILE_PX;
    const wy = this.#sy * TILE_PX - 8;
    let lx = this.#aimX;
    let ly = this.#aimY;
    if (!lx && !ly) [lx, ly] = DIR_VEC[track.dir] ?? DIR_VEC.down;
    if (!this.#selfPlaced || far) this.rig.snapTo(wx, wy);
    else this.rig.follow(wx, wy, lx, ly, dt);
    this.#selfPlaced = true;
    // Player position for mouse aim (CSS px) and the UI (canvas px).
    const unit = this.#deps.surface.unit;
    const px = this.rig.screenX(wx);
    const py = this.rig.screenY(wy);
    this.#playerScreen.x = px / unit;
    this.#playerScreen.y = py / unit;
    this.#deps.input.playerScreen.x = px / unit;
    this.#deps.input.playerScreen.y = py / unit;
  }

  #sampleInput(now: number, cssScale: number): void {
    const { input, ui } = this.#deps;
    // The UI owns Input.setEnabled (it knows when a modal opens); the core
    // only stops sending and releases everything once.
    const blocked = ui.blocking || !this.#transport;
    const st = input.state();
    if (blocked) {
      this.#steering = false;
      this.#aimX = this.#aimY = 0;
      if (!this.#zeroSent && this.#transport) {
        this.#zeroSent = true;
        this.#send(now, 0, 0, false, false, false, 0, false, undefined, undefined);
      }
      return;
    }
    const mx = q2(st.mx);
    const my = q2(st.my);
    this.#steering = mx !== 0 || my !== 0;
    let ax: number | undefined;
    let ay: number | undefined;
    if (st.aim) {
      const perTile = TILE_PX * cssScale;
      ax = q2(st.aim.x / perTile);
      ay = q2(st.aim.y / perTile);
      this.#aimX = ax;
      this.#aimY = ay;
    } else {
      this.#aimX = this.#steering ? mx : 0;
      this.#aimY = this.#steering ? my : 0;
    }
    const last = this.#sent;
    const edge = st.skill !== 0 || st.interact || (st.dodge && !last.dodge);
    const changed =
      mx !== last.mx || my !== last.my || st.attack !== last.attack || st.shoot !== last.shoot || st.dodge !== last.dodge;
    const since = now - this.#lastSend;
    if (edge || (changed && since >= CHANGE_MIN_MS) || since >= INPUT_MS)
      this.#send(now, mx, my, st.attack, st.shoot, st.dodge, st.skill, st.interact, ax, ay);
  }

  #send(
    now: number,
    mx: number,
    my: number,
    attack: boolean,
    shoot: boolean,
    dodge: boolean,
    skill: number,
    interact: boolean,
    ax: number | undefined,
    ay: number | undefined,
  ): void {
    const t = this.#transport;
    if (!t) return;
    const message: Extract<ClientMsg, { t: "input" }> = {
      t: "input",
      seq: ++this.#seq,
      mx,
      my,
      attack,
      shoot,
      dodge,
      skill,
      interact,
    };
    if (ax !== undefined && ay !== undefined) {
      message.ax = ax;
      message.ay = ay;
    }
    t.send(message);
    this.#lastSend = now;
    const last = this.#sent;
    last.mx = mx;
    last.my = my;
    last.attack = attack;
    last.shoot = shoot;
    last.dodge = dodge;
    if (mx || my || attack || shoot || dodge) this.#zeroSent = false;
  }

  #drawDev(unit: number): void {
    const s = this.stats.summary();
    const world = this.scene.world.stats;
    const c = this.store.clock;
    const cam = this.rig.camera;
    const lines = [
      `fps ${this.stats.fps}  frame ${s.gapAvg.toFixed(1)}ms (max ${s.gapMax.toFixed(1)})`,
      `work avg ${s.workAvg.toFixed(2)}ms  p95 ${s.workP95.toFixed(2)}  max ${s.workMax.toFixed(2)}`,
      `canvas ${cam.width}x${cam.height} scale ${cam.scale} unit ${unit.toFixed(2)}`,
      `ents ${this.store.list.length}  particles ${this.scene.effects.count}`,
      `snap ${c.intervalMs.toFixed(0)}ms tick ${c.tickMs.toFixed(1)}ms lag ${c.lagMs.toFixed(1)}ms`,
      `delay remote ${this.store.remoteDelay.toFixed(0)}ms self ${this.store.selfDelay.toFixed(0)}ms`,
      `chunks ${world.cachedChunks} built ${world.builtLastFrame} (${world.buildMsLastFrame.toFixed(1)}ms)`,
      `ping ${this.#rtt === null ? "-" : `${Math.round(this.#rtt)}ms`}  seq ${this.#seq}`,
    ];
    drawDevOverlay(this.#deps.surface.ctx, lines, unit);
  }
}
