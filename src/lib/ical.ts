/**
 * iCalendar (RFC 5545), both ways.
 *
 * Export writes the timetable, deadlines and events as floating local times, so
 * whatever calendar reads it shows them at the same wall-clock hour you see
 * here. Import reads the common subset universities and Google emit: single
 * events, simple recurrence (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT,
 * UNTIL, BYDAY, EXDATE) and TZID/UTC times. It is not a full RRULE engine.
 *
 * Nothing here touches the DOM, so the sync server imports it for the
 * subscribable feed.
 */
import { addDays, addMonths, addWeeks, addYears, format, startOfDay } from 'date-fns';
import type { AppState, CalEvent } from './types';
import { occurrencesOn } from './occurrences';
import { parse } from './dates';

/* ---- writing ----------------------------------------------------------- */

const stamp = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
const dateOnly = (d: Date) => format(d, 'yyyyMMdd');
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines over 75 octets are folded with CRLF + space; count bytes, not chars. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // continuation lines spend one octet on the leading space
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export interface ExportOptions {
  /** Defaults to the earliest term start and the latest term end. */
  from?: Date;
  to?: Date;
  now?: Date;
}

export function buildIcs(state: AppState, opts: ExportOptions = {}): string {
  const now = opts.now ?? new Date();
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Uni Schedule//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Uni Schedule'];
  const dtstamp = utcStamp(now);

  const push = (o: {
    uid: string;
    title: string;
    start: Date;
    end: Date;
    allDay?: boolean;
    location?: string;
    description?: string;
    category?: string;
  }) => {
    lines.push('BEGIN:VEVENT', `UID:${o.uid}@uni-schedule`, `DTSTAMP:${dtstamp}`);
    if (o.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(o.start)}`);
      // DTEND is exclusive for dates.
      const last = o.end < o.start ? o.start : o.end;
      lines.push(`DTEND;VALUE=DATE:${dateOnly(addDays(last, 1))}`);
    } else {
      lines.push(`DTSTART:${stamp(o.start)}`, `DTEND:${stamp(o.end < o.start ? o.start : o.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(o.title)}`);
    if (o.location) lines.push(`LOCATION:${escapeText(o.location)}`);
    if (o.description) lines.push(`DESCRIPTION:${escapeText(o.description)}`);
    if (o.category) lines.push(`CATEGORIES:${escapeText(o.category)}`);
    lines.push('END:VEVENT');
  };

  // Sessions repeat, so they are expanded day by day across the terms.
  if (state.terms.length) {
    const from = opts.from ?? parse(state.terms.map((t) => t.start).sort()[0]);
    const to = opts.to ?? parse(state.terms.map((t) => t.end).sort().reverse()[0]);
    for (let day = startOfDay(from); day <= to; day = addDays(day, 1)) {
      for (const o of occurrencesOn(state, day)) {
        if (o.kind !== 'session') continue;
        push({
          uid: o.key.replace(/[^A-Za-z0-9:_-]/g, ''),
          title: o.subtitle ? `${o.title} — ${o.subtitle}` : o.title,
          start: o.start,
          end: o.end,
          location: o.location,
          category: 'Timetable',
        });
      }
    }
  }

  for (const a of state.assessments) {
    const mod = state.modules.find((m) => m.id === a.moduleId);
    const due = parse(a.due);
    push({
      uid: `a-${a.id}`,
      title: `Due: ${a.title}${mod ? ` (${mod.code})` : ''}`,
      start: due,
      end: due,
      description: [`${a.kind}, ${a.weight}%`, a.description].filter(Boolean).join('\n'),
      category: 'Deadline',
    });
  }

  for (const e of state.events) {
    // Events carrying an imported UID keep it, so a round trip does not fork.
    push({
      uid: e.uid ? `imp-${e.uid.replace(/[^A-Za-z0-9:_@.-]/g, '')}` : `e-${e.id}`,
      title: e.title,
      start: parse(e.start),
      end: parse(e.end || e.start),
      allDay: e.allDay,
      location: e.location,
      description: e.description,
      category: 'Event',
    });
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* ---- reading ----------------------------------------------------------- */

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out.filter((l) => l.length > 0);
}

function parseProp(line: string): Prop | null {
  // The first colon outside a quoted parameter value splits name from value.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rest] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

const unescapeText = (s: string) =>
  s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffset(tz: string, at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

interface Stamp {
  date: Date;
  allDay: boolean;
}

function parseStamp(p: Prop): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  if (m[4] === undefined) return { date: new Date(y, mo, d), allDay: true };
  const [h, mi, s] = [+m[4], +m[5], +(m[6] ?? 0)];
  if (m[7]) return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  const tz = p.params.TZID;
  if (tz) {
    try {
      const guess = Date.UTC(y, mo, d, h, mi, s);
      // Two passes settle the offset across a DST boundary.
      const first = guess - tzOffset(tz, new Date(guess));
      return { date: new Date(guess - tzOffset(tz, new Date(first))), allDay: false };
    } catch {
      /* unknown zone: fall through to floating */
    }
  }
  return { date: new Date(y, mo, d, h, mi, s), allDay: false };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms =
    ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

interface RRule {
  freq: string;
  interval: number;
  count: number | null;
  until: Date | null;
  byday: number[]; // JS getDay(): 0 = Sunday
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseRRule(v: string, tz?: string): RRule | null {
  const kv: Record<string, string> = {};
  for (const part of v.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (!kv.FREQ) return null;
  const until = kv.UNTIL ? parseStamp({ name: 'UNTIL', params: tz ? { TZID: tz } : {}, value: kv.UNTIL }) : null;
  return {
    freq: kv.FREQ.toUpperCase(),
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    count: kv.COUNT ? Number(kv.COUNT) : null,
    until: until ? (until.allDay ? addDays(until.date, 1) : until.date) : null,
    byday: (kv.BYDAY ?? '')
      .split(',')
      .map((d) => DAY_CODES.indexOf(d.slice(-2).toUpperCase()))
      .filter((i) => i >= 0),
  };
}

const MAX_INSTANCES = 600;

function expand(start: Date, rule: RRule, exdates: Set<number>, horizon: Date): Date[] {
  const out: Date[] = [];
  const stepOk = (d: Date) => rule.until === null || d <= rule.until;
  let emitted = 0; // COUNT includes excluded dates

  const take = (d: Date): boolean => {
    if (d < start) return true;
    if (!stepOk(d) || d > horizon) return false;
    if (rule.count !== null && emitted >= rule.count) return false;
    emitted++;
    if (!exdates.has(d.getTime())) out.push(d);
    return out.length < MAX_INSTANCES;
  };

  if (rule.freq === 'WEEKLY' && rule.byday.length) {
    // Walk each week from the one holding DTSTART, emitting the chosen days.
    const weekStart = addDays(start, -((start.getDay() + 6) % 7)); // Monday
    const offsets = rule.byday.map((d) => (d + 6) % 7).sort((a, b) => a - b);
    for (let w = 0; ; w += rule.interval) {
      for (const off of offsets) {
        const d = addDays(addWeeks(weekStart, w), off);
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds());
        if (!take(d)) return out;
      }
    }
  }

  const next = (n: number): Date => {
    switch (rule.freq) {
      case 'DAILY':
        return addDays(start, n * rule.interval);
      case 'WEEKLY':
        return addWeeks(start, n * rule.interval);
      case 'MONTHLY':
        return addMonths(start, n * rule.interval);
      default:
        return addYears(start, n * rule.interval);
    }
  };
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) return [start];
  for (let n = 0; ; n++) if (!take(next(n))) return out;
}

export interface ParsedEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  description: string;
}

export interface ParseOptions {
  /** How far past the first occurrence an open-ended rule is expanded. */
  horizonDays?: number;
  now?: Date;
}

export function parseIcs(text: string, opts: ParseOptions = {}): ParsedEvent[] {
  const lines = unfold(text);
  const events: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const line of lines) {
    const u = line.toUpperCase();
    if (u === 'BEGIN:VEVENT') cur = [];
    else if (u === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const p = parseProp(line);
      if (p) cur.push(p);
    }
  }

  const out: ParsedEvent[] = [];
  for (const props of events) {
    const get = (n: string) => props.find((p) => p.name === n);
    const startP = get('DTSTART');
    if (!startP) continue;
    const start = parseStamp(startP);
    if (!start) continue;
    if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') continue;

    let end = start.date;
    const endP = get('DTEND');
    const durP = get('DURATION');
    if (endP) {
      const e = parseStamp(endP);
      if (e) end = e.allDay ? addDays(e.date, -1) : e.date; // all-day DTEND is exclusive
    } else if (durP) {
      const ms = parseDuration(durP.value);
      if (ms !== null) end = new Date(start.date.getTime() + ms);
    } else if (start.allDay) {
      end = start.date;
    }
    if (end < start.date) end = start.date;
    const lengthMs = end.getTime() - start.date.getTime();

    const uid = get('UID')?.value.trim() || `${startP.value}-${get('SUMMARY')?.value ?? ''}`;
    const base = {
      title: unescapeText(get('SUMMARY')?.value ?? '(untitled)'),
      allDay: start.allDay,
      location: unescapeText(get('LOCATION')?.value ?? ''),
      description: unescapeText(get('DESCRIPTION')?.value ?? ''),
    };

    const rrP = get('RRULE');
    const rule = rrP && !get('RECURRENCE-ID') ? parseRRule(rrP.value, startP.params.TZID) : null;
    if (!rule) {
      // An override of one instance of a series keeps the series UID plus its
      // original slot, so it lands on top of the generated one, not beside it.
      const rid = get('RECURRENCE-ID');
      const ridStamp = rid ? parseStamp(rid) : null;
      out.push({
        ...base,
        uid: ridStamp ? `${uid}#${stamp(ridStamp.date)}` : uid,
        start: start.date,
        end,
      });
      continue;
    }

    const ex = new Set<number>();
    for (const p of props.filter((x) => x.name === 'EXDATE')) {
      for (const v of p.value.split(',')) {
        const s = parseStamp({ ...p, value: v });
        if (s) ex.add(s.date.getTime());
      }
    }
    const horizon = addDays(opts.now ?? new Date(), opts.horizonDays ?? 400);
    const farEnough = addDays(start.date, opts.horizonDays ?? 400);
    for (const d of expand(start.date, rule, ex, horizon > farEnough ? horizon : farEnough)) {
      out.push({
        ...base,
        uid: `${uid}#${stamp(d)}`,
        start: d,
        end: new Date(d.getTime() + lengthMs),
      });
    }
  }
  return out;
}

/* ---- merging into the app --------------------------------------------- */

export interface MergeResult {
  events: CalEvent[];
  added: number;
  updated: number;
}

/**
 * Fold parsed events into the existing list. Matching on UID is what makes a
 * second import of the same feed update rather than duplicate; a match keeps
 * the local id and colour so edits to those survive.
 */
export function mergeImported(
  existing: CalEvent[],
  parsed: ParsedEvent[],
  newId: () => string,
  colour: string,
): MergeResult {
  const events = existing.map((e) => ({ ...e }));
  const byUid = new Map(events.filter((e) => e.uid).map((e) => [e.uid!, e]));
  let added = 0;
  let updated = 0;
  const iso = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
  for (const p of parsed) {
    const fields = {
      title: p.title,
      start: iso(p.start),
      end: iso(p.end),
      allDay: p.allDay,
      location: p.location,
      description: p.description,
    };
    const hit = byUid.get(p.uid);
    if (hit) {
      Object.assign(hit, fields);
      updated++;
    } else {
      const e: CalEvent = { id: newId(), colour, uid: p.uid, ...fields };
      events.push(e);
      byUid.set(p.uid, e);
      added++;
    }
  }
  return { events, added, updated };
}
