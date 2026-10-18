// Terrain tile vocabulary shared by generation, collision and rendering.
// Values are stable on the wire and in saves; append new tiles at the end.

export const Tile = {
  DeepSea: 0,
  Sea: 1,
  Shallow: 2,
  Sand: 3,
  Grass: 4,
  Meadow: 5,
  Forest: 6,
  Hill: 7,
  Mountain: 8,
  Peak: 9,
  River: 10,
  Road: 11,
  Bridge: 12,
  Paddy: 13,
  Snow: 14,
  Marsh: 15,
  TownGround: 16,
  Plaza: 17,
  Ford: 18,
  /** Wooden ship deck stamped over water for naval battle sites. */
  Deck: 19,
} as const;

export type TileId = (typeof Tile)[keyof typeof Tile];

export interface TileInfo {
  readonly name: string;
  /** Movement speed multiplier; 0 means impassable on foot. */
  readonly speed: number;
  readonly water: boolean;
}

export const TILE_INFO: Readonly<Record<TileId, TileInfo>> = {
  [Tile.DeepSea]: { name: "깊은 바다", speed: 0, water: true },
  [Tile.Sea]: { name: "바다", speed: 0, water: true },
  [Tile.Shallow]: { name: "얕은 바다", speed: 0, water: true },
  [Tile.Sand]: { name: "모래밭", speed: 0.9, water: false },
  [Tile.Grass]: { name: "들판", speed: 1, water: false },
  [Tile.Meadow]: { name: "풀밭", speed: 1, water: false },
  [Tile.Forest]: { name: "솔숲", speed: 0.8, water: false },
  [Tile.Hill]: { name: "구릉", speed: 0.75, water: false },
  [Tile.Mountain]: { name: "산", speed: 0.55, water: false },
  [Tile.Peak]: { name: "험준한 봉우리", speed: 0, water: false },
  [Tile.River]: { name: "강", speed: 0, water: true },
  [Tile.Road]: { name: "길", speed: 1.25, water: false },
  [Tile.Bridge]: { name: "다리", speed: 1.2, water: false },
  [Tile.Paddy]: { name: "논", speed: 0.85, water: false },
  [Tile.Snow]: { name: "눈 덮인 고원", speed: 0.7, water: false },
  [Tile.Marsh]: { name: "갯벌", speed: 0.6, water: false },
  [Tile.TownGround]: { name: "마을", speed: 1.15, water: false },
  [Tile.Plaza]: { name: "광장", speed: 1.15, water: false },
  [Tile.Ford]: { name: "여울", speed: 0.6, water: false },
  [Tile.Deck]: { name: "판옥선 갑판", speed: 1, water: false },
};

export const isWaterTile = (tile: TileId): boolean => TILE_INFO[tile].water;
