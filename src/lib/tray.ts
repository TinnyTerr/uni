/**
 * Feeds the macOS menu bar item. Only the Tauri build has one; elsewhere (and
 * on Linux/Windows, where Rust ignores it) this does nothing visible.
 */
import type { AppState } from './types';
import { addDays, hm, startOfDay } from './dates';
import { occurrencesOn } from './occurrences';

export interface TrayPayload {
  title: string;
  lines: string[];
}

export function trayPayload(state: AppState, now = new Date()): TrayPayload {
  const today = startOfDay(now);
  const items = occurrencesOn(state, today).filter((o) => o.kind !== 'deadline' || !o.done);
  const timed = items.filter((o) => !o.allDay);

  const label = (o: (typeof items)[number]) =>
    o.allDay
      ? `All day  ${o.title}`
      : o.kind === 'deadline'
        ? `${hm(o.start)}  ${o.title} (due)`
        : `${hm(o.start)}–${hm(o.end)}  ${o.title}${o.location ? ` · ${o.location}` : ''}`;

  const current = timed.find((o) => o.kind !== 'deadline' && o.start <= now && now < o.end);
  const next = timed.find((o) => o.kind !== 'deadline' && o.start > now);

  let title: string;
  if (current) title = `${current.title} until ${hm(current.end)}`;
  else if (next) title = `${next.title} ${hm(next.start)}`;
  else {
    const tomorrow = occurrencesOn(state, addDays(today, 1)).find((o) => o.kind === 'session');
    title = tomorrow ? `Tomorrow ${hm(tomorrow.start)}` : 'Nothing today';
  }

  return { title, lines: items.length ? items.map(label) : ['Nothing scheduled today'] };
}

let last = '';

export async function pushTray(state: AppState) {
  const payload = trayPayload(state);
  const key = JSON.stringify(payload);
  if (key === last) return;
  last = key;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_tray', { state: payload });
}
