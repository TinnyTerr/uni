import { useEffect, useState } from 'react';
import { uid, useNotesProviders, useStore } from '../lib/store';
import type { SourceStatus } from '../lib/notes/provider';
import { allProviders } from '../lib/notes/provider';
import { ConfirmButton, Empty, Field } from '../components/ui';
import { isTauri } from '../lib/platform';
import SyncSettings from './SyncSettings';
import UpdateSettings from './UpdateSettings';

export default function Settings() {
  const { state, update, dataPath, backup } = useStore();
  const { local, notesAvailable } = useNotesProviders();
  const [status, setStatus] = useState<SourceStatus[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    local.status().then(setStatus).catch(() => setStatus([]));
  }, [local, state.settings.notesRoots]);

  // The folder picker and the OS opener only exist in the desktop build.
  const addRoot = async () => {
    if (!isTauri()) return;
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const picked = await openDialog({ directory: true, multiple: false, title: 'Choose a notes folder' });
    if (typeof picked !== 'string') return;
    const name = picked.split('/').filter(Boolean).pop() ?? picked;
    update((s) => {
      if (!s.settings.notesRoots.some((r) => r.path === picked)) {
        s.settings.notesRoots.push({ id: uid(), name, path: picked });
      }
    });
  };

  const reveal = async (path: string) => {
    if (!isTauri()) return;
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path);
  };

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Academic years</h2>
          <div className="spacer" />
          <button
            className="btn primary sm"
            onClick={() =>
              update((s) => {
                const id = uid();
                s.years.push({ id, name: `Year ${s.years.length + 1}`, degreeWeight: 0 });
                if (!s.settings.activeYearId) s.settings.activeYearId = id;
              })
            }
          >
            + Year
          </button>
        </div>
        {state.years.length === 0 ? (
          <Empty title="No years yet">Add an academic year to hold your modules.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 190 }}>Weight toward degree</th>
                <th style={{ width: 110 }}>Active</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {state.years.map((y) => (
                <tr key={y.id}>
                  <td>
                    <input
                      value={y.name}
                      onChange={(e) =>
                        update((s) => {
                          const t = s.years.find((x) => x.id === y.id);
                          if (t) t.name = e.target.value;
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={y.degreeWeight}
                      onChange={(e) =>
                        update((s) => {
                          const t = s.years.find((x) => x.id === y.id);
                          if (t) t.degreeWeight = Number(e.target.value);
                        })
                      }
                    />
                  </td>
                  <td>
                    {state.settings.activeYearId === y.id ? (
                      <span className="pill">current</span>
                    ) : (
                      <button
                        className="btn sm"
                        onClick={() =>
                          update((s) => {
                            s.settings.activeYearId = y.id;
                          })
                        }
                      >
                        Make current
                      </button>
                    )}
                  </td>
                  <td className="right">
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Delete year?"
                      onConfirm={() =>
                        update((s) => {
                          const mods = s.modules.filter((m) => m.yearId === y.id).map((m) => m.id);
                          s.modules = s.modules.filter((m) => m.yearId !== y.id);
                          s.terms = s.terms.filter((t) => t.yearId !== y.id);
                          s.sessions = s.sessions.filter((x) => !mods.includes(x.moduleId));
                          s.assessments = s.assessments.filter((x) => !mods.includes(x.moduleId));
                          s.years = s.years.filter((x) => x.id !== y.id);
                          if (s.settings.activeYearId === y.id) {
                            s.settings.activeYearId = s.years[0]?.id ?? null;
                          }
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Terms</h2>
          <div className="spacer" />
          <button
            className="btn primary sm"
            disabled={!state.settings.activeYearId}
            onClick={() =>
              update((s) => {
                const yearId = s.settings.activeYearId!;
                const y = new Date().getFullYear();
                s.terms.push({
                  id: uid(),
                  yearId,
                  name: 'New term',
                  start: `${y}-09-22`,
                  end: `${y}-12-12`,
                });
              })
            }
          >
            + Term
          </button>
        </div>
        <p className="tiny dim">
          Term dates decide which weeks a recurring session runs in, and drive the “week 4 of Autumn” label on the
          calendar.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Term</th>
              <th>Year</th>
              <th style={{ width: 170 }}>Starts</th>
              <th style={{ width: 170 }}>Ends</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {state.terms.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    value={t.name}
                    onChange={(e) =>
                      update((s) => {
                        const x = s.terms.find((z) => z.id === t.id);
                        if (x) x.name = e.target.value;
                      })
                    }
                  />
                </td>
                <td className="tiny muted">{state.years.find((y) => y.id === t.yearId)?.name ?? '—'}</td>
                <td>
                  <input
                    type="date"
                    value={t.start}
                    onChange={(e) =>
                      update((s) => {
                        const x = s.terms.find((z) => z.id === t.id);
                        if (x) x.start = e.target.value;
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="date"
                    value={t.end}
                    onChange={(e) =>
                      update((s) => {
                        const x = s.terms.find((z) => z.id === t.id);
                        if (x) x.end = e.target.value;
                      })
                    }
                  />
                </td>
                <td className="right">
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete term?"
                    onConfirm={() =>
                      update((s) => {
                        s.terms = s.terms.filter((z) => z.id !== t.id);
                        s.sessions = s.sessions.filter((z) => z.termId !== t.id);
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Notes sources</h2>
          <div className="spacer" />
          <button className="btn primary sm" onClick={addRoot} disabled={!notesAvailable}>
            + Add folder
          </button>
        </div>
        <p className="tiny dim">
          Each source is a folder of markdown — typically a checkout of one of your note repos. Nothing is copied or
          modified; the app only reads, and refuses to read anything outside these folders.
        </p>
        {!notesAvailable ? (
          <Empty title="Desktop only">
            Note folders are read from the filesystem, which this device has no access to. The
            schedule itself syncs here; open the desktop app to manage note sources.
          </Empty>
        ) : state.settings.notesRoots.length === 0 ? (
          <Empty title="No sources" action={<button className="btn primary" onClick={addRoot}>Choose a folder</button>}>
            Add the folder your notes repo is checked out into.
          </Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 200 }}>Name</th>
                <th>Location &amp; git status</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {state.settings.notesRoots.map((r) => {
                const st = status.find((s) => s.id === r.id);
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        value={r.name}
                        onChange={(e) =>
                          update((s) => {
                            const x = s.settings.notesRoots.find((z) => z.id === r.id);
                            if (x) x.name = e.target.value;
                          })
                        }
                      />
                    </td>
                    <td>
                      <div className="mono tiny">{r.path}</div>
                      <div className="tiny" style={{ color: st?.detail.includes('uncommitted') ? 'var(--warn)' : 'var(--muted)' }}>
                        {st?.detail ?? 'checking…'}
                      </div>
                      {st?.meta?.['Last commit'] && <div className="tiny dim">{st.meta['Last commit']}</div>}
                    </td>
                    <td className="right nowrap">
                      <button className="btn ghost sm" onClick={() => reveal(r.path)}>
                        Open
                      </button>
                      <ConfirmButton
                        label="Remove"
                        confirmLabel="Remove source?"
                        onConfirm={() =>
                          update((s) => {
                            s.settings.notesRoots = s.settings.notesRoots.filter((z) => z.id !== r.id);
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="tiny dim" style={{ marginTop: 12 }}>
          Registered providers: {allProviders().map((p) => `${p.label} (${p.id})`).join(', ') || 'none'}. A hosted
          notes service becomes a second provider here — existing links keep working because each link records the
          provider that made it.
        </div>
      </div>

      <SyncSettings />

      <UpdateSettings />

      <div className="card">
        <div className="card-head">
          <h2>Preferences &amp; data</h2>
        </div>
        <div className="row">
          <Field label="Theme">
            <select
              value={state.settings.theme}
              onChange={(e) =>
                update((s) => {
                  s.settings.theme = e.target.value as 'dark' | 'light';
                })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
          <Field label="Dashboard horizon" hint="days ahead">
            <input
              type="number"
              min={1}
              max={120}
              value={state.settings.horizonDays}
              onChange={(e) =>
                update((s) => {
                  s.settings.horizonDays = Number(e.target.value);
                })
              }
            />
          </Field>
        </div>
        <Field label="Data file">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={dataPath} className="mono" />
            <button
              className="btn"
              onClick={() => backup().then((p) => setMsg(`Backed up to ${p}`)).catch((e) => setMsg(String(e)))}
            >
              Back up now
            </button>
          </div>
        </Field>
        {msg && <p className="tiny" style={{ color: 'var(--ok)' }}>{msg}</p>}
        <p className="tiny dim" style={{ marginBottom: 0 }}>
          Everything lives in that one JSON file — plain text, easy to put under version control alongside your notes if
          you want.
        </p>
      </div>
    </>
  );
}
