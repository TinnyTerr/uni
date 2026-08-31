import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addDays, format } from 'date-fns';
import { emptyState, STATE_VERSION, type AppState, type Year, type Term } from './types';
import { registerProvider } from './notes/provider';
import { LocalGitNotesProvider } from './notes/localGit';
import { persistence } from './persist';
import { guessDeviceName, isTauri } from './platform';
import {
  fetchState,
  fromDoc,
  hashDoc,
  looksUnused,
  normaliseUrl,
  pushState,
  readBookmark,
  resolutionFor,
  subscribe,
  toDoc,
  whichIsNewer,
  writeBookmark,
  type Conflict,
  type Envelope,
  type SyncDoc,
} from './sync';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** A first run gets a year and three terms so the calendar has a frame. */
function seed(): AppState {
  const s = emptyState();
  const now = new Date();
  // UK academic year starts in the autumn; before September we are still in
  // the year that began last autumn.
  const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const year: Year = {
    id: uid(),
    name: `${startYear}/${String(startYear + 1).slice(2)}`,
    degreeWeight: 100,
  };
  const term = (name: string, start: string, end: string): Term => ({
    id: uid(),
    yearId: year.id,
    name,
    start,
    end,
  });
  s.years = [year];
  s.terms = [
    term('Autumn', `${startYear}-09-22`, `${startYear}-12-12`),
    term('Spring', `${startYear + 1}-01-12`, `${startYear + 1}-03-27`),
    term('Summer', `${startYear + 1}-04-20`, `${startYear + 1}-06-12`),
  ];
  s.settings.activeYearId = year.id;
  s.settings.deviceName = guessDeviceName();
  return s;
}

/** Fill in fields added by later versions rather than rejecting old saves. */
function migrate(raw: unknown): AppState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return seed();
  const s = raw as Partial<AppState>;
  return {
    ...base,
    ...s,
    version: STATE_VERSION,
    years: s.years ?? [],
    terms: s.terms ?? [],
    modules: s.modules ?? [],
    sessions: s.sessions ?? [],
    assessments: s.assessments ?? [],
    events: s.events ?? [],
    settings: {
      ...base.settings,
      ...(s.settings ?? {}),
      // v2 added the server block; an older save has no key at all, and a
      // partially written one must not lose a field.
      server: { ...base.settings.server, ...(s.settings?.server ?? {}) },
      deviceName: s.settings?.deviceName || guessDeviceName(),
    },
  };
}

/** When this device last changed the document — the "latest" in latest-wins. */
const EDITED_AT_KEY = 'uni-schedule.edited-at';

function readEditedAt(): string | null {
  try {
    return localStorage.getItem(EDITED_AT_KEY);
  } catch {
    return null;
  }
}

function writeEditedAt(at: string) {
  try {
    localStorage.setItem(EDITED_AT_KEY, at);
  } catch {
    /* the fallback is a conflict prompt, not data loss */
  }
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'conflict';

export interface SyncView {
  status: SyncStatus;
  /** Revision this device last agreed with the server on. */
  rev: number | null;
  lastSyncAt: string | null;
  error: string | null;
  /** Local edits not yet accepted by the server. */
  pending: boolean;
  conflict: Conflict | null;
}

interface Store {
  state: AppState;
  ready: boolean;
  error: string | null;
  saving: boolean;
  dataPath: string;
  /** Mutate a structural clone; the result is persisted automatically. */
  update: (fn: (draft: AppState) => void) => void;
  backup: () => Promise<string>;
  sync: SyncView;
  /** Reconcile with the server now; resolves once the round trip is done. */
  syncNow: () => Promise<void>;
  /** Settle an open conflict. `remember` writes the choice back as the policy. */
  resolveConflict: (choice: 'local' | 'server', remember?: boolean) => Promise<void>;
  /** Leave the conflict unresolved; nothing syncs until it is settled. */
  dismissConflict: () => void;
}

const Ctx = createContext<Store | null>(null);

const IDLE_SYNC: SyncView = {
  status: 'off',
  rev: null,
  lastSyncAt: null,
  error: null,
  pending: false,
  conflict: null,
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dataPath, setDataPath] = useState('');
  const [sync, setSync] = useState<SyncView>(IDLE_SYNC);

  const timer = useRef<number | null>(null);
  const dirty = useRef(false);

  // The reconcile loop reads the newest state without being re-created on
  // every keystroke, which would restart its timers.
  const stateRef = useRef(state);
  stateRef.current = state;
  const editedAt = useRef<string | null>(readEditedAt());
  const busy = useRef(false);
  const again = useRef(false);
  const conflictOpen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loaded, path] = await Promise.all([persistence.load(), persistence.location()]);
        if (cancelled) return;
        setDataPath(path);
        if (loaded === null) {
          // Persist the seed straight away, so the ids it hands out are stable
          // across restarts rather than being regenerated on every launch.
          dirty.current = true;
          setState(seed());
        } else {
          setState(migrate(loaded));
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced write-behind: typing in a form should not hit the disk per keystroke.
  useEffect(() => {
    if (!ready || !dirty.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    setSaving(true);
    timer.current = window.setTimeout(() => {
      persistence
        .save(state)
        .then(() => setError(null))
        .catch((e) => setError(String(e)))
        .finally(() => setSaving(false));
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [state, ready]);

  const update = useCallback((fn: (draft: AppState) => void) => {
    dirty.current = true;
    const at = new Date().toISOString();
    editedAt.current = at;
    writeEditedAt(at);
    setState((prev) => {
      const draft = structuredClone(prev) as AppState;
      fn(draft);
      return draft;
    });
  }, []);

  const backup = useCallback(
    () => persistence.backup(format(new Date(), 'yyyy-MM-dd-HHmm')),
    [],
  );

  /* ---- sync ----------------------------------------------------------- */

  const cfg = state.settings.server;
  const serverUrl = normaliseUrl(cfg.url);
  const active = cfg.enabled && serverUrl !== '';
  // A primitive so the effects below re-run when the server changes, but not
  // when an unrelated setting does.
  const cfgKey = `${serverUrl}|${cfg.token}|${active}`;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const deviceLabel = state.settings.deviceName || guessDeviceName();
  const deviceRef = useRef(deviceLabel);
  deviceRef.current = deviceLabel;

  /** Take the server's copy wholesale, keeping this device's own settings. */
  const adopt = useCallback((env: Envelope) => {
    if (!env.doc) return;
    const merged = fromDoc(env.doc, stateRef.current);
    dirty.current = true; // it still has to reach this device's own storage
    setState(merged);
    stateRef.current = merged;
    // Bookmark the server's hash, not the merged one: the next reconcile then
    // sees "no local changes" and does not immediately push it back.
    writeBookmark(cfgRef.current.url, {
      rev: env.rev,
      hash: hashDoc(env.doc),
      at: new Date().toISOString(),
    });
    setSync((s) => ({
      ...s,
      status: 'idle',
      rev: env.rev,
      error: null,
      pending: false,
      conflict: null,
      lastSyncAt: new Date().toISOString(),
    }));
  }, []);

  /** Write this device's copy over revision `baseRev`. */
  const send = useCallback(async (doc: SyncDoc, baseRev: number): Promise<Envelope | null> => {
    const res = await pushState(cfgRef.current, doc, baseRev, deviceRef.current);
    if (!res.ok) return res.server; // someone wrote in between; caller decides
    writeBookmark(cfgRef.current.url, {
      rev: res.rev,
      hash: hashDoc(doc),
      at: res.updatedAt,
    });
    setSync((s) => ({
      ...s,
      status: 'idle',
      rev: res.rev,
      error: null,
      pending: false,
      conflict: null,
      lastSyncAt: res.updatedAt,
    }));
    return null;
  }, []);

  const raise = useCallback(
    async (server: Envelope, local: SyncDoc) => {
      const conflict: Conflict = {
        server,
        local,
        localAt: editedAt.current,
        newer: whichIsNewer(server.updatedAt, editedAt.current),
      };
      const choice = resolutionFor(cfgRef.current.conflictPolicy, conflict);
      if (choice === 'ask') {
        conflictOpen.current = true;
        setSync((s) => ({ ...s, status: 'conflict', conflict, pending: true }));
        return;
      }
      if (choice === 'server') {
        adopt(server);
        return;
      }
      const stillStale = await send(local, server.rev);
      // Losing the race twice means a third device is writing; ask this time.
      if (stillStale) {
        conflictOpen.current = true;
        setSync((s) => ({
          ...s,
          status: 'conflict',
          pending: true,
          conflict: { ...conflict, server: stillStale },
        }));
      }
    },
    [adopt, send],
  );

  /**
   * One pass of the whole protocol: read the server, work out which of the two
   * copies has moved, and either do nothing, push, adopt, or raise a conflict.
   */
  const reconcile = useCallback(async () => {
    if (!cfgRef.current.enabled || !normaliseUrl(cfgRef.current.url)) return;
    if (conflictOpen.current) return; // nothing may move until it is settled
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setSync((s) => ({ ...s, status: 'syncing', error: null }));

    try {
      const env = await fetchState(cfgRef.current);
      const local = toDoc(stateRef.current);
      const localHash = hashDoc(local);
      const mark = readBookmark(cfgRef.current.url);

      const changedHere = !mark || mark.hash !== localHash;
      const changedThere = !mark || mark.rev !== env.rev;

      if (!changedHere && !changedThere) {
        setSync((s) => ({
          ...s,
          status: 'idle',
          rev: env.rev,
          pending: false,
          lastSyncAt: new Date().toISOString(),
        }));
      } else if (changedHere && !changedThere) {
        const stale = await send(local, env.rev);
        if (stale) await raise(stale, local);
      } else if (!changedHere && changedThere) {
        adopt(env);
      } else if (!env.doc) {
        // Nothing has ever been pushed, so there is nothing to conflict with.
        const stale = await send(local, env.rev);
        if (stale) await raise(stale, local);
      } else if (!mark && looksUnused(local)) {
        // A device joining an established server: its seeded document is not a
        // competing edit, it is an empty one.
        adopt(env);
      } else if (looksUnused(env.doc) && !looksUnused(local)) {
        // The mirror image — a fresh server being filled for the first time.
        const stale = await send(local, env.rev);
        if (stale) await raise(stale, local);
      } else {
        await raise(env, local);
      }
    } catch (e) {
      setSync((s) => ({
        ...s,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void reconcile();
      }
    }
  }, [adopt, raise, send]);

  const resolveConflict = useCallback(
    async (choice: 'local' | 'server', remember = false) => {
      const open = sync.conflict;
      if (!open) return;
      conflictOpen.current = false;
      if (remember) {
        update((s) => {
          s.settings.server.conflictPolicy = choice;
        });
      }
      setSync((s) => ({ ...s, status: 'syncing', conflict: null }));
      try {
        if (choice === 'server') {
          adopt(open.server);
        } else {
          // Base the write on what the server holds now, which is exactly what
          // "keep mine" means: overwrite that revision.
          const stale = await send(toDoc(stateRef.current), open.server.rev);
          if (stale) await raise(stale, toDoc(stateRef.current));
        }
      } catch (e) {
        setSync((s) => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    [adopt, raise, send, sync.conflict, update],
  );

  const dismissConflict = useCallback(() => {
    // The conflict is still real; syncing stays paused so nothing is lost by
    // accident, and the sidebar keeps saying so.
    setSync((s) => ({ ...s, status: 'conflict' }));
  }, []);

  // Reconcile on connect, when the window comes back, on a write elsewhere,
  // and on a slow timer as a backstop for all three.
  useEffect(() => {
    if (!ready) return;
    if (!active) {
      conflictOpen.current = false;
      setSync(IDLE_SYNC);
      return;
    }
    void reconcile();

    const onWake = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    const poll = window.setInterval(() => void reconcile(), 60_000);
    const stop = subscribe(cfgRef.current, () => void reconcile());

    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.clearInterval(poll);
      stop();
    };
  }, [ready, active, cfgKey, reconcile]);

  // Local edits: mark them pending immediately so the UI is honest, then push
  // on a longer debounce than the disk write — the network is the slow part.
  useEffect(() => {
    if (!ready || !active || conflictOpen.current) return;
    const mark = readBookmark(cfgRef.current.url);
    const pending = !mark || mark.hash !== hashDoc(toDoc(state));
    setSync((s) => (s.pending === pending || s.status === 'conflict' ? s : { ...s, pending }));
    if (!pending) return;
    const t = window.setTimeout(() => void reconcile(), 1200);
    return () => window.clearTimeout(t);
  }, [state, ready, active, cfgKey, reconcile]);

  const value = useMemo<Store>(
    () => ({
      state,
      ready,
      error,
      saving,
      dataPath,
      update,
      backup,
      sync: active ? sync : IDLE_SYNC,
      syncNow: reconcile,
      resolveConflict,
      dismissConflict,
    }),
    [
      state,
      ready,
      error,
      saving,
      dataPath,
      update,
      backup,
      active,
      sync,
      reconcile,
      resolveConflict,
      dismissConflict,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/** Derived slices for the active academic year, which most views work within. */
export function useActiveYear() {
  const { state } = useStore();
  return useMemo(() => {
    const year =
      state.years.find((y) => y.id === state.settings.activeYearId) ?? state.years[0] ?? null;
    const terms = year ? state.terms.filter((t) => t.yearId === year.id) : [];
    const modules = year ? state.modules.filter((m) => m.yearId === year.id) : [];
    const moduleIds = new Set(modules.map((m) => m.id));
    return {
      year,
      terms,
      modules,
      sessions: state.sessions.filter((s) => moduleIds.has(s.moduleId)),
      assessments: state.assessments.filter((a) => moduleIds.has(a.moduleId)),
    };
  }, [state]);
}

export function useModuleLookup() {
  const { state } = useStore();
  return useMemo(() => new Map(state.modules.map((m) => [m.id, m])), [state.modules]);
}

/**
 * Provider registration lives here so there is exactly one place to add the
 * hosted-service provider later.
 */
export function useNotesProviders() {
  const { state } = useStore();
  const rootsRef = useRef(state.settings.notesRoots);
  rootsRef.current = state.settings.notesRoots;

  const local = useMemo(() => new LocalGitNotesProvider(() => rootsRef.current), []);
  useEffect(() => {
    registerProvider(local);
  }, [local]);

  return { local, providers: [local], notesAvailable: isTauri() };
}

export { addDays };
