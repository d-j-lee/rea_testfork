// Scripted stand-in for the game host, for visual checks of the client core
// without the real simulation: 한양, 1450 — the hero and companions fight
// bandits and their chief inside the walls. Emits welcome/enter/self/snap/fx
// exactly like a host would, at 20 Hz.
import type { GameHost, HostConnection } from "../../src/shared/host/api.ts";
import type { ServerMsg } from "../../src/shared/protocol.ts";
import type { Anim, CharacterSprite, Dir, PropSprite } from "../../src/shared/sprites.ts";
import type { ChapterView, EntityKind, EntitySnap, FxEvent, Marker, SelfView, Team } from "../../src/shared/types.ts";

const TICK_MS = 50;
const CX = 75;
const CY = 185;

interface Actor {
  id: number;
  k: EntityKind;
  s: CharacterSprite | PropSprite;
  tm: Team;
  x: number;
  y: number;
  d: Dir;
  a: Anim;
  animStart: number;
  hp: number;
  n?: string;
  title?: string;
  lvl?: number;
  v?: "m" | "f";
  mk?: Marker;
  down?: boolean;
  hist?: boolean;
  /** Ticks until a respawn (dead fodder). */
  respawn?: number;
  home: { x: number; y: number };
}

const CHAPTER: ChapterView = {
  id: "ch05",
  order: 5,
  title: "세종의 치세",
  subtitle: "한양, 경자년의 봄",
  years: [1450, 1450],
  briefing: [],
  history: [],
  music: "court",
  season: "spring",
  weather: "clear",
  hour: 15.5,
  montage: false,
};

function actor(a: Omit<Actor, "animStart" | "home" | "d" | "a"> & { d?: Dir; a?: Anim }): Actor {
  return { d: "down", a: "idle", animStart: 0, home: { x: a.x, y: a.y }, ...a };
}

export function createMockHost(): GameHost {
  let send: ((m: ServerMsg) => void) | null = null;
  let tick = 0;
  let started = -1;
  let last = 0;
  const actors: Actor[] = [
    actor({ id: 1, k: "player", s: "hero_joseon_general", tm: "self", x: CX - 1, y: CY + 0.5, hp: 72, n: "장생", title: "오백년의 무사", lvl: 24 }),
    actor({ id: 2, k: "bot", s: "hero_youth", tm: "player", x: CX - 3, y: CY + 1.5, hp: 90, n: "달래", lvl: 19, v: "f" }),
    actor({ id: 3, k: "bot", s: "hero_goryeo_officer", tm: "player", x: CX - 4.5, y: CY - 0.2, hp: 0, n: "무진", lvl: 21, down: true }),
    actor({ id: 4, k: "ally", s: "soldier_joseon", tm: "ally", x: CX - 2.5, y: CY - 1.2, hp: 100, n: "관군" }),
    actor({ id: 5, k: "ally", s: "archer_joseon", tm: "ally", x: CX - 5, y: CY + 2.2, hp: 64, n: "궁수", d: "right" }),
    actor({ id: 6, k: "npc", s: "merchant", tm: "npc", x: CX - 6.5, y: CY - 2.4, hp: 100, n: "보부상", mk: "quest" }),
    actor({ id: 7, k: "npc", s: "scholar", tm: "npc", x: CX + 3.6, y: CY - 3.4, hp: 100, n: "집현전 학사", mk: "talk", hist: true }),
    actor({ id: 10, k: "enemy", s: "bandit", tm: "enemy", x: CX + 1.6, y: CY + 0.6, hp: 45, n: "화적", lvl: 18, d: "left" }),
    actor({ id: 11, k: "enemy", s: "bandit", tm: "enemy", x: CX + 2.8, y: CY + 2.0, hp: 80, n: "화적", lvl: 17, d: "left" }),
    actor({ id: 12, k: "enemy", s: "rebel", tm: "enemy", x: CX + 3.0, y: CY - 0.8, hp: 100, n: "난군", lvl: 18, d: "left" }),
    actor({ id: 13, k: "enemy", s: "wolf", tm: "enemy", x: CX + 1.0, y: CY + 2.6, hp: 30, n: "들개", lvl: 12, d: "left" }),
    actor({ id: 14, k: "enemy", s: "bandit", tm: "boss", x: CX + 5.2, y: CY + 0.6, hp: 68, n: "흑풍", title: "흑풍채 두목", lvl: 26, d: "left" }),
    actor({ id: 20, k: "prop", s: "chest", tm: "npc", x: CX - 6.8, y: CY + 2.0, hp: 100, mk: "questDone" }),
    actor({ id: 21, k: "prop", s: "campfire", tm: "npc", x: CX + 6.0, y: CY + 3.0, hp: 100 }),
    actor({ id: 22, k: "prop", s: "banner", tm: "npc", x: CX - 3.0, y: CY - 3.0, hp: 100 }),
  ];
  const byId = new Map(actors.map((a) => [a.id, a]));
  const at = (id: number) => byId.get(id) as Actor;

  const setAnim = (a: Actor, anim: Anim, now: number) => {
    if (a.a !== anim || anim === "attack" || anim === "shoot" || anim === "hurt") a.animStart = now;
    a.a = anim;
  };

  const selfView = (): SelfView =>
    ({
      id: 1,
      name: "장생",
      birthName: "장생",
      hp: Math.round(at(1).hp * 4.2),
      maxHp: 420,
      year: 1450,
      chapter: { id: "ch05", title: "세종의 치세", order: 5, stepYear: 1450 },
      demo: true,
      battle: {
        id: "b_hanyang_bandits",
        title: "흑풍채 토벌",
        kind: "boss",
        x: CX + 1.5,
        y: CY + 0.8,
        radius: 7,
        boss: { name: "흑풍", hp: 68, title: "흑풍채 두목" },
        participants: 4,
      },
      objectives: [
        { id: "o1", text: "흑풍을 쓰러뜨리기", done: false, optional: false, x: CX + 5.2, y: CY + 0.6 },
        { id: "o2", text: "경복궁에 보고하기", done: false, optional: false, x: CX - 2, y: CY - 30, siteName: "경복궁" },
        { id: "o3", text: "약초 모으기", done: false, optional: true, x: CX + 30, y: CY + 9, siteName: "왕십리" },
      ],
    }) as unknown as SelfView;

  function step(now: number): void {
    tick++;
    const t = (now - started) / 1000;
    const fx: FxEvent[] = [];
    const self = at(1);
    // Hero paces between the companions and the bandits, slashing.
    const phase = t % 2.4;
    const prevX = self.x;
    self.x = CX - 1 + Math.sin(t * 1.3) * 1.2;
    self.y = CY + 0.5 + Math.sin(t * 0.7) * 0.3;
    const moving = Math.abs(self.x - prevX) > 0.004;
    self.d = phase < 1.2 ? "right" : self.x > prevX ? "right" : "left";
    if (tick % 16 === 0) {
      setAnim(self, "attack", now);
      self.d = "right";
      fx.push({ k: "slash", x: self.x, y: self.y, d: "right" }, { k: "sfx", x: self.x, y: self.y, sfx: "swing" });
      const target = at(10).hp > 0 ? at(10) : at(11);
      const crit = tick % 32 === 0;
      const dmg = crit ? 128 + (tick % 7) : 31 + (tick % 13);
      target.hp = Math.max(0, target.hp - (crit ? 22 : 9));
      setAnim(target, "hurt", now);
      fx.push(
        { k: "spark", x: target.x, y: target.y - 0.9 },
        { k: "text", x: target.x, y: target.y, text: String(dmg), crit },
        { k: "sfx", x: target.x, y: target.y, sfx: crit ? "crit" : "hit" },
      );
      if (crit) fx.push({ k: "shake", x: target.x, y: target.y, power: 3, angle: 0 }, { k: "hitstop", x: 0, y: 0, power: 70 });
    } else if (self.a === "attack" && now - self.animStart > 360) setAnim(self, moving ? "walk" : "idle", now);
    else if (self.a !== "attack") setAnim(self, moving ? "walk" : "idle", now);

    // Archer volleys at the wolf / boss.
    const archer = at(5);
    if (tick % 22 === 5) {
      setAnim(archer, "shoot", now);
      const target = at(13).hp > 0 ? at(13) : at(14);
      fx.push({ k: "arrow", x: archer.x, y: archer.y, tx: target.x, ty: target.y }, { k: "sfx", x: archer.x, y: archer.y, sfx: "bow" });
    }
    if (tick % 22 === 10) {
      const target = at(13).hp > 0 ? at(13) : at(14);
      target.hp = Math.max(0, target.hp - 12);
      fx.push({ k: "text", x: target.x, y: target.y, text: String(18 + (tick % 9)), color: "#ffd0a0" });
      setAnim(target, "hurt", now);
    }
    // Companion trades blows with the rebel.
    const bot = at(2);
    if (tick % 14 === 3) {
      setAnim(bot, "attack", now);
      bot.d = "right";
      fx.push({ k: "thrust", x: bot.x, y: bot.y, d: "right" });
      const rebel = at(12);
      rebel.hp = Math.max(0, rebel.hp - 7);
      fx.push({ k: "text", x: rebel.x, y: rebel.y, text: String(14 + (tick % 5)) });
    }
    // The chief winds up a ground slam: circle telegraph, then a cone.
    const boss = at(14);
    if (tick % 40 === 2) fx.push({ k: "telegraph", x: boss.x, y: boss.y, tg: { shape: "circle", x: boss.x - 1.5, y: boss.y + 0.5, r: 2.2, ms: 1500 } });
    if (tick % 40 === 20) fx.push({ k: "telegraph", x: boss.x, y: boss.y, tg: { shape: "cone", x: boss.x, y: boss.y, angle: Math.PI, spread: 1.1, r: 4, ms: 1100 } });
    if (tick % 40 === 32) {
      setAnim(boss, "attack", now);
      fx.push(
        { k: "explosion", x: boss.x - 1.5, y: boss.y + 0.5 },
        { k: "shake", x: boss.x, y: boss.y, power: 5, angle: Math.PI },
        { k: "sfx", x: boss.x, y: boss.y, sfx: "explosion" },
      );
      self.hp = Math.max(20, self.hp - 9);
    }
    // Rebel line charge telegraph.
    if (tick % 30 === 8) {
      const r = at(12);
      fx.push({ k: "telegraph", x: r.x, y: r.y, tg: { shape: "line", x: r.x, y: r.y, tx: r.x - 4, ty: r.y + 0.6, ms: 900 } });
    }
    // Fodder dies into ink and comes back.
    for (const a of actors) {
      if (a.k !== "enemy") continue;
      if (a.hp <= 0 && a.a !== "dead") {
        setAnim(a, "dead", now);
        a.respawn = 26;
        fx.push({ k: "sfx", x: a.x, y: a.y, sfx: "enemy_death" });
      } else if (a.a === "dead" && a.respawn !== undefined && --a.respawn <= 0) {
        a.hp = 100;
        a.x = a.home.x + 0.8;
        a.y = a.home.y;
        a.respawn = undefined;
        setAnim(a, "idle", now);
      } else if (a.a === "hurt" && now - a.animStart > 260) setAnim(a, "idle", now);
      else if (a.a === "idle" && a.hp > 0) a.x += (a.home.x - a.x) * 0.1;
    }
    for (const id of [5, 2]) {
      const a = at(id);
      if ((a.a === "shoot" || a.a === "attack") && now - a.animStart > 420) setAnim(a, "idle", now);
    }
    const ents: EntitySnap[] = actors.map((a) => {
      const e: EntitySnap = { id: a.id, k: a.k, s: a.s, x: a.x, y: a.y, d: a.d, a: a.a, at: Math.round(now - a.animStart), tm: a.tm, hp: a.hp };
      if (a.n) e.n = a.n;
      if (a.title) e.title = a.title;
      if (a.lvl) e.lvl = a.lvl;
      if (a.v) e.v = a.v;
      if (a.mk) e.mk = a.mk;
      if (a.down) e.down = true;
      if (a.hist) e.hist = true;
      return e;
    });
    emit({ t: "snap", tick, ents, gone: [] });
    if (fx.length) emit({ t: "fx", fx });
    if (tick % 4 === 0) emit({ t: "self", self: selfView() });
  }

  function emit(message: ServerMsg): void {
    send?.(message);
  }

  return {
    connect(fn) {
      send = fn;
      const connection: HostConnection = {
        receive(message) {
          if ((message as { t?: string }).t !== "hello") return;
          started = performance.now();
          last = started;
          emit({ t: "welcome", v: 1, token: "preview", mode: "offline", seed: "jangsaeng", motd: "", resumed: false });
          emit({ t: "enter", you: 1, chapter: CHAPTER, channel: "preview" });
          emit({ t: "self", self: selfView() });
        },
        close() {
          send = null;
        },
      };
      return connection;
    },
    tick(now) {
      if (started < 0) return;
      let steps = 0;
      while (now - last >= TICK_MS && steps++ < 8) {
        last += TICK_MS;
        step(last);
      }
    },
    stats: () => ({ players: 1, bots: 2, channels: 1, tick }),
    flush() {},
  };
}
