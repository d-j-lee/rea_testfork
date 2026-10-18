// Deterministic world-map generation. Server, offline host and client all call
// generateMap(seed) and obtain identical tiles, sites and structures, so the
// map never travels over the network.
import { createRng } from "../rng.ts";
import {
  ISLANDS,
  MAINLAND,
  MAP_BOUNDS,
  PASSES,
  PROVINCE_ANCHORS,
  RIDGES,
  RIVERS,
  SITES,
  type LonLat,
  type Province,
  type SiteKind,
  type SiteSource,
} from "./geo.ts";
import { createNoise } from "./noise.ts";
import { findPath } from "./pathfind.ts";
import { TILE_INFO, Tile, type TileId } from "./tiles.ts";

export const MAP_WIDTH = 176;
export const MAP_HEIGHT = 320;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StructureKind =
  | "wall"
  | "giwa_house"
  | "choga_house"
  | "palace"
  | "palace_ruin"
  | "pavilion"
  | "market"
  | "beacon"
  | "ship"
  | "tent"
  | "jangseung"
  | "great_tree"
  | "pagoda"
  | "well"
  | "flag";

export interface Structure {
  id: number;
  kind: StructureKind;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  siteId?: string;
  /** Inclusive year range in which the structure stands. */
  from?: number;
  to?: number;
  /** Deterministic art variation seed. */
  variant: number;
}

export interface Site {
  id: string;
  name: string;
  hanja?: string;
  kind: SiteKind;
  /** Centre tile. */
  x: number;
  y: number;
  rect: Rect;
  province: Province;
  station: boolean;
}

export interface GameMap {
  seed: string;
  width: number;
  height: number;
  tiles: Uint8Array;
  /** Index into PROVINCE_LIST for every tile (sea tiles use the nearest). */
  province: Uint8Array;
  /** 0..255 relief used for shading and terrain choice. */
  elevation: Uint8Array;
  sites: Site[];
  structures: Structure[];
}

export const PROVINCE_LIST: readonly Province[] = [
  "gyeonggi",
  "chungcheong",
  "jeolla",
  "gyeongsang",
  "gangwon",
  "hwanghae",
  "pyeongan",
  "hamgyeong",
  "jeju",
  "liaodong",
  "tsushima",
];

const { west, east, north, south } = MAP_BOUNDS;

export const lonLatToTile = ([lon, lat]: LonLat): { x: number; y: number } => ({
  x: ((lon - west) / (east - west)) * MAP_WIDTH,
  y: ((north - lat) / (north - south)) * MAP_HEIGHT,
});

export const tileToLonLat = (x: number, y: number): LonLat => [
  west + (x / MAP_WIDTH) * (east - west),
  north - (y / MAP_HEIGHT) * (north - south),
];

/** Era-dependent names and roles of sites. */
export function siteAt(
  site: Site,
  year: number,
): { name: string; kind: SiteKind } {
  switch (site.id) {
    case "hanyang":
      return year < 1394
        ? { name: "남경(한양)", kind: "town" }
        : { name: "한양", kind: "capital" };
    case "gaegyeong":
      return year < 1394
        ? { name: "개경", kind: "capital" }
        : { name: "개성", kind: "city" };
    case "suwon":
      return year < 1796
        ? { name: "수원", kind: "town" }
        : { name: "수원 화성", kind: "fortress" };
    case "tongyeong":
      return year < 1604
        ? { name: "두룡포(한산)", kind: "port" }
        : { name: "통영(통제영)", kind: "port" };
    default:
      return { name: site.name, kind: site.kind };
  }
}

const FOOTPRINT: Readonly<Record<SiteKind, readonly [number, number]>> = {
  capital: [15, 13],
  city: [11, 9],
  town: [9, 7],
  fortress: [9, 9],
  port: [9, 7],
  battlefield: [7, 7],
  village: [7, 5],
  frontier: [9, 7],
};

/** Historic trunk roads (대로) and important branches between sites. */
const ROAD_NETWORK: readonly (readonly [string, string])[] = [
  ["hanyang", "gaegyeong"],
  ["gaegyeong", "haeju"],
  ["gaegyeong", "pyeongyang"],
  ["pyeongyang", "uiju"],
  ["uiju", "wihwado"],
  ["hanyang", "chungju"],
  ["chungju", "mungyeong"],
  ["mungyeong", "sangju"],
  ["sangju", "daegu"],
  ["daegu", "dongnae"],
  ["daegu", "gyeongju"],
  ["gyeongju", "dongnae"],
  ["sangju", "andong"],
  ["hanyang", "suwon"],
  ["suwon", "gongju"],
  ["gongju", "jeonju"],
  ["gongju", "jinpo"],
  ["jeonju", "gobu"],
  ["jeonju", "gwangju"],
  ["gwangju", "myeongnyang"],
  ["jeonju", "hwangsan"],
  ["hwangsan", "jinju"],
  ["jinju", "noryang"],
  ["jinju", "tongyeong"],
  ["jinju", "daegu"],
  ["hanyang", "wonju"],
  ["wonju", "gangneung"],
  ["hanyang", "hamheung"],
  ["hamheung", "gyeongseong"],
  ["gyeongseong", "hoeryeong"],
  ["hanyang", "ganghwa"],
  ["hanyang", "namhansanseong"],
  ["hanyang", "haengju"],
  ["hanyang", "jemulpo"],
  ["wonju", "chungju"],
];

function pointInPolygon(lon: number, lat: number, poly: readonly LonLat[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as LonLat;
    const [xj, yj] = poly[j] as LonLat;
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

interface Polyline {
  readonly points: readonly { x: number; y: number }[];
  /** Cumulative length at each point; last entry is the total length. */
  readonly cumulative: readonly number[];
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function polyline(points: readonly { x: number; y: number }[]): Polyline {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    cumulative.push(
      (cumulative[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y),
    );
  }
  return {
    points,
    cumulative,
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** Distance from a point to a polyline (tile units) and the normalised
 * position along it (0 = first point, 1 = last point). */
function distanceToPath(
  x: number,
  y: number,
  line: Polyline,
): { distance: number; t: number } {
  const { points, cumulative } = line;
  const total = cumulative[cumulative.length - 1] as number;
  let best = Infinity;
  let bestT = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const u = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq),
    );
    const d = Math.hypot(a.x + dx * u - x, a.y + dy * u - y);
    if (d < best) {
      best = d;
      bestT =
        total > 0
          ? ((cumulative[i - 1] as number) + Math.sqrt(lengthSq) * u) / total
          : 0;
    }
  }
  return { distance: best, t: bestT };
}

const BORDER_LINE: readonly LonLat[] = [
  ...[...(RIVERS.find((river) => river.id === "amnok")?.path ?? [])].reverse(),
  ...(RIVERS.find((river) => river.id === "duman")?.path ?? []),
];

/** Latitude of the Amnok–Duman border at a longitude (null east/west of it). */
function borderLatitude(lon: number): number | null {
  for (let i = 1; i < BORDER_LINE.length; i++) {
    const [lon0, lat0] = BORDER_LINE[i - 1] as LonLat;
    const [lon1, lat1] = BORDER_LINE[i] as LonLat;
    if (lon >= Math.min(lon0, lon1) && lon <= Math.max(lon0, lon1)) {
      const u = lon1 === lon0 ? 0 : (lon - lon0) / (lon1 - lon0);
      return lat0 + (lat1 - lat0) * u;
    }
  }
  return null;
}

export function generateMap(seed = "jangsaeng"): GameMap {
  const W = MAP_WIDTH;
  const H = MAP_HEIGHT;
  const noise = createNoise(`${seed}:terrain`);
  const coastNoise = createNoise(`${seed}:coast`);
  const moisture = createNoise(`${seed}:moisture`);
  const rng = createRng(`${seed}:layout`);
  const tiles = new Uint8Array(W * H);
  const elevation = new Uint8Array(W * H);
  const land = new Uint8Array(W * H);
  const index = (x: number, y: number) => y * W + x;

  // 1. Land mask with noisy coastline.
  const islandShapes = ISLANDS.map((island) => {
    const c = lonLatToTile(island.centre);
    const r = lonLatToTile([west + island.rx, north - island.ry]);
    return { ...island, cx: c.x, cy: c.y, rx: r.x, ry: r.y };
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const jx = (coastNoise.fbm(x / 9, y / 9, 3) - 0.5) * 3.2;
      const jy = (coastNoise.fbm(x / 9 + 50, y / 9 + 50, 3) - 0.5) * 3.2;
      const [lon, lat] = tileToLonLat(x + 0.5 + jx, y + 0.5 + jy);
      let isLand = pointInPolygon(lon, lat, MAINLAND);
      if (!isLand) {
        const wobble = 1 + (coastNoise.value(x / 3, y / 3) - 0.5) * 0.35;
        for (const island of islandShapes) {
          if (Math.abs(x + 0.5 - island.cx) > island.rx * 1.3 + 1) continue;
          if (Math.abs(y + 0.5 - island.cy) > island.ry * 1.3 + 1) continue;
          const nx = (x + 0.5 - island.cx) / Math.max(0.6, island.rx * wobble);
          const ny = (y + 0.5 - island.cy) / Math.max(0.6, island.ry * wobble);
          if (nx * nx + ny * ny <= 1) {
            isLand = true;
            break;
          }
        }
      }
      land[index(x, y)] = isLand ? 1 : 0;
    }
  }

  // 2. Distance to land (for sea depth) and to sea (for beaches).
  const seaDistance = distanceField(land, W, H, 1);
  const landDistance = distanceField(land, W, H, 0);

  // 3. Elevation from ridges + noise.
  const ridgePaths = RIDGES.map((ridge) => ({
    radius: lonLatToTile([west + ridge.radius, north]).x,
    line: polyline(ridge.path.map(lonLatToTile)),
  }));
  const passPoints = PASSES.map((pass) => lonLatToTile(pass.at));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = index(x, y);
      if (!land[i]) continue;
      let ridge = 0;
      for (const { radius, line } of ridgePaths) {
        const reach = radius * 3;
        if (
          x < line.minX - reach ||
          x > line.maxX + reach ||
          y < line.minY - reach ||
          y > line.maxY + reach
        )
          continue;
        const { distance } = distanceToPath(x + 0.5, y + 0.5, line);
        ridge = Math.max(ridge, Math.exp(-((distance / radius) ** 2)));
      }
      const rough = noise.fbm(x / 14, y / 14, 4);
      const detail = noise.fbm(x / 4 + 100, y / 4 + 100, 2);
      const coastFalloff = Math.min(1, (landDistance[i] ?? 0) / 6);
      let e = ridge * 0.72 + (rough - 0.35) * 0.5 + (detail - 0.5) * 0.14;
      e = e * (0.45 + 0.55 * coastFalloff);
      for (const pass of passPoints) {
        const d = Math.hypot(x + 0.5 - pass.x, y + 0.5 - pass.y);
        if (d < 3.2) e = Math.min(e, 0.42 + d * 0.04);
      }
      elevation[i] = Math.max(0, Math.min(255, Math.round(e * 255)));
    }
  }

  // 4. Base terrain.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = index(x, y);
      if (!land[i]) {
        const d = seaDistance[i] ?? 99;
        tiles[i] = d <= 1 ? Tile.Shallow : d <= 5 ? Tile.Sea : Tile.DeepSea;
        continue;
      }
      const e = (elevation[i] ?? 0) / 255;
      const m = moisture.fbm(x / 11, y / 11, 3);
      const [lon, lat] = tileToLonLat(x + 0.5, y + 0.5);
      const coastal = (landDistance[i] ?? 9) <= 1;
      let tile: TileId;
      if (e > 0.78) tile = Tile.Peak;
      else if (e > 0.58)
        tile = lat > 40.6 && e > 0.66 ? Tile.Snow : Tile.Mountain;
      else if (e > 0.44) tile = m > 0.55 ? Tile.Forest : Tile.Hill;
      else if (coastal)
        tile = lon < 126.9 && lat < 38.2 && m > 0.45 ? Tile.Marsh : Tile.Sand;
      else if (m > 0.62) tile = Tile.Forest;
      else if (m < 0.36) tile = Tile.Meadow;
      else tile = Tile.Grass;
      tiles[i] = tile;
    }
  }

  // 5. Rivers, tapered from source to mouth with gentle meanders.
  for (const river of RIVERS) {
    const line = polyline(river.path.map(lonLatToTile));
    const minX = Math.max(0, Math.floor(line.minX - 4));
    const maxX = Math.min(W - 1, Math.ceil(line.maxX + 4));
    const minY = Math.max(0, Math.floor(line.minY - 4));
    const maxY = Math.min(H - 1, Math.ceil(line.maxY + 4));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = index(x, y);
        const mx = (noise.value(x / 5 + 300, y / 5) - 0.5) * 1.6;
        const my = (noise.value(x / 5, y / 5 + 300) - 0.5) * 1.6;
        const { distance, t } = distanceToPath(
          x + 0.5 + mx,
          y + 0.5 + my,
          line,
        );
        const halfWidth = (0.45 + (river.width - 0.45) * t) / 2 + 0.25;
        if (distance <= halfWidth && land[i]) {
          tiles[i] = Tile.River;
          elevation[i] = Math.min(elevation[i] ?? 0, 60);
        }
      }
    }
  }

  // 6. Provinces: Voronoi over anchors, with the Amnok–Duman border.
  const anchors = PROVINCE_ANCHORS.map((anchor) => ({
    province: anchor.province,
    ...lonLatToTile(anchor.at),
  }));
  const province = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [lon, lat] = tileToLonLat(x + 0.5, y + 0.5);
      const border = borderLatitude(lon);
      let chosen: Province;
      if (border !== null && lat > border + 0.04) chosen = "liaodong";
      else if (border === null && lat > 41.0) chosen = "liaodong";
      else {
        let best = Infinity;
        chosen = "gyeonggi";
        for (const anchor of anchors) {
          if (anchor.province === "liaodong") continue;
          const d = (anchor.x - x) ** 2 + (anchor.y - y) ** 2;
          if (d < best) {
            best = d;
            chosen = anchor.province;
          }
        }
      }
      province[index(x, y)] = PROVINCE_LIST.indexOf(chosen);
    }
  }

  // 7. Sites: stamp footprints.
  const sites: Site[] = SITES.map((source) => placeSite(source));
  function placeSite(source: SiteSource): Site {
    const centre = lonLatToTile(source.at);
    const [fw, fh] = FOOTPRINT[source.kind];
    const cx = Math.floor(centre.x);
    const cy = Math.floor(centre.y);
    const rect = {
      x: Math.max(1, cx - Math.floor(fw / 2)),
      y: Math.max(1, cy - Math.floor(fh / 2)),
      w: fw,
      h: fh,
    };
    const site: Site = {
      id: source.id,
      name: source.name,
      kind: source.kind,
      x: cx,
      y: cy,
      rect,
      province: PROVINCE_LIST[province[index(cx, cy)] ?? 0] ?? "gyeonggi",
      station: source.station,
    };
    if (source.hanja) site.hanja = source.hanja;
    return site;
  }
  for (const site of sites) stampSite(site);
  function stampSite(site: Site) {
    const { rect } = site;
    const naval = site.kind === "battlefield" && !land[index(site.x, site.y)];
    if (naval) {
      // Sea battles are fought on a moored fleet's decks.
      for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++)
        for (let x = rect.x; x < rect.x + rect.w; x++)
          if (x >= 0 && y >= 0 && x < W && y < H && !land[index(x, y)])
            tiles[index(x, y)] = Tile.Deck;
      tiles[index(site.x, site.y)] = Tile.Deck;
      return;
    }
    const ground = site.kind === "battlefield" ? Tile.Grass : Tile.TownGround;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = index(x, y);
        const current = tiles[i] as TileId;
        if (current === Tile.River) tiles[i] = Tile.Bridge;
        else if (land[i]) tiles[i] = ground;
        // Ports keep their sea tiles; ships are placed there.
      }
    }
    if (site.kind !== "battlefield") tiles[index(site.x, site.y)] = Tile.Plaza;
  }

  // 8. Roads with A* over terrain costs; rivers become bridges.
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const cost = (x: number, y: number): number => {
    const tile = tiles[index(x, y)] as TileId;
    switch (tile) {
      case Tile.Road:
      case Tile.Bridge:
        return 0.55;
      case Tile.TownGround:
      case Tile.Plaza:
        return 0.7;
      case Tile.River:
        return 7;
      case Tile.Peak:
        return 40;
      case Tile.Mountain:
      case Tile.Snow:
        return 6;
      case Tile.Hill:
        return 2.2;
      case Tile.Forest:
        return 1.6;
      case Tile.Marsh:
        return 2.5;
      default:
        return TILE_INFO[tile].water ? Infinity : 1;
    }
  };
  for (const [fromId, toId] of ROAD_NETWORK) {
    const from = siteById.get(fromId);
    const to = siteById.get(toId);
    if (!from || !to) continue;
    const path = findPath(W, H, from, to, cost);
    for (const step of path) {
      const i = index(step.x, step.y);
      const tile = tiles[i] as TileId;
      if (tile === Tile.River) tiles[i] = Tile.Bridge;
      else if (
        tile !== Tile.TownGround &&
        tile !== Tile.Plaza &&
        tile !== Tile.Bridge
      )
        tiles[i] = Tile.Road;
    }
  }

  // 9. Paddies around southern lowland settlements.
  for (const site of sites) {
    if (site.kind === "battlefield" || site.kind === "frontier") continue;
    const [, lat] = tileToLonLat(site.x, site.y);
    if (lat > 39.5) continue;
    const radius = site.kind === "capital" ? 11 : 8;
    for (let y = site.y - radius; y <= site.y + radius; y++) {
      for (let x = site.x - radius; x <= site.x + radius; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = index(x, y);
        const tile = tiles[i] as TileId;
        if (tile !== Tile.Grass && tile !== Tile.Meadow) continue;
        const d = Math.hypot(x - site.x, y - site.y) / radius;
        if (d < 1 && moisture.value(x / 2.5, y / 2.5) > 0.35 + d * 0.4)
          tiles[i] = Tile.Paddy;
      }
    }
  }

  // 10. Structures inside sites.
  const structures: Structure[] = [];
  let nextId = 1;
  const add = (structure: Omit<Structure, "id" | "variant">) => {
    structures.push({ ...structure, id: nextId++, variant: rng.int(0, 255) });
  };
  for (const site of sites) layoutSite(site, add);

  // Ports get ships on adjacent shallow water.
  for (const site of sites) {
    if (site.kind !== "port" && site.id !== "ganghwa") continue;
    const spots = shallowAround(site);
    for (const spot of spots.slice(0, site.id === "tongyeong" ? 3 : 2))
      add({
        kind: "ship",
        x: spot.x,
        y: spot.y,
        w: 3,
        h: 2,
        solid: true,
        siteId: site.id,
      });
  }
  function shallowAround(site: Site): { x: number; y: number }[] {
    const found: { x: number; y: number }[] = [];
    for (let r = 2; r < 9 && found.length < 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = site.x + dx;
          const y = site.y + dy;
          if (x < 1 || y < 1 || x + 3 >= W || y + 2 >= H) continue;
          let ok = true;
          for (let yy = y; yy < y + 2 && ok; yy++)
            for (let xx = x; xx < x + 3 && ok; xx++)
              ok =
                tiles[index(xx, yy)] === Tile.Shallow ||
                tiles[index(xx, yy)] === Tile.Sea;
          if (
            ok &&
            found.every((f) => Math.abs(f.x - x) > 3 || Math.abs(f.y - y) > 2)
          )
            found.push({ x, y });
        }
      }
    }
    return found;
  }

  return {
    seed,
    width: W,
    height: H,
    tiles,
    province,
    elevation,
    sites,
    structures,
  };

  function layoutSite(site: Site, emit: typeof add) {
    const { rect } = site;
    const walled =
      site.kind === "capital" ||
      site.kind === "fortress" ||
      site.kind === "city";
    const roadAt = (x: number, y: number) => {
      const tile = tiles[index(x, y)];
      return tile === Tile.Road || tile === Tile.Bridge || tile === Tile.Plaza;
    };
    const free = new Uint8Array(rect.w * rect.h);
    const mark = (x: number, y: number, w: number, h: number) => {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const lx = xx - rect.x;
          const ly = yy - rect.y;
          if (lx >= 0 && ly >= 0 && lx < rect.w && ly < rect.h)
            free[ly * rect.w + lx] = 1;
        }
    };
    const canPlace = (x: number, y: number, w: number, h: number) => {
      for (let yy = y - 1; yy < y + h + 1; yy++)
        for (let xx = x - 1; xx < x + w + 1; xx++) {
          const lx = xx - rect.x;
          const ly = yy - rect.y;
          if (lx < 0 || ly < 0 || lx >= rect.w || ly >= rect.h) {
            if (xx >= x && xx < x + w && yy >= y && yy < y + h) return false;
            continue;
          }
          if (xx >= x && xx < x + w && yy >= y && yy < y + h) {
            const tile = tiles[index(xx, yy)] as TileId;
            if (free[ly * rect.w + lx] || roadAt(xx, yy)) return false;
            if (tile !== Tile.TownGround && tile !== Tile.Grass) return false;
          }
        }
      return true;
    };
    // Plaza and roads stay open.
    mark(site.x, site.y, 1, 1);
    if (walled) {
      const from =
        site.id === "hanyang" ? 1396 : site.id === "suwon" ? 1796 : undefined;
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        for (const y of [rect.y, rect.y + rect.h - 1]) {
          if (!roadAt(x, y) && x !== site.x) {
            emit({
              kind: "wall",
              x,
              y,
              w: 1,
              h: 1,
              solid: true,
              siteId: site.id,
              ...(from ? { from } : {}),
            });
          }
          mark(x, y, 1, 1);
        }
      }
      for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++) {
        for (const x of [rect.x, rect.x + rect.w - 1]) {
          if (!roadAt(x, y) && y !== site.y) {
            emit({
              kind: "wall",
              x,
              y,
              w: 1,
              h: 1,
              solid: true,
              siteId: site.id,
              ...(from ? { from } : {}),
            });
          }
          mark(x, y, 1, 1);
        }
      }
    }
    if (site.kind === "capital") {
      const px = site.x - 2;
      const py = rect.y + 2;
      if (site.id === "hanyang") {
        emit({
          kind: "palace",
          x: px,
          y: py,
          w: 5,
          h: 3,
          solid: true,
          siteId: site.id,
          from: 1395,
          to: 1591,
        });
        emit({
          kind: "palace_ruin",
          x: px,
          y: py,
          w: 5,
          h: 3,
          solid: false,
          siteId: site.id,
          from: 1592,
          to: 1867,
        });
        emit({
          kind: "palace",
          x: px,
          y: py,
          w: 5,
          h: 3,
          solid: true,
          siteId: site.id,
          from: 1868,
        });
      } else {
        emit({
          kind: "palace",
          x: px,
          y: py,
          w: 5,
          h: 3,
          solid: true,
          siteId: site.id,
          to: 1394,
        });
      }
      mark(px, py, 5, 4);
      for (let x = site.x - 1; x <= site.x + 1; x++)
        mark(x, py + 3, 1, rect.y + rect.h - py - 3);
    }
    if (site.kind === "fortress" || site.kind === "frontier") {
      const bx = rect.x + 1;
      const by = rect.y + 1;
      if (canPlace(bx, by, 1, 1)) {
        emit({
          kind: "beacon",
          x: bx,
          y: by,
          w: 1,
          h: 1,
          solid: true,
          siteId: site.id,
        });
        mark(bx, by, 1, 1);
      }
      const vx = site.x - 1;
      const vy = rect.y + 1;
      if (canPlace(vx, vy, 3, 2)) {
        emit({
          kind: "pavilion",
          x: vx,
          y: vy,
          w: 3,
          h: 2,
          solid: true,
          siteId: site.id,
        });
        mark(vx, vy, 3, 2);
      }
    }
    if (site.kind === "battlefield") {
      for (let k = 0; k < 3; k++) {
        const fx = rect.x + 1 + k * 2;
        const fy = rect.y + (k % 2) + 1;
        if (canPlace(fx, fy, 1, 1)) {
          emit({
            kind: "flag",
            x: fx,
            y: fy,
            w: 1,
            h: 1,
            solid: false,
            siteId: site.id,
          });
          mark(fx, fy, 1, 1);
        }
      }
      return;
    }
    // Market stalls along the main street of cities and capitals.
    if (
      site.kind === "capital" ||
      site.kind === "city" ||
      site.kind === "port"
    ) {
      for (let k = -3; k <= 3; k += 2) {
        const mx = site.x + k;
        const my = site.y + 2;
        if (canPlace(mx, my, 1, 1)) {
          emit({
            kind: "market",
            x: mx,
            y: my,
            w: 1,
            h: 1,
            solid: true,
            siteId: site.id,
          });
          mark(mx, my, 1, 1);
        }
      }
    }
    if (canPlace(site.x + 2, site.y - 2, 1, 1)) {
      emit({
        kind: "well",
        x: site.x + 2,
        y: site.y - 2,
        w: 1,
        h: 1,
        solid: true,
        siteId: site.id,
      });
      mark(site.x + 2, site.y - 2, 1, 1);
    }
    const village = site.kind === "village" || site.kind === "frontier";
    const houseKind: StructureKind = village ? "choga_house" : "giwa_house";
    let houses = 0;
    const limit = site.kind === "capital" ? 18 : site.kind === "city" ? 10 : 6;
    for (
      let y = rect.y + 1;
      y < rect.y + rect.h - 2 && houses < limit;
      y += 3
    ) {
      for (
        let x = rect.x + 1;
        x < rect.x + rect.w - 2 && houses < limit;
        x += 3
      ) {
        const ox = x + (rng.chance(0.3) ? 1 : 0);
        if (!canPlace(ox, y, 2, 2)) continue;
        const kind: StructureKind =
          !village && rng.chance(0.25) ? "choga_house" : houseKind;
        emit({ kind, x: ox, y, w: 2, h: 2, solid: true, siteId: site.id });
        mark(ox, y, 2, 2);
        houses++;
      }
    }
    if (village) {
      if (canPlace(rect.x, site.y, 1, 1)) {
        emit({
          kind: "jangseung",
          x: rect.x,
          y: site.y,
          w: 1,
          h: 1,
          solid: true,
          siteId: site.id,
        });
        mark(rect.x, site.y, 1, 1);
      }
      if (canPlace(rect.x + rect.w - 2, rect.y, 2, 2)) {
        emit({
          kind: "great_tree",
          x: rect.x + rect.w - 2,
          y: rect.y,
          w: 2,
          h: 2,
          solid: true,
          siteId: site.id,
        });
      }
    }
    if (site.id === "gyeongju" && canPlace(rect.x + 1, rect.y + 1, 1, 2)) {
      emit({
        kind: "pagoda",
        x: rect.x + 1,
        y: rect.y + 1,
        w: 1,
        h: 2,
        solid: true,
        siteId: site.id,
      });
    }
  }
}

/** BFS distance (Chebyshev steps) from cells whose land value equals `target`. */
function distanceField(
  land: Uint8Array,
  width: number,
  height: number,
  target: 0 | 1,
): Uint16Array {
  const distance = new Uint16Array(width * height).fill(65535);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < land.length; i++)
    if (land[i] === target) {
      distance[i] = 0;
      queue[tail++] = i;
    }
  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % width;
    const y = (i - x) / width;
    const next = (distance[i] as number) + 1;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if ((distance[j] as number) > next) {
          distance[j] = next;
          queue[tail++] = j;
        }
      }
  }
  return distance;
}

/** Structures standing in a given year. */
export const structuresAt = (map: GameMap, year: number): Structure[] =>
  map.structures.filter(
    (structure) =>
      (structure.from === undefined || year >= structure.from) &&
      (structure.to === undefined || year <= structure.to),
  );

/** Walkability grid for a year: 1 = blocked. */
export function collisionFor(map: GameMap, year: number): Uint8Array {
  const blocked = new Uint8Array(map.width * map.height);
  for (let i = 0; i < blocked.length; i++)
    blocked[i] = TILE_INFO[map.tiles[i] as TileId].speed === 0 ? 1 : 0;
  for (const structure of structuresAt(map, year)) {
    if (!structure.solid) continue;
    for (let y = structure.y; y < structure.y + structure.h; y++)
      for (let x = structure.x; x < structure.x + structure.w; x++)
        if (x >= 0 && y >= 0 && x < map.width && y < map.height)
          blocked[y * map.width + x] = 1;
  }
  return blocked;
}
