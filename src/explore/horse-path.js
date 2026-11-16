// The horse's street graph (pure, unit-tested). Built from town.json, never hard-coded positions:
//  - a spine down the main street at the door rows of the side buildings (street centre x = 0),
//  - a detour round the Bounty Board (it stands in the street) to the station forecourt,
//  - back lanes behind both rows of buildings (7 m past the building centres),
//  - spurs to the dock base (the horse never steps onto the dock) and to the lighthouse.
// At runtime horse.js drops any edge the town BVH blocks (rocks, props) before planning; the test
// samples every edge against the real building footprints.

const near = (a, b, d) => Math.abs(a - b) < d;

export function buildStreetGraph(town, { laneOffset = 7, northGap = 10 } = {}) {
  const L = town?.landmarks ?? {};
  const all = Object.values(L).filter((l) => l && Array.isArray(l.center));
  const side = all.filter((l) => l.zone && Array.isArray(l.door) && Math.abs(l.center[0] - l.door[0]) > 3);
  const nodes = [];
  const edges = [];
  const add = (id, x, z) => {
    nodes.push({ id, x, z });
    return id;
  };
  const link = (a, b) => {
    if (a && b && a !== b && !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) edges.push([a, b]);
  };

  // Spine: one node per door row (doors within 2 m share a row), plus the north end.
  const rows = [];
  for (const z of side.map((l) => l.door[2]).sort((a, b) => b - a)) {
    const row = rows.find((r) => near(r.z, z, 2));
    if (row) row.z = (row.z + z) / 2;
    else rows.push({ z });
  }
  const north = add('north', 0, (rows[0]?.z ?? 0) + northGap);
  let prev = north;
  rows.forEach((r, i) => {
    const id = add(`row${i}`, 0, r.z);
    link(prev, id);
    prev = id;
  });

  // South: round the Bounty Board on the side away from it, then the station forecourt.
  const bounty = all.find((l) => l.zone === 'projects');
  const station = all.find((l) => l.zone === 'journey');
  const forecourt = station ? add('forecourt', station.door[0], station.door[2] + 7) : null;
  if (bounty) {
    const s = bounty.center[0] <= 0 ? 1 : -1;
    const a = add('bounty-a', bounty.center[0] + s * 2.8, bounty.door[2] - 0.8);
    const b = add('bounty-b', bounty.center[0] + s * 4.1, bounty.center[2] - 0.4);
    link(prev, a);
    link(a, b);
    link(b, forecourt);
  } else link(prev, forecourt);

  // Back lanes behind each row of buildings, joined to the north end and the forecourt.
  for (const sgn of [-1, 1]) {
    const row = side.filter((l) => Math.sign(l.center[0]) === sgn);
    if (!row.length) continue;
    const x = sgn * (Math.max(...row.map((l) => Math.abs(l.center[0]))) + laneOffset);
    const zs = row.map((l) => l.center[2]).sort((a, b) => b - a);
    const tag = sgn < 0 ? 'west' : 'east';
    const top = add(`${tag}-n`, x, nodes.find((n) => n.id === 'north').z);
    link(north, top);
    let last = top;
    zs.forEach((z, i) => {
      const id = add(`${tag}${i}`, x, z);
      link(last, id);
      last = id;
    });
    const bottom = add(`${tag}-s`, x, zs[zs.length - 1] - 8);
    link(last, bottom);
    link(bottom, forecourt);
  }

  // Spurs: the dock base (on the sand, short of the planks) and the lighthouse.
  const dock = L.dock;
  if (dock?.center) link(north, add('dock-base', dock.center[0], dock.center[2] - 12));
  const light = L.lighthouse;
  if (light?.center) {
    const id = add('lighthouse', light.center[0] + 10, light.center[2] - 6);
    link(north, id);
    if (dock?.center) link(id, 'dock-base');
  }
  return { nodes, edges };
}

/** Adjacency map { id: [{ id, d }] } for the given edges. */
export function adjacency({ nodes, edges }) {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const [a, b] of edges) {
    const d = Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).z - pos.get(b).z);
    adj.get(a).push({ id: b, d });
    adj.get(b).push({ id: a, d });
  }
  return adj;
}

/** A* over the graph → [node ids] from `from` to `to`, or null when disconnected. */
export function findPath(graph, from, to) {
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!pos.has(from) || !pos.has(to)) return null;
  const adj = adjacency(graph);
  const h = (id) => Math.hypot(pos.get(id).x - pos.get(to).x, pos.get(id).z - pos.get(to).z);
  const g = new Map([[from, 0]]);
  const came = new Map();
  const open = new Set([from]);
  while (open.size) {
    let cur = null;
    for (const id of open) if (cur === null || g.get(id) + h(id) < g.get(cur) + h(cur)) cur = id;
    if (cur === to) {
      const path = [cur];
      while (came.has(path[0])) path.unshift(came.get(path[0]));
      return path;
    }
    open.delete(cur);
    for (const { id, d } of adj.get(cur)) {
      const t = g.get(cur) + d;
      if (t < (g.get(id) ?? Infinity)) {
        g.set(id, t);
        came.set(id, cur);
        open.add(id);
      }
    }
  }
  return null;
}

/** Path length in metres. */
export const pathLength = (graph, ids) => {
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));
  let d = 0;
  for (let i = 1; i < ids.length; i += 1) d += Math.hypot(pos.get(ids[i]).x - pos.get(ids[i - 1]).x, pos.get(ids[i]).z - pos.get(ids[i - 1]).z);
  return d;
};

/** Nodes sorted by distance to (x, z). */
export const byDistance = (graph, x, z) => [...graph.nodes].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
