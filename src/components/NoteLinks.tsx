/**
 * Attach / preview / open note links. Talks only to `NotesProvider`, so the
 * whole component keeps working when a hosted provider replaces local git.
 */
import { useEffect, useMemo, useState } from 'react';
import type { NoteLink } from '../lib/types';
import type { NoteHit, NotesProvider } from '../lib/notes/provider';
import { providerFor, toLink } from '../lib/notes/provider';
import { Modal } from './ui';

export function NoteLinkChips({
  links,
  onRemove,
  onOpen,
}: {
  links: NoteLink[];
  onRemove?: (link: NoteLink) => void;
  onOpen: (link: NoteLink) => void;
}) {
  if (!links.length) return <span className="tiny dim">No notes linked</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {links.map((l) => (
        <span className="linkchip" key={`${l.providerId}:${l.noteId}`} title={l.path}>
          <span className="dim">🔗</span>
          <button className="open" onClick={() => onOpen(l)}>
            {l.title}
          </button>
          {onRemove && (
            <button className="x" onClick={() => onRemove(l)} aria-label={`Unlink ${l.title}`}>
              ✕
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export function NotePicker({
  provider,
  attached,
  onPick,
  onClose,
}: {
  provider: NotesProvider;
  attached: NoteLink[];
  onPick: (link: NoteLink) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const attachedIds = useMemo(() => new Set(attached.map((a) => a.noteId)), [attached]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const run = async () => {
      try {
        const results = query.trim()
          ? await provider.search(query, 60)
          : (await provider.list())
              .slice(0, 60)
              .map((n) => ({ ...n, snippet: '', score: 0 }) as NoteHit);
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
  }, [query, provider]);

  return (
    <Modal title="Link a note" onClose={onClose} wide>
      {!provider.isConfigured() ? (
        <p className="muted">
          No note sources configured yet. Add one in <b>Settings → Notes</b>.
        </p>
      ) : (
        <>
          <input
            autoFocus
            placeholder="Search titles, paths and contents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="tiny dim" style={{ margin: '8px 2px' }}>
            {busy ? 'Searching…' : `${hits.length} note${hits.length === 1 ? '' : 's'}`}
            {' · '}
            {provider.label}
          </div>
          {err && <p className="tiny" style={{ color: 'var(--danger)' }}>{err}</p>}
          <div className="note-list">
            {hits.map((n) => (
              <div
                key={n.id}
                className={attachedIds.has(n.id) ? 'note-row on' : 'note-row'}
                onClick={() => onPick(toLink(provider.id, n))}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="nt">{n.title}</div>
                  {n.snippet && <div className="snippet">{n.snippet}</div>}
                </div>
                <span className="np">
                  {n.rootName} · {n.relPath}
                </span>
              </div>
            ))}
            {!busy && !hits.length && <p className="tiny dim" style={{ padding: 8 }}>Nothing matched.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}

export function NoteViewer({ link, onClose }: { link: NoteLink; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const provider = providerFor(link);

  useEffect(() => {
    let cancelled = false;
    if (!provider) {
      setErr(`No provider registered for "${link.providerId}" — this link was made by another source.`);
      return;
    }
    provider
      .read(link)
      .then((b) => !cancelled && setBody(b.content + (b.truncated ? '\n\n… truncated …' : '')))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [link, provider]);

  return (
    <Modal
      title={link.title}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="tiny dim mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {link.path}
          </span>
          <button className="btn" onClick={() => provider?.openExternally(link)} disabled={!provider}>
            Open in editor
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {err ? (
        <p style={{ color: 'var(--danger)' }}>{err}</p>
      ) : body === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="preview">{body}</div>
      )}
    </Modal>
  );
}

/** Full editor block: chips + "Link a note" button + preview, wired together. */
export function NoteLinkEditor({
  provider,
  links,
  onChange,
}: {
  provider: NotesProvider;
  links: NoteLink[];
  onChange: (links: NoteLink[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<NoteLink | null>(null);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <NoteLinkChips
          links={links}
          onOpen={setViewing}
          onRemove={(l) => onChange(links.filter((x) => x.noteId !== l.noteId))}
        />
        <div>
          <button type="button" className="btn sm" onClick={() => setPicking(true)}>
            + Link a note
          </button>
        </div>
      </div>
      {picking && (
        <NotePicker
          provider={provider}
          attached={links}
          onClose={() => setPicking(false)}
          onPick={(link) => {
            onChange(
              links.some((l) => l.noteId === link.noteId)
                ? links.filter((l) => l.noteId !== link.noteId)
                : [...links, link],
            );
          }}
        />
      )}
      {viewing && <NoteViewer link={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
