// OpenStreetMap JSON -> plain geometry in metres. One block is one metre; the map is a
// SIZE x SIZE square (about a kilometre) centred on the chosen place, x pointing east and z pointing south.

export const SIZE = 1024;
export type Pt = [x: number, z: number];

export interface Road {
  id: number;
  nodeIds: number[];
  points: Pt[];
  kind: string;
  name: string;
  oneway: boolean;
  /** Lanes painted on the road, both directions together, as the map says (1 to 12). */
  lanes: number;
  /** Metres per second. */
  limit: number;
  /** Surface width in blocks. */
  width: number;
  rank: number;
}

export interface Building {
  id: number;
  /** As the map names it, if it does: a landmark a passenger might ask for. */
  name: string;
  points: Pt[];
  height: number;
  /** A landmark in bare stone rather than a house with windows. */
  monument: boolean;
  /** A triumphal arch or a city gate: you can see through it. */
  arch: boolean;
}

export interface CityMap {
  roads: Road[];
  buildings: Building[];
  water: Pt[][];
  /** Holes in the water: islands in a river or a lake. */
  islands: Pt[][];
  /** Fountain basins, which get a centrepiece. */
  basins: Pt[][];
  /** The sea's edge. OpenStreetMap draws it with the land on the left and the water on the right. */
  coast: Pt[][];
  /** Fountains mapped as a single point. */
  fountains: Pt[];
  green: Pt[][];
  trees: Pt[];
  crossings: Pt[];
  /** OSM node ids carrying a traffic signal, a stop sign or a give-way sign. */
  signals: Set<number>;
  signs: Map<number, 'stop' | 'give_way'>;
}

interface Element {
  type: 'node' | 'way' | 'relation';
  members?: Array<{ type: string; ref: number; role: string }>;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

const RANK: Record<string, number> = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 0 };
const WIDTH: Record<string, number> = { motorway: 12, trunk: 11, primary: 10, secondary: 9, tertiary: 8, unclassified: 7, residential: 7, living_street: 5, service: 4 };
const LIMIT_KMH: Record<string, number> = { motorway: 90, trunk: 70, primary: 50, secondary: 50, tertiary: 40, unclassified: 40, residential: 30, living_street: 20, service: 15 };

export function parseOsm(osm: { elements: Element[] }, lat0: number, lon0: number): CityMap {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const at = new Map<number, Pt>();
  for (const e of osm.elements) if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) at.set(e.id, [(e.lon - lon0) * kx + SIZE / 2, -(e.lat - lat0) * 111320 + SIZE / 2]);

  const ways = new Map<number, number[]>();
  for (const e of osm.elements) if (e.type === 'way' && e.nodes) ways.set(e.id, e.nodes);
  const map: CityMap = { roads: [], buildings: [], water: [], islands: [], basins: [], coast: [], fountains: [], green: [], trees: [], crossings: [], signals: new Set(), signs: new Map() };
  for (const e of osm.elements) {
    const tags = e.tags ?? {};
    if (e.type === 'node') {
      const p = at.get(e.id);
      if (!p) continue;
      if (tags.highway === 'traffic_signals') map.signals.add(e.id);
      else if (tags.highway === 'stop' || tags.highway === 'give_way') map.signs.set(e.id, tags.highway);
      else if (tags.highway === 'crossing') map.crossings.push(p);
      if (tags.natural === 'tree') map.trees.push(p);
      if (tags.amenity === 'fountain') map.fountains.push(p);
      continue;
    }
    if (e.type === 'relation') {
      // Big blocks with courtyards are drawn as an outline plus holes; the outline is what stands on the street.
      if (tags.building) rings(e.members ?? [], 'outer', ways, at).forEach((ring, n) => map.buildings.push(building(e.id * 8 + n, tags, ring)));
      if (tags.natural === 'water') for (const role of ['outer', 'inner'] as const) for (const ring of rings(e.members ?? [], role, ways, at)) (role === 'outer' ? map.water : map.islands).push(ring);
      continue;
    }
    const ids = (e.nodes ?? []).filter((id) => at.has(id));
    const points = ids.map((id) => at.get(id)!);
    if (points.length < 2) continue;
    if (tags.highway) {
      const kind = tags.highway.replace(/_link$/, '');
      if (!(kind in RANK) || tags.area === 'yes' || tags.access === 'private' || tags.service === 'parking_aisle' || tags.service === 'driveway') continue;
      const oneway = tags.oneway === 'yes' || tags.junction === 'roundabout' || tags.junction === 'circular' || kind === 'motorway';
      const lanes = Math.max(1, Math.min(12, Math.round(Number(tags.lanes)) || (oneway ? 1 : 2)));
      const limit = (Number.parseInt(tags.maxspeed ?? '', 10) || LIMIT_KMH[kind]) / 3.6;
      const reversed = tags.oneway === '-1';
      map.roads.push({
        id: e.id,
        nodeIds: reversed ? [...ids].reverse() : ids,
        points: reversed ? [...points].reverse() : points,
        kind,
        name: tags.name ?? '',
        oneway: oneway || reversed,
        lanes,
        limit,
        width: Math.max(WIDTH[kind] - (oneway ? 2 : 0), lanes * 3.2 + 1),
        rank: RANK[kind] - (tags.highway.endsWith('_link') ? 0.5 : 0),
      });
    } else if (tags.building) {
      map.buildings.push(building(e.id, tags, points));
    } else if (tags.natural === 'coastline') map.coast.push(points);
    else if (tags.natural === 'water' || tags.amenity === 'fountain') {
      map.water.push(points);
      if (tags.amenity === 'fountain') map.basins.push(points);
    }
    else if (tags.leisure || tags.landuse) map.green.push(points);
  }
  return map;
}

/** A big lake or a river comes as loose pieces of shoreline; join them end to end into closed rings. */
function rings(members: Array<{ type: string; ref: number; role: string }>, role: string, ways: Map<number, number[]>, at: Map<number, Pt>): Pt[][] {
  const pieces = members.filter((m) => m.type === 'way' && (m.role || 'outer') === role).map((m) => ways.get(m.ref)).filter((n): n is number[] => Boolean(n && n.length > 1)).map((n) => [...n]);
  const closed: Pt[][] = [];
  while (pieces.length) {
    const ring = pieces.pop()!;
    for (let joined = true; joined && ring[0] !== ring[ring.length - 1]; ) {
      joined = false;
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        const end = ring[ring.length - 1];
        if (piece[0] !== end && piece[piece.length - 1] !== end) continue;
        ring.push(...(piece[0] === end ? piece : [...piece].reverse()).slice(1));
        pieces.splice(i, 1);
        joined = true;
        break;
      }
    }
    const points = ring.map((id) => at.get(id)).filter((p): p is Pt => Boolean(p));
    if (points.length > 3) closed.push(points);
  }
  return closed;
}

function building(id: number, tags: Record<string, string>, points: Pt[]): Building {
  const levels = Number(tags['building:levels']);
  const tall = Number.parseFloat(tags.height ?? '');
  // No height in the data: a plausible one, the same every time for the same building.
  const guess = 7 + (((id * 2654435761) % 1000) / 1000) * 9;
  const arch = tags.building === 'triumphal_arch' || tags.historic === 'city_gate' || (/\b(arc|arch|arche|porte|gate|tor|arco)\b/i.test(tags.name ?? '') && Boolean(tags.historic || tags.tourism));
  const monument = arch || Boolean(tags.historic === 'monument' || tags.historic === 'memorial' || tags.amenity === 'place_of_worship' || tags.building === 'church' || tags.building === 'cathedral');
  return { id, name: tags.name ?? '', points, monument, arch, height: Math.round(Math.min(56, Number.isFinite(tall) ? tall : levels > 0 ? levels * 3.1 + 1 : monument ? 18 : guess)) };
}
