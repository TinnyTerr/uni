import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useNotesProviders, useStore } from '../lib/store';
import type { NoteHit } from '../lib/notes/provider';
import type { NoteLink } from '../lib/types';
import { Empty } from '../components/ui';
import { NoteViewer } from '../components/NoteLinks';

export default function Notes({ go }: { go: (view: string) => void }) {
  const { state } = useStore();
  const { local } = useNotesProviders();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<NoteLink | null>(null);
  const [nonce, setNonce] = useState(0);

  /** Which modules / assessments point at a given note. */
  const backlinks = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (link: NoteLink, label: string) => {
      const list = map.get(link.noteId) ?? [];
      list.push(label);
      map.set(link.noteId, list);
    };
    for (const m of state.modules) m.notes.forEach((l) => add(l, m.code || m.title));
    for (const a of state.assessments) {
      const mod = state.modules.find((x) => x.id === a.moduleId);
      a.notes.forEach((l) => add(l, `${mod?.code ?? ''} ${a.title}`.trim()));
    }
    return map;
  }, [state.modules, state.assessments]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const run = async () => {
      try {
        const results = query.trim()
          ? await local.search(query, 100)
          : (await local.list()).map((n) => ({ ...n, snippet: '', score: 0 }) as NoteHit);
        if (!cancelled) {
          setHits(results);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    const t = window.setTimeout(run, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, local, nonce, state.settings.notesRoots]);

  if (!local.isConfigured()) {
    return (
      <Empty
        title="No note sources yet"
        action={
          <button className="btn primary" onClick={() => go('settings')}>
            Add a note folder
          </button>
        }
      >
        Point the app at your note repositories and every note becomes linkable from a module or an assessment.
      </Empty>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Notes</h2>
          <span className="pill">{local.label}</span>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setNonce((n) => n + 1)} disabled={busy}>
            {busy ? 'Indexing…' : 'Reindex'}
          </button>
        </div>
        <input
          placeholder="Search titles, paths and contents across every note repo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tiny dim" style={{ margin: '8px 2px 12px' }}>
          {hits.length} note{hits.length === 1 ? '' : 's'}
          {query ? ' matching' : ' indexed'} · {state.settings.notesRoots.length} source
          {state.settings.notesRoots.length === 1 ? '' : 's'}
        </div>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}

        <table className="data">
          <thead>
            <tr>
              <th>Note</th>
              <th>Source</th>
              <th>Linked from</th>
              <th className="right">Modified</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((n) => {
              const links = backlinks.get(n.id) ?? [];
              return (
                <tr
                  key={n.id}
                  className="clickable"
                  onClick={() =>
                    setViewing({ providerId: local.id, noteId: n.id, title: n.title, path: n.path })
                  }
                >
                  <td>
                    <div>{n.title}</div>
                    {n.snippet && <div className="snippet">{n.snippet}</div>}
                  </td>
                  <td className="tiny dim">
                    {n.rootName}
                    <div className="mono tiny">{n.relPath}</div>
                  </td>
                  <td>
                    {links.length ? (
                      links.map((l, i) => (
                        <span className="pill" key={i} style={{ marginRight: 4 }}>
                          {l}
                        </span>
                      ))
                    ) : (
                      <span className="tiny dim">—</span>
                    )}
                  </td>
                  <td className="right tiny dim nowrap">
                    {n.modifiedMs ? format(new Date(n.modifiedMs), 'd MMM yyyy') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!busy && !hits.length && <Empty title="Nothing matched">Try a different search.</Empty>}
      </div>
      {viewing && <NoteViewer link={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
