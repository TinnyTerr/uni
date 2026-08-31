/**
 * Talking to the server that holds the authoritative copy.
 *
 * The model is deliberately small. The server stores one opaque document and a
 * revision number; a client may only write if it names the revision it started
 * from. That single rule turns "we both edited" — which is otherwise invisible
 * and ends in silent data loss — into a 409 the client can act on.
 *
 * Merging is not attempted. A schedule is a set of hand-edited records with no
 * sensible field-level merge, so the honest options are "keep theirs" or "keep
 * mine", and the user is asked which (see `conflictPolicy`).
 */
import type { AppState, ConflictPolicy, ServerConfig } from './types';
import { deviceId } from './platform';

/** What the server hands back for the whole document. */
export interface Envelope {
  rev: number;
  updatedAt: string | null;
  device: string | null;
  doc: SyncDoc | null;
}

/** The part of the state that travels. See `LOCAL_ONLY_SETTINGS`. */
export type SyncDoc = Omit<AppState, 'settings'> & {
  settings: Omit<AppState['settings'], (typeof LOCAL_ONLY_SETTINGS)[number]>;
};

/**
 * Settings that describe *this device* rather than the schedule. Syncing them
 * would push desktop note paths onto the phone and, worse, let the phone
 * overwrite the desktop's server address with its own.
 */
export const LOCAL_ONLY_SETTINGS = ['server', 'notesRoots', 'deviceName'] as const;

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/* ---- shaping ---------------------------------------------------------- */

/** Strip the device-local settings before sending. */
export function toDoc(state: AppState): SyncDoc {
  const settings = { ...state.settings } as Record<string, unknown>;
  for (const key of LOCAL_ONLY_SETTINGS) delete settings[key];
  return { ...state, settings } as SyncDoc;
}

/** Adopt a server document, keeping this device's own settings untouched. */
export function fromDoc(doc: SyncDoc, local: AppState): AppState {
  const kept: Record<string, unknown> = {};
  for (const key of LOCAL_ONLY_SETTINGS) kept[key] = local.settings[key];
  return {
    ...local,
    ...doc,
    settings: { ...local.settings, ...doc.settings, ...kept },
  } as AppState;
}

/**
 * Key order varies between a structuredClone and a JSON round-trip, so a plain
 * stringify would report changes that are not there. Sorting keys makes the
 * hash depend on content alone.
 */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

/** FNV-1a. Only ever compared with itself, so speed beats collision strength. */
export function hashDoc(doc: SyncDoc): string {
  const text = stable(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A freshly seeded document has a year and terms but nothing of yours in it. */
export function looksUnused(doc: SyncDoc): boolean {
  return (
    doc.modules.length === 0 &&
    doc.sessions.length === 0 &&
    doc.assessments.length === 0 &&
    doc.events.length === 0
  );
}

/** Enough of a summary to choose between two copies without diffing them. */
export interface DocSummary {
  modules: number;
  sessions: number;
  assessments: number;
  events: number;
  marked: number;
}

export function summarise(doc: SyncDoc): DocSummary {
  return {
    modules: doc.modules.length,
    sessions: doc.sessions.length,
    assessments: doc.assessments.length,
    events: doc.events.length,
    marked: doc.assessments.filter((a) => a.mark !== null).length,
  };
}

/* ---- what this device remembers about the server ---------------------- */

/**
 * The revision this device last agreed with the server on, and the hash of the
 * document at that moment. Together they answer the only two questions that
 * matter: has the server moved on, and have we edited since.
 *
 * Kept outside the document — it is per-device, and syncing it would be circular.
 */
export interface Bookmark {
  rev: number;
  hash: string;
  at: string;
}

const bookKey = (url: string) => `uni-schedule.sync.${normaliseUrl(url)}`;

export function readBookmark(url: string): Bookmark | null {
  try {
    const raw = localStorage.getItem(bookKey(url));
    return raw ? (JSON.parse(raw) as Bookmark) : null;
  } catch {
    return null;
  }
}

export function writeBookmark(url: string, mark: Bookmark) {
  try {
    localStorage.setItem(bookKey(url), JSON.stringify(mark));
  } catch {
    /* a lost bookmark costs a conflict prompt, not data */
  }
}

export function clearBookmark(url: string) {
  try {
    localStorage.removeItem(bookKey(url));
  } catch {
    /* nothing to do */
  }
}

/** Trailing slashes and case in the host should not make a different server. */
export function normaliseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/* ---- http ------------------------------------------------------------- */

const TIMEOUT_MS = 10_000;

async function call<T>(cfg: ServerConfig, path: string, init: RequestInit = {}): Promise<T> {
  const base = normaliseUrl(cfg.url);
  if (!base) throw new SyncError('no server address set');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      signal: abort.signal,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    throw new SyncError(
      abort.signal.aborted ? `no answer from ${base} within 10s` : `cannot reach ${base}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new SyncError(`${base} answered with something that is not JSON`, res.status);
  }

  if (res.status === 401) throw new SyncError('the server rejected the access token', 401);
  if (!res.ok && res.status !== 409) {
    const detail = (body as { error?: string } | null)?.error ?? res.statusText;
    throw new SyncError(`server said: ${detail}`, res.status);
  }
  return body as T;
}

export interface Health {
  ok: boolean;
  name: string;
  needsToken: boolean;
  authorised: boolean;
  rev?: number;
  updatedAt?: string | null;
  device?: string | null;
}

export function health(cfg: ServerConfig): Promise<Health> {
  return call<Health>(cfg, '/api/health');
}

export function fetchState(cfg: ServerConfig): Promise<Envelope> {
  return call<Envelope>(cfg, '/api/state');
}

export type PushResult =
  | { ok: true; rev: number; updatedAt: string; device: string | null }
  | { ok: false; conflict: true; server: Envelope };

/**
 * `baseRev` is a promise about what was read, not a preference. Passing the
 * server's current revision is how "keep mine" is expressed after a conflict.
 */
export async function pushState(
  cfg: ServerConfig,
  doc: SyncDoc,
  baseRev: number,
  device: string,
): Promise<PushResult> {
  const body = await call<Record<string, unknown>>(cfg, '/api/state', {
    method: 'PUT',
    body: JSON.stringify({ baseRev, doc, device, updatedAt: new Date().toISOString() }),
  });
  if (body && body.conflict === true) {
    return { ok: false, conflict: true, server: body.server as Envelope };
  }
  return {
    ok: true,
    rev: body.rev as number,
    updatedAt: body.updatedAt as string,
    device: (body.device as string | null) ?? null,
  };
}

/**
 * Live notification of writes by other devices. Falls back to nothing at all
 * if EventSource is unavailable — the caller also polls.
 */
export function subscribe(cfg: ServerConfig, onWrite: (rev: number) => void): () => void {
  const base = normaliseUrl(cfg.url);
  if (!base || typeof EventSource === 'undefined') return () => {};

  // EventSource cannot send headers, hence the token in the query string.
  const url = `${base}/api/events${cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : ''}`;
  let source: EventSource | null = null;
  try {
    source = new EventSource(url);
  } catch {
    return () => {};
  }
  source.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as { type?: string; rev?: number };
      if (msg.type === 'state' && typeof msg.rev === 'number') onWrite(msg.rev);
    } catch {
      /* a malformed frame is not worth tearing the stream down for */
    }
  };
  // EventSource reconnects on its own; swallow the error so it stays quiet.
  source.onerror = () => {};
  return () => source?.close();
}

/* ---- conflicts -------------------------------------------------------- */

export interface Conflict {
  /** What is on the server right now. */
  server: Envelope;
  /** What this device holds. */
  local: SyncDoc;
  /** When this device last changed anything. */
  localAt: string | null;
  /** Which side "latest wins" would pick. */
  newer: 'local' | 'server';
}

export function whichIsNewer(serverAt: string | null, localAt: string | null): 'local' | 'server' {
  const s = serverAt ? Date.parse(serverAt) : 0;
  const l = localAt ? Date.parse(localAt) : 0;
  // A tie goes to the server: it is the copy every other device already agrees on.
  return l > s ? 'local' : 'server';
}

/** How a conflict was settled, given the configured policy. */
export function resolutionFor(policy: ConflictPolicy, conflict: Conflict): 'local' | 'server' | 'ask' {
  switch (policy) {
    case 'latest':
      return conflict.newer;
    case 'local':
      return 'local';
    case 'server':
      return 'server';
    case 'prompt':
    default:
      return 'ask';
  }
}

export const thisDevice = deviceId;
