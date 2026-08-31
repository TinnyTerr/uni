import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getISODay,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { IsoDay, Term } from './types';

/** Everything in the app treats Monday as the first day of the week. */
export const WEEK_OPTS = { weekStartsOn: 1 as const };

export const DAY_NAMES: Record<IsoDay, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const isoDayOf = (d: Date): IsoDay => getISODay(d) as IsoDay;

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
export const hm = (d: Date) => format(d, 'HH:mm');
export const iso = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

/** Parse an ISO date or datetime that was written by this app. */
export const parse = (s: string) => parseISO(s);

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function atTime(day: Date, hhmm: string): Date {
  const d = startOfDay(day);
  d.setMinutes(minutesOf(hhmm));
  return d;
}

export function monthGrid(cursor: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), WEEK_OPTS),
    end: endOfWeek(endOfMonth(cursor), WEEK_OPTS),
  });
}

export function weekGrid(cursor: Date): Date[] {
  const start = startOfWeek(cursor, WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 1-based teaching week number within a term, or null if outside it. */
export function termWeek(term: Term, day: Date): number | null {
  const start = startOfWeek(parseISO(term.start), WEEK_OPTS);
  const end = parseISO(term.end);
  if (startOfDay(day) < startOfDay(parseISO(term.start))) return null;
  if (startOfDay(day) > startOfDay(end)) return null;
  return Math.floor(differenceInCalendarDays(day, start) / 7) + 1;
}

export function termContaining(terms: Term[], day: Date): Term | undefined {
  return terms.find((t) => termWeek(t, day) !== null);
}

/** "in 3 days", "tomorrow", "2 days ago" — deadline-flavoured, not exact. */
export function relativeDay(target: Date, now = new Date()): string {
  const days = differenceInCalendarDays(startOfDay(target), startOfDay(now));
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export { addDays, isSameDay, startOfDay, format, differenceInCalendarDays };
