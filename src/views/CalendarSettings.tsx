import { useRef, useState } from 'react';
import { uid, useStore } from '../lib/store';
import { buildIcs, mergeImported, parseIcs } from '../lib/ical';
import { saveTextFile } from '../lib/platform';
import { normaliseUrl } from '../lib/sync';
import { MODULE_COLOURS } from '../lib/types';

export default function CalendarSettings() {
  const { state, update } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const cfg = state.settings.server;
  const base = cfg.enabled ? normaliseUrl(cfg.url) : '';
  const feed = base ? `${base}/api/calendar.ics${cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : ''}` : '';
  const imported = state.events.filter((e) => e.uid).length;

  const doExport = async () => {
    try {
      const where = await saveTextFile('uni-schedule.ics', buildIcs(state), 'text/calendar');
      if (where) setMsg({ text: `Saved ${where}` });
    } catch (e) {
      setMsg({ text: String(e), bad: true });
    }
  };

  const doImport = async (file: File) => {
    try {
      const parsed = parseIcs(await file.text());
      if (parsed.length === 0) {
        setMsg({ text: 'No events found in that file.', bad: true });
        return;
      }
      const r = mergeImported(state.events, parsed, uid, MODULE_COLOURS[5]);
      update((s) => {
        s.events = r.events;
      });
      setMsg({ text: `Imported ${parsed.length} events: ${r.added} new, ${r.updated} updated.` });
    } catch (e) {
      setMsg({ text: `Could not read that file: ${e}`, bad: true });
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Calendar files (iCal)</h2>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => void doExport()}>
          Export .ics
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import .ics
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doImport(f);
          }}
        />
      </div>
      {msg && (
        <p className="tiny" style={{ color: msg.bad ? 'var(--danger)' : 'var(--ok)' }}>
          {msg.text}
        </p>
      )}
      <p className="tiny dim">
        Export has your timetable across every term, deadlines and events. Import adds events to the calendar; importing
        the same file again updates them rather than duplicating
        {imported > 0 ? ` (${imported} imported so far)` : ''}. Recurring events are expanded about a year ahead.
      </p>

      <label className="field">
        <span>
          Subscribe from another calendar
          <em className="dim"> — Google, Apple, Outlook</em>
        </span>
        {feed ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={feed} className="mono" onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard.writeText(feed).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <input readOnly value="Turn on the sync server below to get a live feed URL" />
        )}
      </label>
      {feed && cfg.token && (
        <p className="tiny dim" style={{ marginBottom: 0 }}>
          The URL contains your sync token, because calendar apps cannot send headers. Anyone with it can read your
          schedule. Google can only reach it if the server is reachable from the internet.
        </p>
      )}
    </div>
  );
}
