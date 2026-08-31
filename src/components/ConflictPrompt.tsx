/**
 * Shown when this device and the server both changed since they last agreed.
 *
 * The point of the dialogue is that neither copy is thrown away silently. Both
 * sides are described in the same terms — when, from where, and how much is in
 * them — and the more recently edited one is offered as the default, so
 * pressing Enter does the "latest wins" thing without that being the only
 * thing on offer.
 */
import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { summarise, type Conflict, type SyncDoc } from '../lib/sync';
import { useStore } from '../lib/store';

function when(iso: string | null): string {
  if (!iso) return 'unknown time';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown time';
  return `${formatDistanceToNow(at, { addSuffix: true })} · ${at.toLocaleString()}`;
}

function Side({
  title,
  who,
  at,
  doc,
  newest,
  chosen,
  onChoose,
}: {
  title: string;
  who: string;
  at: string | null;
  doc: SyncDoc | null;
  newest: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  const counts = doc ? summarise(doc) : null;
  return (
    <button
      type="button"
      className={chosen ? 'conflict-side chosen' : 'conflict-side'}
      onClick={onChoose}
      aria-pressed={chosen}
    >
      <div className="conflict-side-head">
        <strong>{title}</strong>
        {newest && <span className="pill">newest</span>}
      </div>
      <div className="tiny muted">{who}</div>
      <div className="tiny dim">{when(at)}</div>
      {counts ? (
        <div className="conflict-counts tiny">
          <span>{counts.modules} modules</span>
          <span>{counts.sessions} sessions</span>
          <span>
            {counts.assessments} assessments{counts.marked ? ` · ${counts.marked} marked` : ''}
          </span>
          <span>{counts.events} events</span>
        </div>
      ) : (
        <div className="tiny dim">empty</div>
      )}
    </button>
  );
}

export default function ConflictPrompt({ conflict }: { conflict: Conflict }) {
  const { resolveConflict, dismissConflict, state } = useStore();
  // Latest wins is the default, but only the default: it starts selected and
  // is what Enter picks, and the other side is one click away.
  const [choice, setChoice] = useState<'local' | 'server'>(conflict.newer);
  const [remember, setRemember] = useState(false);
  const [working, setWorking] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirm.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissConflict();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissConflict]);

  const go = async () => {
    setWorking(true);
    try {
      await resolveConflict(choice, remember);
    } finally {
      setWorking(false);
    }
  };

  const localName = state.settings.deviceName || 'This device';
  const serverName = conflict.server.device
    ? `last written by ${conflict.server.device}`
    : 'written by another device';

  return (
    <div className="backdrop">
      <div className="modal wide" role="dialog" aria-label="Sync conflict">
        <div className="modal-head">
          <h2>Both copies changed</h2>
          <div className="spacer" />
          <span className="pill" style={{ background: 'var(--warn)', color: '#1a1e28' }}>
            rev {conflict.server.rev}
          </span>
        </div>

        <div className="modal-body">
          <p className="tiny muted">
            This device and the server have each been edited since they last agreed, so one copy has
            to win outright — a schedule cannot be merged field by field without inventing entries
            that neither of you wrote. Nothing is discarded until you choose; the server keeps the
            previous revision either way.
          </p>

          <div className="conflict-sides">
            <Side
              title="Server copy"
              who={serverName}
              at={conflict.server.updatedAt}
              doc={conflict.server.doc}
              newest={conflict.newer === 'server'}
              chosen={choice === 'server'}
              onChoose={() => setChoice('server')}
            />
            <Side
              title="This device"
              who={localName}
              at={conflict.localAt}
              doc={conflict.local}
              newest={conflict.newer === 'local'}
              chosen={choice === 'local'}
              onChoose={() => setChoice('local')}
            />
          </div>

          <label className="conflict-remember tiny">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Always do this from now on — sets the conflict rule in Settings to “always keep{' '}
              {choice === 'local' ? 'this device' : 'the server'}”, and stops asking.
            </span>
          </label>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={dismissConflict} disabled={working}>
            Decide later
          </button>
          <div className="spacer" />
          <button ref={confirm} className="btn primary" onClick={go} disabled={working}>
            {working
              ? 'Applying…'
              : choice === 'server'
                ? 'Take the server copy'
                : 'Push this device’s copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
