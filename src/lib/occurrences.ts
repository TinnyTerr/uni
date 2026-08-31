/**
 * Everything the calendar draws is derived here: recurring timetable sessions
 * expanded across term weeks, assessment deadlines, and one-off events.
 */
import type { AppState, Assessment, CalEvent, Session } from './types';
import { atTime, isoDayOf, parse, termWeek, ymd } from './dates';

export type OccKind = 'session' | 'deadline' | 'event';

export interface Occurrence {
  key: string;
  kind: OccKind;
  refId: string;
  title: string;
  subtitle: string;
  start: Date;
  end: Date;
  allDay: boolean;
  colour: string;
  location: string;
  moduleId: string | null;
  /** Set for deadlines so the calendar can strike through finished work. */
  done?: boolean;
}

const EVENT_FALLBACK = '#8a93a6';
const DEADLINE_COLOUR = '#e0736d';

function sessionOccurrences(state: AppState, day: Date): Occurrence[] {
  const iso = isoDayOf(day);
  const out: Occurrence[] = [];
  for (const s of state.sessions as Session[]) {
    if (s.day !== iso) continue;
    const term = state.terms.find((t) => t.id === s.termId);
    if (!term) continue;
    const week = termWeek(term, day);
    if (week === null) continue;
    if (s.weeks && !s.weeks.includes(week)) continue;
    const mod = state.modules.find((m) => m.id === s.moduleId);
    out.push({
      key: `s:${s.id}:${ymd(day)}`,
      kind: 'session',
      refId: s.id,
      title: mod ? `${mod.code} ${s.kind}` : s.kind,
      subtitle: mod?.title ?? '',
      start: atTime(day, s.start),
      end: atTime(day, s.end),
      allDay: false,
      colour: mod?.colour ?? EVENT_FALLBACK,
      location: s.location,
      moduleId: s.moduleId,
    });
  }
  return out;
}

function deadlineOccurrences(state: AppState, day: Date): Occurrence[] {
  const key = ymd(day);
  const out: Occurrence[] = [];
  for (const a of state.assessments as Assessment[]) {
    const due = parse(a.due);
    if (ymd(due) !== key) continue;
    const mod = state.modules.find((m) => m.id === a.moduleId);
    out.push({
      key: `a:${a.id}`,
      kind: 'deadline',
      refId: a.id,
      title: a.title,
      subtitle: mod ? `${mod.code} · ${a.weight}% · due` : 'due',
      start: due,
      end: due,
      allDay: false,
      colour: a.status === 'submitted' || a.status === 'marked' ? (mod?.colour ?? EVENT_FALLBACK) : DEADLINE_COLOUR,
      location: '',
      moduleId: a.moduleId,
      done: a.status === 'submitted' || a.status === 'marked',
    });
  }
  return out;
}

function eventOccurrences(state: AppState, day: Date): Occurrence[] {
  const key = ymd(day);
  const out: Occurrence[] = [];
  for (const e of state.events as CalEvent[]) {
    const start = parse(e.start);
    const end = parse(e.end || e.start);
    if (ymd(start) > key || ymd(end) < key) continue;
    out.push({
      key: `e:${e.id}:${key}`,
      kind: 'event',
      refId: e.id,
      title: e.title,
      subtitle: e.location,
      start,
      end,
      allDay: e.allDay,
      colour: e.colour || EVENT_FALLBACK,
      location: e.location,
      moduleId: null,
    });
  }
  return out;
}

export function occurrencesOn(state: AppState, day: Date): Occurrence[] {
  return [
    ...sessionOccurrences(state, day),
    ...deadlineOccurrences(state, day),
    ...eventOccurrences(state, day),
  ].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start.getTime() - b.start.getTime();
  });
}

export function occurrencesByDay(state: AppState, days: Date[]): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const day of days) map.set(ymd(day), occurrencesOn(state, day));
  return map;
}

/** Upcoming deadlines, nearest first, optionally limited to a horizon. */
export function upcomingDeadlines(state: AppState, horizonDays: number, now = new Date()) {
  const limit = new Date(now);
  limit.setDate(limit.getDate() + horizonDays);
  return state.assessments
    .filter((a) => a.status !== 'submitted' && a.status !== 'marked')
    .map((a) => ({ assessment: a, due: parse(a.due) }))
    .filter((x) => x.due <= limit)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}
