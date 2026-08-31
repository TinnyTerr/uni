/**
 * Picking the server that is the source of truth, and saying what should
 * happen when this device and that server disagree.
 */
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '../lib/store';
import { Field } from '../components/ui';
import { deviceId, guessDeviceName, isTauri } from '../lib/platform';
import { clearBookmark, health, normaliseUrl, type Health } from '../lib/sync';
import type { ConflictPolicy } from '../lib/types';

const POLICIES: { value: ConflictPolicy; label: string; blurb: string }[] = [
  {
    value: 'prompt',
    label: 'Ask me (default: latest wins)',
    blurb:
      'Shows both copies side by side with the more recent one already selected, so Enter takes the latest and one click takes the other.',
  },
  {
    value: 'latest',
    label: 'Latest wins, silently',
    blurb: 'Never interrupts. Whichever copy was edited most recently replaces the other.',
  },
  {
    value: 'local',
    label: 'This device always wins',
    blurb: 'Treats this device as the author of record; the server is overwritten every time.',
  },
  {
    value: 'server',
    label: 'The server always wins',
    blurb: 'Makes this device a read-only mirror in practice — local edits lose whenever they clash.',
  },
];

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'never' : formatDistanceToNow(at, { addSuffix: true });
}

export default function SyncSettings() {
  const { state, update, sync, syncNow } = useStore();
  const cfg = state.settings.server;

  const [probe, setProbe] = useState<Health | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  // A changed address invalidates whatever the last probe said.
  useEffect(() => {
    setProbe(null);
    setProbeError(null);
  }, [cfg.url, cfg.token]);

  const test = async () => {
    setProbing(true);
    setProbeError(null);
    try {
      setProbe(await health(cfg));
    } catch (e) {
      setProbe(null);
      setProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const forget = () => {
    // Drops only this device's memory of where the two copies last agreed, so
    // the next sync starts from scratch and asks rather than assuming.
    clearBookmark(cfg.url);
    void syncNow();
  };

  const statusLine = () => {
    switch (sync.status) {
      case 'off':
        return 'Not syncing — this device keeps its own copy only.';
      case 'syncing':
        return 'Talking to the server…';
      case 'conflict':
        return 'Paused: both copies changed and the clash is unresolved.';
      case 'error':
        return sync.error ?? 'Something went wrong.';
      case 'idle':
      default:
        return sync.pending
          ? 'Local changes not yet sent.'
          : `In step with the server${sync.rev !== null ? ` at revision ${sync.rev}` : ''}.`;
    }
  };

  const tone =
    sync.status === 'error' || sync.status === 'conflict'
      ? 'var(--danger)'
      : sync.status === 'idle' && !sync.pending
        ? 'var(--ok)'
        : 'var(--warn)';

  return (
    <div className="card">
      <div className="card-head">
        <h2>Sync server</h2>
        <div className="spacer" />
        <span className="pill" style={{ borderColor: tone, color: tone }}>
          {sync.status === 'idle' && sync.pending ? 'pending' : sync.status}
        </span>
      </div>

      <p className="tiny dim">
        One server holds the copy every device agrees on. Each device still keeps a complete local
        copy and works offline; the server is only what they reconcile against when they can reach
        it. Run it with <code className="mono">npm run serve</code> on a machine that stays on, then
        point this device — and your phone’s browser — at the same address.
      </p>

      <div className="row">
        <Field label="Server address" hint="host:port, or a full URL">
          <input
            className="mono"
            placeholder="http://192.168.1.20:4173"
            value={cfg.url}
            onChange={(e) =>
              update((s) => {
                s.settings.server.url = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Access token" hint="only if the server sets UNI_TOKEN">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="mono"
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              value={cfg.token}
              onChange={(e) =>
                update((s) => {
                  s.settings.server.token = e.target.value;
                })
              }
            />
            <button className="btn ghost sm" onClick={() => setShowToken((v) => !v)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>
      </div>

      <div className="row">
        <Field label="This device is called" hint="shown when a conflict names who wrote what">
          <input
            placeholder={guessDeviceName()}
            value={state.settings.deviceName}
            onChange={(e) =>
              update((s) => {
                s.settings.deviceName = e.target.value;
              })
            }
          />
        </Field>
        <Field label="Use this server">
          <select
            value={cfg.enabled ? 'on' : 'off'}
            onChange={(e) =>
              update((s) => {
                s.settings.server.enabled = e.target.value === 'on';
              })
            }
          >
            <option value="off">Off — local copy only</option>
            <option value="on">On — this server is the source of truth</option>
          </select>
        </Field>
      </div>

      <Field label="When both copies have changed">
        <select
          value={cfg.conflictPolicy}
          onChange={(e) =>
            update((s) => {
              s.settings.server.conflictPolicy = e.target.value as ConflictPolicy;
            })
          }
        >
          {POLICIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="tiny dim">
        {POLICIES.find((p) => p.value === cfg.conflictPolicy)?.blurb}
      </p>

      <div className="sync-actions">
        <button className="btn" onClick={test} disabled={probing || !normaliseUrl(cfg.url)}>
          {probing ? 'Checking…' : 'Test connection'}
        </button>
        <button
          className="btn"
          onClick={() => void syncNow()}
          disabled={!cfg.enabled || sync.status === 'syncing'}
        >
          Sync now
        </button>
        <button className="btn ghost" onClick={forget} disabled={!normaliseUrl(cfg.url)}>
          Forget sync history
        </button>
      </div>

      <div className="sync-status" style={{ borderColor: tone }}>
        <div style={{ color: tone }}>{statusLine()}</div>
        <div className="tiny dim">
          Last agreed {ago(sync.lastSyncAt)}
          {sync.rev !== null && ` · revision ${sync.rev}`} · device id{' '}
          <span className="mono">{deviceId()}</span> · {isTauri() ? 'desktop app' : 'browser'}
        </div>
      </div>

      {probeError && (
        <p className="tiny" style={{ color: 'var(--danger)' }}>
          {probeError}
        </p>
      )}
      {probe && (
        <p className="tiny" style={{ color: probe.authorised ? 'var(--ok)' : 'var(--warn)' }}>
          {probe.authorised
            ? `Reached ${normaliseUrl(cfg.url)} — revision ${probe.rev ?? 0}${
                probe.device ? `, last written by ${probe.device}` : ', nothing pushed yet'
              }.`
            : 'Server is there, but it wants an access token — paste the value of UNI_TOKEN above.'}
        </p>
      )}

      <details className="sync-help">
        <summary className="tiny">Getting it onto your phone</summary>
        <ol className="tiny dim">
          <li>
            On the machine that will hold the data: <code className="mono">npm run build</code> then{' '}
            <code className="mono">npm run serve</code>. It prints a{' '}
            <code className="mono">http://192.168.…</code> address.
          </li>
          <li>Open that address in your phone’s browser, on the same network.</li>
          <li>
            Add it to the home screen — “Install app” in Chrome, Share → “Add to Home Screen” in
            Safari. It then opens full screen and works offline.
          </li>
          <li>In the phone’s Settings, put the same address in here and switch sync on.</li>
        </ol>
        <p className="tiny dim">
          Note folders stay on the desktop; the phone syncs the schedule, deadlines and marks.
        </p>
      </details>
    </div>
  );
}
