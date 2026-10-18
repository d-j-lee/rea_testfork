import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROVINCE_LIST,
  collisionFor,
  generateMap,
  lonLatToTile,
  siteAt,
  structuresAt,
} from "../../src/shared/map/generate.ts";
import { findPath } from "../../src/shared/map/pathfind.ts";
import { TILE_INFO, Tile, type TileId } from "../../src/shared/map/tiles.ts";

const map = generateMap("jangsaeng");
const tileAt = (x: number, y: number) => map.tiles[y * map.width + x] as TileId;

test("generation is deterministic for a seed", () => {
  const again = generateMap("jangsaeng");
  assert.deepEqual(again.tiles, map.tiles);
  assert.deepEqual(again.structures, map.structures);
  const other = generateMap("other-seed");
  assert.notDeepEqual(other.tiles, map.tiles);
});

test("every site centre is walkable land in every era", () => {
  for (const year of [1380, 1450, 1600, 1800, 1905]) {
    const blocked = collisionFor(map, year);
    for (const site of map.sites) {
      const i = site.y * map.width + site.x;
      assert.equal(blocked[i], 0, `${site.id} blocked in ${year}`);
    }
  }
});

test("geography lands where Korea is", () => {
  // Seas west of the peninsula and east of it; land in the middle.
  const yellowSea = lonLatToTile([125.0, 36.5]);
  const eastSea = lonLatToTile([130.3, 37.5]);
  const sobaek = lonLatToTile([128.0, 36.6]);
  assert.ok(
    TILE_INFO[tileAt(Math.floor(yellowSea.x), Math.floor(yellowSea.y))].water,
  );
  assert.ok(
    TILE_INFO[tileAt(Math.floor(eastSea.x), Math.floor(eastSea.y))].water,
  );
  assert.ok(
    !TILE_INFO[tileAt(Math.floor(sobaek.x), Math.floor(sobaek.y))].water,
  );
  const jeju = map.sites.find((site) => site.id === "jeju");
  assert.equal(jeju?.province, "jeju");
  const hoeryeong = map.sites.find((site) => site.id === "hoeryeong");
  assert.equal(hoeryeong?.province, "hamgyeong");
});

test("island provinces stay on their islands", () => {
  const provinceAt = (x: number, y: number) => PROVINCE_LIST[map.province[y * map.width + x] ?? -1];
  const site = (id: string) => {
    const found = map.sites.find((candidate) => candidate.id === id);
    assert.ok(found, id);
    return found;
  };
  // The south coast reads 경상/전라 all around its ports (통영, 동래·부산, 울돌목).
  for (const [id, home] of [["tongyeong", "gyeongsang"], ["dongnae", "gyeongsang"], ["myeongnyang", "jeolla"]] as const) {
    const s = site(id);
    assert.equal(s.province, home, id);
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const p = provinceAt(s.x + dx, s.y + dy);
        assert.ok(p !== "tsushima" && p !== "jeju", `${p} at ${id} ${dx},${dy}`);
      }
  }
  assert.equal(site("tsushima").province, "tsushima");
  assert.equal(site("jeju").province, "jeju");
  // No tile of the peninsula's landmass is labelled an island province.
  const land = (i: number) => !TILE_INFO[map.tiles[i] as TileId].water || map.tiles[i] === Tile.River;
  const seen = new Uint8Array(map.width * map.height);
  let largest: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !land(start)) continue;
    const part = [start];
    seen[start] = 1;
    for (let k = 0; k < part.length; k++) {
      const i = part[k] as number;
      const x = i % map.width;
      for (const j of [x > 0 ? i - 1 : -1, x < map.width - 1 ? i + 1 : -1, i - map.width, i + map.width])
        if (j >= 0 && j < seen.length && !seen[j] && land(j)) {
          seen[j] = 1;
          part.push(j);
        }
    }
    if (part.length > largest.length) largest = part;
  }
  const strays = largest.filter((i) => ["tsushima", "jeju"].includes(PROVINCE_LIST[map.province[i] ?? -1] ?? ""));
  assert.deepEqual(strays, []);
});

test("sea battlefields are fleets of deck moored to the peninsula", () => {
  const blocked = collisionFor(map, 1598);
  const hanyang = map.sites.find((site) => site.id === "hanyang");
  assert.ok(hanyang);
  for (const id of ["hansan_sea", "noryang_sea", "myeongnyang"]) {
    const site = map.sites.find((candidate) => candidate.id === id);
    assert.ok(site, id);
    let decks = 0;
    for (let y = site.y - 4; y <= site.y + 4; y++)
      for (let x = site.x - 4; x <= site.x + 4; x++) if (tileAt(x, y) === Tile.Deck) decks++;
    assert.ok(decks >= 12, `${id}: ${decks} deck tiles`);
    const path = findPath(map.width, map.height, hanyang, site, (x, y) => (blocked[y * map.width + x] ? Infinity : 1));
    assert.ok(path.length > 0, `${id} is reached on foot`);
  }
});

test("trunk roads connect the capital to the frontiers on foot", () => {
  const year = 1600;
  const blocked = collisionFor(map, year);
  const hanyang = map.sites.find((site) => site.id === "hanyang");
  assert.ok(hanyang);
  for (const id of ["uiju", "dongnae", "hoeryeong", "jinju", "gangneung"]) {
    const target = map.sites.find((site) => site.id === id);
    assert.ok(target, id);
    const path = findPath(map.width, map.height, hanyang, target, (x, y) =>
      blocked[y * map.width + x] ? Infinity : 1,
    );
    assert.ok(path.length > 0, `no walkable route hanyang→${id}`);
  }
});

test("era overlays change names, roles and structures", () => {
  const hanyang = map.sites.find((site) => site.id === "hanyang");
  assert.ok(hanyang);
  assert.equal(siteAt(hanyang, 1388).kind, "town");
  assert.equal(siteAt(hanyang, 1400).kind, "capital");
  const palaceIn = (year: number) =>
    structuresAt(map, year).filter(
      (structure) =>
        structure.siteId === "hanyang" && structure.kind.startsWith("palace"),
    );
  assert.equal(palaceIn(1388).length, 0);
  assert.equal(palaceIn(1450)[0]?.kind, "palace");
  assert.equal(palaceIn(1700)[0]?.kind, "palace_ruin");
  assert.equal(palaceIn(1880)[0]?.kind, "palace");
});

test("rivers exist and some are bridged by roads", () => {
  let river = 0;
  let bridge = 0;
  for (const tile of map.tiles) {
    if (tile === Tile.River) river++;
    if (tile === Tile.Bridge) bridge++;
  }
  assert.ok(river > 300, `river tiles ${river}`);
  assert.ok(bridge > 10, `bridge tiles ${bridge}`);
});
