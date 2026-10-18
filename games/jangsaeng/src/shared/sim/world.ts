// CONTRACT STUB — implemented by the simulation pass. One World is one era
// channel instance: the shared map at a year, the chapter's NPCs, ambient
// spawns, battles, players (humans and simulated companions), projectiles.
// Units are tiles and seconds. Deterministic given seed and inputs.
import type { ContentIndex } from "../content/index.ts";
import type { ChapterDef, EnemyDef } from "../content/schema.ts";
import type { GameMap } from "../map/generate.ts";
import type { Derived } from "../rules/index.ts";
import type { BodyVariant, CharacterSprite } from "../sprites.ts";
import type { BattleView, EntitySnap, FxEvent, Marker } from "../types.ts";

export interface PlayerInput {
  mx: number;
  my: number;
  attack: boolean;
  shoot: boolean;
  dodge: boolean;
  /** 1-4 skill slots, 5 = 노인성 일섬, 0 none (edge-triggered). */
  skill: number;
  interact: boolean;
  /** Aim direction in tiles (optional). */
  ax?: number;
  ay?: number;
}

export interface PlayerSpec {
  id: number;
  kind: "player" | "bot";
  name: string;
  title: string;
  sprite: CharacterSprite;
  variant: BodyVariant;
  level: number;
  derived: Derived;
  /** Equipped skill ids by slot (index 0 = slot 1). */
  skills: readonly string[];
  /** Spawn position in tiles. */
  x: number;
  y: number;
}

export interface WorldHooks {
  /** An enemy died; `killers` are player ids credited (last hitter first). */
  onKill(enemy: EnemyDef, level: number, boss: boolean, killers: readonly number[]): void;
  onBattleEnd(battleId: string, result: "victory" | "defeat", participants: readonly number[]): void;
  /** Player pressed interact near an NPC. */
  onTalk(playerId: number, npcId: string): void;
  onPickup(playerId: number, item: string): void;
  onDowned(playerId: number): void;
  /** Revived by an ally (`by`) or by self-revive (by = null). */
  onRevived(playerId: number, by: number | null): void;
  /** 노인성 일섬 fired (session charges one lifespan year). */
  onLongevity(playerId: number): void;
  /** Per-viewer marker over an NPC (quest giver "!" etc.). */
  npcMarker(playerId: number, npcId: string): Marker | undefined;
}

export interface PlayerStatus {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  stamina: number;
  downed: number | null;
  /** Seconds until each equipped skill is ready (slot order). */
  cooldowns: number[];
  longevityReady: number;
}

export interface WorldOptions {
  content: ContentIndex;
  chapter: ChapterDef;
  map: GameMap;
  year: number;
  seed: string;
  hooks: WorldHooks;
}

const todo = (name: string): never => {
  throw new Error(`World.${name} not implemented`);
};

export class World {
  constructor(options: WorldOptions) {
    void options;
  }
  /** Chapter step changed for this channel's story phase (NPC/spawn windows). */
  setStep(stepId: string): void {
    void stepId;
    todo("setStep");
  }
  addPlayer(spec: PlayerSpec): void {
    void spec;
    todo("addPlayer");
  }
  /** Refresh level/derived/sprite/skills after progression changes. */
  updatePlayer(id: number, patch: Partial<Omit<PlayerSpec, "id" | "kind" | "x" | "y">>): void {
    void id;
    void patch;
    todo("updatePlayer");
  }
  removePlayer(id: number): void {
    void id;
    todo("removePlayer");
  }
  setInput(id: number, input: PlayerInput): void {
    void id;
    void input;
    todo("setInput");
  }
  teleport(id: number, x: number, y: number): void {
    void id;
    void x;
    void y;
    todo("teleport");
  }
  /** Heals to full (chapter start, rest). */
  restore(id: number): void {
    void id;
    todo("restore");
  }
  /** Self-revive at the nearest post station with 50% HP. */
  selfRevive(id: number): void {
    void id;
    todo("selfRevive");
  }
  heal(id: number, amount: number): void {
    void id;
    void amount;
    todo("heal");
  }
  /** Starts a battle from the chapter's battles if none is active. */
  startBattle(battleId: string, starterId: number): boolean {
    void battleId;
    void starterId;
    return todo("startBattle");
  }
  /** Ends any active battle without result (chapter change, demo skip). */
  abortBattle(): void {
    todo("abortBattle");
  }
  battleView(): BattleView | null {
    return todo("battleView");
  }
  tick(dt: number): void {
    void dt;
    todo("tick");
  }
  /** Entities within the interest radius of a player, plus removed ids. */
  snapshotFor(id: number): { ents: EntitySnap[]; gone: number[] } {
    void id;
    return todo("snapshotFor");
  }
  /** Effects produced since the last call, with world positions. */
  drainFx(): FxEvent[] {
    return todo("drainFx");
  }
  playerStatus(id: number): PlayerStatus | null {
    void id;
    return todo("playerStatus");
  }
  /** Site id whose rectangle contains the player, if any. */
  siteOf(id: number): string | null {
    void id;
    return todo("siteOf");
  }
  /** Positions for UI markers. */
  npcPosition(npcId: string): { x: number; y: number } | null {
    void npcId;
    return todo("npcPosition");
  }
  sitePosition(siteId: string): { x: number; y: number } | null {
    void siteId;
    return todo("sitePosition");
  }
  /** Read-only queries used by companion bots. */
  query(): WorldQuery {
    return todo("query");
  }
}

export interface WorldQuery {
  nearestEnemy(x: number, y: number, radius: number): { id: number; x: number; y: number } | null;
  downedAllies(x: number, y: number, radius: number): { id: number; x: number; y: number }[];
  player(id: number): { x: number; y: number; hp: number; maxHp: number; downed: boolean } | null;
  battleCentre(): { x: number; y: number; radius: number } | null;
  /** True when the tile is walkable. */
  walkable(x: number, y: number): boolean;
}
