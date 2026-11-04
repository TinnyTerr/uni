/**
 * Buildings and getting between them. A location string like "MB 2.14" is
 * resolved against the building registry by its code or name; whatever is left
 * over is the room.
 */
import type { AppState, Building, Connector, Floor, Room } from './types';
import { occurrencesOn, type Occurrence } from './occurrences';

/** Raster tiles for the map. Swap for a self-hosted or paid source if needed. */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';

/** Half-width of the default box given to a building that has no bounds, in metres. */
const DEFAULT_HALF_M = 20;

export type Bounds = [number, number, number, number];

/** [south, west, north, east] for a building, defaulting to a small box round its pin. */
export function boundsOf(b: Building): Bounds {
  if (b.bounds) return b.bounds;
  const dLat = DEFAULT_HALF_M / 111_320;
  const dLng = DEFAULT_HALF_M / (111_320 * Math.max(0.1, Math.cos((b.lat * Math.PI) / 180)));
  return [b.lat - dLat, b.lng - dLng, b.lat + dLat, b.lng + dLng];
}

export type Pt = [number, number];

/** The building's outline: its drawn points, or the corners of its box. */
export function pointsOf(b: Building): Pt[] {
  if (b.points && b.points.length >= 3) return b.points;
  const [s, w, n, e] = boundsOf(b);
  return [[s, w], [s, e], [n, e], [n, w]];
}

/** Bounding box of an outline as [south, west, north, east]. */
export function boundsFromPoints(pts: Pt[]): Bounds {
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  return [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)];
}

export function centreOf(bounds: Bounds): { lat: number; lng: number } {
  return { lat: (bounds[0] + bounds[2]) / 2, lng: (bounds[1] + bounds[3]) / 2 };
}

/** Normalise two opposite corners into [south, west, north, east]. */
export function boxFrom(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Bounds {
  return [Math.min(a.lat, b.lat), Math.min(a.lng, b.lng), Math.max(a.lat, b.lat), Math.max(a.lng, b.lng)];
}

/** Walking pace in metres per minute (about 4.8 km/h), padded for corners. */
const WALK_M_PER_MIN = 80;
const ROUTE_FACTOR = 1.3;

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Whole minutes to walk between two buildings, never less than one. Walking is
 * edge to edge, not centre to centre, so big buildings next to each other are
 * not penalised for their size. A passage between them is a straight line.
 */
export function walkMinutes(a: Building, b: Building): number {
  if (a.id === b.id) return 0;
  const factor = passageBetween(a, b) ? 1 : ROUTE_FACTOR;
  return Math.max(1, Math.ceil((gapM(a, b) * factor) / WALK_M_PER_MIN));
}

/** Distance between the nearest edges of two building boxes, in metres. */
function gapM(a: Building, b: Building): number {
  const [as, aw, an, ae] = boundsOf(a);
  const [bs, bw, bn, be] = boundsOf(b);
  const lat = (as + an + bs + bn) / 4;
  const dLat = Math.max(0, as - bn, bs - an);
  const dLng = Math.max(0, aw - be, bw - ae);
  return Math.hypot(dLng * 111_320 * Math.cos((lat * Math.PI) / 180), dLat * 111_320);
}

export function allConnectors(buildings: Building[]) {
  return buildings.flatMap((b) =>
    (b.floors ?? []).flatMap((f) => f.connectors.map((c) => ({ building: b, floor: f, connector: c }))),
  );
}

/** The passage joining two buildings, if one has been drawn at either end. */
export function passageBetween(a: Building, b: Building): { from: Connector; to: Connector } | null {
  const all = allConnectors([a, b]);
  for (const x of all) {
    if (x.connector.kind !== 'passage' || !x.connector.linkTo) continue;
    const far = all.find((y) => y.connector.id === x.connector.linkTo && y.building.id !== x.building.id);
    if (far) return { from: x.connector, to: far.connector };
  }
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find the building a location string refers to. The code or name must start a
 * word, so "MB" matches "MB 2.14" and "mb-2.14" but not "LAMB LAB". Longer
 * names win over shorter codes so "Maths Building" is not read as "Maths".
 */
export function resolveBuilding(
  location: string,
  buildings: Building[],
): { building: Building; room: string } | null {
  const text = location.trim();
  if (!text) return null;
  // "RC426": building code, floor, room — no separator to split on.
  const compact = parseRoomCode(text, buildings);
  if (compact) return { building: compact.building, room: `${compact.ref.floor}${compact.ref.room}` };
  const candidates = buildings
    .flatMap((b) => [b.name, b.code].filter(Boolean).map((key) => ({ b, key: key.trim() })))
    .filter((c) => c.key)
    .sort((x, y) => y.key.length - x.key.length);
  for (const { b, key } of candidates) {
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(key)}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
    if (m) {
      const room = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
        .replace(/^[\s,\-–:./]+|[\s,\-–:./]+$/g, '')
        .replace(/\s+/g, ' ');
      return { building: b, room };
    }
  }
  return null;
}

export interface RoomRef {
  /** Floor level, 0 for ground. */
  floor: number;
  /** The room part: "26" for RC426. */
  room: string;
}

/**
 * Split a compact room code. After the building code comes the floor digit,
 * then the room: RC426 is floor 4, room 26. Needs a building whose code is
 * exactly that prefix, so "ABC123" is not read as a room unless "AB" exists.
 */
export function parseRoomCode(
  text: string,
  buildings: Building[],
): { building: Building; ref: RoomRef } | null {
  const m = /^\s*(\p{L}{2})(\d)([\p{L}\p{N}]+)\s*$/u.exec(text);
  if (!m) return null;
  const building = buildings.find((b) => b.code.trim().toLowerCase() === m[1].toLowerCase());
  return building ? { building, ref: { floor: Number(m[2]), room: m[3] } } : null;
}

export function roomCodeOf(b: Building, floor: Floor, room: Room): string {
  return `${b.code.toUpperCase()}${floor.level}${room.code}`;
}

/** Find the plan room a location refers to, if the building has one drawn. */
export function findRoom(
  location: string,
  buildings: Building[],
): { building: Building; floor: Floor; room: Room } | null {
  const hit = parseRoomCode(location, buildings);
  if (!hit) return null;
  const floor = hit.building.floors?.find((f) => f.level === hit.ref.floor);
  const room = floor?.rooms.find((r) => r.code.toLowerCase() === hit.ref.room.toLowerCase());
  return floor && room ? { building: hit.building, floor, room } : null;
}

export interface Transition {
  from: Occurrence;
  to: Occurrence;
  fromBuilding: Building;
  toBuilding: Building;
  walk: number;
  /** Set when a passage joins the two, so the walk is indoors. */
  passage: boolean;
  /** Minutes between one ending and the next starting. */
  gap: number;
  /** Positive when you will be late. */
  shortBy: number;
}

/** Consecutive located, timed things on a day, with the walk between them. */
export function transitionsOn(state: AppState, day: Date): Transition[] {
  const located = occurrencesOn(state, day)
    .filter((o) => !o.allDay && o.kind !== 'deadline' && o.location)
    .map((o) => ({ o, hit: resolveBuilding(o.location, state.buildings) }))
    .filter((x): x is { o: Occurrence; hit: NonNullable<typeof x.hit> } => x.hit !== null);

  const out: Transition[] = [];
  for (let i = 1; i < located.length; i++) {
    const a = located[i - 1];
    const b = located[i];
    if (a.hit.building.id === b.hit.building.id) continue;
    const walk = walkMinutes(a.hit.building, b.hit.building);
    const gap = Math.round((b.o.start.getTime() - a.o.end.getTime()) / 60_000);
    out.push({
      from: a.o,
      to: b.o,
      fromBuilding: a.hit.building,
      toBuilding: b.hit.building,
      walk,
      passage: !!passageBetween(a.hit.building, b.hit.building),
      gap,
      shortBy: walk - gap,
    });
  }
  return out;
}

/** Deep link that opens turn-by-turn walking directions on any platform. */
export function directionsUrl(b: Building): string {
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${b.lat}%2C${b.lng}`;
}
