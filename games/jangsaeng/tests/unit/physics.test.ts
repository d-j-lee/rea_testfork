import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lineOfSight,
  moveBody,
  nearestFree,
  type CollisionGrid,
} from "../../src/shared/sim/physics.ts";
import { SpatialIndex } from "../../src/shared/sim/spatial.ts";

/** '#' = blocked, '.' = open. */
function grid(rows: string[]): CollisionGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const blocked = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++)
      blocked[y * width + x] = row[x] === "#" ? 1 : 0;
  });
  return {
    width,
    height,
    blocked,
    tiles: new Uint8Array(width * height).fill(4),
  };
}

const room = grid([
  "#######",
  "#.....#",
  "#.....#",
  "#..#..#",
  "#.....#",
  "#######",
]);

test("bodies stop flush against walls and slide along them", () => {
  const body = { x: 2.5, y: 2.5, radius: 0.3 };
  const hit = moveBody(room, body, 10, 0);
  assert.equal(hit, true);
  assert.ok(body.x > 5.6 && body.x < 5.7, `x=${body.x}`);
  // Diagonal into the wall keeps the free axis.
  const slide = { x: 5.6, y: 2.5, radius: 0.3 };
  moveBody(room, slide, 1, 1);
  assert.ok(slide.x < 5.71);
  assert.ok(slide.y > 3.4, `y=${slide.y}`);
});

test("fast bodies do not tunnel through one-tile pillars", () => {
  const body = { x: 1.5, y: 3.5, radius: 0.3 };
  moveBody(room, body, 4, 0);
  assert.ok(body.x < 2.71, `tunnelled to ${body.x}`);
});

test("nearestFree and lineOfSight respect blocking", () => {
  assert.deepEqual(nearestFree(room, 3.5, 3.5), { x: 2.5, y: 2.5 });
  assert.equal(lineOfSight(room, 1.5, 3.5, 5.5, 3.5), false);
  assert.equal(lineOfSight(room, 1.5, 1.5, 5.5, 1.5), true);
});

test("spatial index queries by radius and tracks moves", () => {
  const index = new SpatialIndex<{ id: number; x: number; y: number }>(4);
  const a = { id: 1, x: 1, y: 1 };
  const b = { id: 2, x: 10, y: 10 };
  index.insert(a);
  index.insert(b);
  assert.deepEqual(
    index.query(0, 0, 3).map((item) => item.id),
    [1],
  );
  b.x = 2;
  b.y = 2;
  index.update(b);
  assert.equal(index.query(0, 0, 3).length, 2);
  assert.equal(index.nearest(2.2, 2.2, 5)?.id, 2);
  index.remove(a);
  assert.equal(index.size, 1);
});
