// Grid A* (4-neighbour) with a binary heap. Used for road generation and for
// long-range NPC routing; costs of Infinity are impassable.

export interface Point {
  x: number;
  y: number;
}

export function findPath(
  width: number,
  height: number,
  from: Point,
  to: Point,
  cost: (x: number, y: number) => number,
  maxExpanded = width * height,
): Point[] {
  const size = width * height;
  const g = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  // Lazy-deletion min-heap of (priority, node) pairs.
  const nodes: number[] = [];
  const prios: number[] = [];
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const minCost = 0.5;
  const h = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    return (Math.abs(x - to.x) + Math.abs(y - to.y)) * minCost;
  };
  const push = (node: number, prio: number) => {
    let child = nodes.length;
    nodes.push(node);
    prios.push(prio);
    while (child > 0) {
      const up = (child - 1) >> 1;
      if ((prios[up] as number) <= prio) break;
      nodes[child] = nodes[up] as number;
      prios[child] = prios[up] as number;
      child = up;
    }
    nodes[child] = node;
    prios[child] = prio;
  };
  const pop = (): number => {
    const top = nodes[0] as number;
    const lastNode = nodes.pop() as number;
    const lastPrio = prios.pop() as number;
    const n = nodes.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let m = -1;
        let best = lastPrio;
        if (left < n && (prios[left] as number) < best) {
          m = left;
          best = prios[left] as number;
        }
        if (right < n && (prios[right] as number) < best) m = right;
        if (m === -1) break;
        nodes[i] = nodes[m] as number;
        prios[i] = prios[m] as number;
        i = m;
      }
      nodes[i] = lastNode;
      prios[i] = lastPrio;
    }
    return top;
  };
  g[start] = 0;
  push(start, h(start));
  let expanded = 0;
  while (nodes.length > 0 && expanded < maxExpanded) {
    const current = pop();
    if (closed[current]) continue;
    if (current === goal) break;
    closed[current] = 1;
    expanded++;
    const x = current % width;
    const y = (current - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (closed[next]) continue;
      const step = next === goal ? 1 : cost(nx, ny);
      if (!Number.isFinite(step)) continue;
      const tentative = (g[current] as number) + step;
      if (tentative < (g[next] as number)) {
        g[next] = tentative;
        parent[next] = current;
        push(next, tentative + h(next));
      }
    }
  }
  if (parent[goal] === -1 && goal !== start) return [];
  const path: Point[] = [];
  for (let i = goal; i !== -1; i = parent[i] as number) {
    const x = i % width;
    path.push({ x, y: (i - x) / width });
    if (i === start) break;
  }
  return path.reverse();
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
