/**
 * Buildings and getting between them. A location string like "MB 2.14" is
 * resolved against the building registry by its code or name; whatever is left
 * over is the room.
 */
import type { AppState, Building } from './types';
import { occurrencesOn, type Occurrence } from './occurrences';

/** Raster tiles for the map. Swap for a self-hosted or paid source if needed. */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';

/** Walking pace in metres per minute (about 4.8 km/h), padded for corners. */
const WALK_M_PER_MIN = 80;
const ROUTE_FACTOR = 1.3;

export function distanceM(a: Pick<Building, 'lat' | 'lng'>, b: Pick<Building, 'lat' | 'lng'>): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Whole minutes to walk between two buildings, never less than one. */
export function walkMinutes(a: Building, b: Building): number {
  if (a.id === b.id) return 0;
  return Math.max(1, Math.ceil((distanceM(a, b) * ROUTE_FACTOR) / WALK_M_PER_MIN));
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

export interface Transition {
  from: Occurrence;
  to: Occurrence;
  fromBuilding: Building;
  toBuilding: Building;
  walk: number;
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
