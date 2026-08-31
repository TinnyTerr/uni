import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { StoreProvider, useActiveYear, useNotesProviders, useStore } from './lib/store';
import { parse, termContaining, termWeek } from './lib/dates';
import { upcomingDeadlines } from './lib/occurrences';
import Dashboard from './views/Dashboard';
import CalendarView from './views/CalendarView';
import Timetable from './views/Timetable';
import Modules from './views/Modules';
import Assessments from './views/Assessments';
import Marks from './views/Marks';
import Notes from './views/Notes';
import Settings from './views/Settings';
import ConflictPrompt from './components/ConflictPrompt';

interface NavItem {
  id: string;
  label: string;
  icon: string;
  group: string;
  flush?: boolean;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Today', icon: '◉', group: 'Overview' },
  { id: 'calendar', label: 'Calendar', icon: '▦', group: 'Overview', flush: true },
  { id: 'timetable', label: 'Timetable', icon: '⌗', group: 'Overview' },
  { id: 'modules', label: 'Modules', icon: '❑', group: 'Study' },
  { id: 'assessments', label: 'Assessments', icon: '✎', group: 'Study' },
  { id: 'marks', label: 'Marks', icon: '％', group: 'Study' },
  { id: 'notes', label: 'Notes', icon: '🔗', group: 'Study' },
  { id: 'settings', label: 'Settings', icon: '⚙', group: 'App' },
];

/** One word for the sidebar: what the server and this device are up to. */
function SyncBadge() {
  const { sync, syncNow } = useStore();
  if (sync.status === 'off') return null;

  const [label, tone] =
    sync.status === 'conflict'
      ? ['conflict', 'var(--danger)']
      : sync.status === 'error'
        ? ['offline', 'var(--warn)']
        : sync.status === 'syncing'
          ? ['syncing…', 'var(--muted)']
          : sync.pending
            ? ['pending', 'var(--warn)']
            : ['synced', 'var(--ok)'];

  return (
    <button
      className="sync-badge"
      style={{ color: tone }}
      onClick={() => void syncNow()}
      title={sync.error ?? 'Sync with the server now'}
    >
      <span className="sync-dot" style={{ background: tone }} />
      {label}
    </button>
  );
}

function Shell() {
  const { state, ready, error, saving, sync } = useStore();
  const { year, terms } = useActiveYear();
  // Registers the notes providers once, for every view that resolves a link.
  useNotesProviders();

  const [view, setView] = useState(() => window.location.hash.slice(1) || 'dashboard');
  // On a phone the sidebar is a drawer; on the desktop it is always there.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    window.location.hash = view;
    setNavOpen(false);
  }, [view]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
    // Keeps the phone's status bar the same colour as the app chrome.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', state.settings.theme === 'light' ? '#f5f6f9' : '#0f1116');
  }, [state.settings.theme]);

  // Alt+1…8 jumps straight to a section.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) {
        setView(NAV[n - 1].id);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const now = new Date();
  const due = useMemo(() => upcomingDeadlines(state, state.settings.horizonDays, now), [state]);
  const overdue = useMemo(
    () =>
      state.assessments.filter(
        (a) => a.status !== 'submitted' && a.status !== 'marked' && parse(a.due) < now,
      ).length,
    [state],
  );

  const term = termContaining(terms, now);
  const week = term ? termWeek(term, now) : null;
  const active = NAV.find((n) => n.id === view) ?? NAV[0];

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }} className="muted">
        Loading…
      </div>
    );
  }

  return (
    <div className={navOpen ? 'app nav-open' : 'app'}>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">U</div>
          <div>
            <div className="brand-name">Uni Schedule</div>
            <div className="brand-sub">{year?.name ?? 'no year set'}</div>
          </div>
        </div>

        {['Overview', 'Study', 'App'].map((group) => (
          <div key={group}>
            <div className="nav-group">{group}</div>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button
                key={n.id}
                className={view === n.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setView(n.id)}
              >
                <span className="ico">{n.icon}</span>
                <span>{n.label}</span>
                {n.id === 'assessments' && (overdue > 0 || due.length > 0) && (
                  <span className={overdue > 0 ? 'count urgent' : 'count'}>
                    {overdue > 0 ? overdue : due.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-foot">
          {term && week !== null ? `${term.name} · week ${week}` : 'Outside term dates'}
          <div className="sidebar-foot-row">
            <span>{saving ? 'saving…' : 'saved'}</span>
            <SyncBadge />
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="nav-toggle"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={navOpen}
          >
            ☰
          </button>
          <h1>{active.label}</h1>
          <span className="topbar-sub">{format(now, 'EEEE d MMMM yyyy')}</span>
          <div className="spacer" />
          {overdue > 0 && (
            <span className="pill solid" style={{ background: 'var(--danger)' }}>
              {overdue} overdue
            </span>
          )}
        </header>

        <div className={active.flush ? 'content flush' : 'content'}>
          {view === 'dashboard' && <Dashboard go={setView} />}
          {view === 'calendar' && <CalendarView />}
          {view === 'timetable' && <Timetable />}
          {view === 'modules' && <Modules />}
          {view === 'assessments' && <Assessments />}
          {view === 'marks' && <Marks />}
          {view === 'notes' && <Notes go={setView} />}
          {view === 'settings' && <Settings />}
        </div>
      </main>

      {sync.conflict && <ConflictPrompt conflict={sync.conflict} />}

      {error && (
        <div className="toast">
          <b>Storage problem</b>
          <div className="tiny muted">{error}</div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
