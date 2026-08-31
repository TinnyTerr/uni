/**
 * Checking for, downloading and installing a new desktop build.
 *
 * The whole thing is desktop-only: the phone gets new code by reloading the
 * page from the server, which the service worker handles on its own.
 */
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../lib/platform';

type Stage = 'idle' | 'checking' | 'none' | 'found' | 'downloading' | 'ready' | 'error';

interface Found {
  version: string;
  date?: string;
  notes?: string;
}

/** Loaded on demand so the browser build never pulls in the Tauri plugin. */
const updater = () => import('@tauri-apps/plugin-updater');

export default function UpdateSettings() {
  const [stage, setStage] = useState<Stage>('idle');
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState('');

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then(setCurrent)
      .catch(() => setCurrent(''));
  }, []);

  const check = useCallback(async (quiet = false) => {
    setStage('checking');
    setError(null);
    try {
      const { check: doCheck } = await updater();
      const update = await doCheck();
      if (!update) {
        setFound(null);
        setStage(quiet ? 'idle' : 'none');
        return;
      }
      setFound({ version: update.version, date: update.date, notes: update.body });
      setStage('found');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  }, []);

  // A quiet check on open: worth knowing, not worth interrupting anyone for.
  useEffect(() => {
    if (isTauri()) void check(true);
  }, [check]);

  const install = async () => {
    setStage('downloading');
    setProgress(0);
    try {
      const { check: doCheck } = await updater();
      const update = await doCheck();
      if (!update) {
        setStage('none');
        return;
      }
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          got += event.data.chunkLength;
          setProgress(total ? Math.round((got / total) * 100) : 0);
        }
      });
      setStage('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  const restart = async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  };

  if (!isTauri()) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Updates</h2>
        </div>
        <p className="tiny dim" style={{ marginBottom: 0 }}>
          This is the web version — it updates itself. Reopening it while the server is reachable
          picks up the newest build; the offline copy is refreshed in the background.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Updates</h2>
        <div className="spacer" />
        {current && <span className="pill">v{current}</span>}
      </div>

      <p className="tiny dim">
        New desktop builds are published to the repository’s releases and verified against a signing
        key baked into this build, so an update can only come from you.
      </p>

      <div className="sync-actions">
        <button className="btn" onClick={() => void check()} disabled={stage === 'checking' || stage === 'downloading'}>
          {stage === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {stage === 'found' && (
          <button className="btn primary" onClick={() => void install()}>
            Download and install {found?.version}
          </button>
        )}
        {stage === 'ready' && (
          <button className="btn primary" onClick={() => void restart()}>
            Restart to finish
          </button>
        )}
      </div>

      {stage === 'none' && <p className="tiny" style={{ color: 'var(--ok)' }}>You’re on the latest version.</p>}

      {stage === 'found' && found && (
        <div className="sync-status" style={{ borderColor: 'var(--accent)' }}>
          <div>
            Version {found.version} is available
            {found.date ? ` (${found.date.split(' ')[0]})` : ''}.
          </div>
          {found.notes && <div className="tiny muted">{found.notes}</div>}
        </div>
      )}

      {stage === 'downloading' && (
        <div className="sync-status" style={{ borderColor: 'var(--warn)' }}>
          <div>Downloading… {progress}%</div>
          <div className="update-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {stage === 'ready' && (
        <p className="tiny" style={{ color: 'var(--ok)' }}>
          Installed. Restart to run the new version.
        </p>
      )}

      {stage === 'error' && (
        <p className="tiny" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
