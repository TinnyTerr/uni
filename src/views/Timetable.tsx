import { useMemo, useState } from 'react';
import { uid, useActiveYear, useStore } from '../lib/store';
import { DAY_NAMES, minutesOf } from '../lib/dates';
import type { IsoDay, Session, SessionKind } from '../lib/types';
import { ConfirmButton, Empty, Field, Modal } from '../components/ui';

const KINDS: SessionKind[] = ['Lecture', 'Seminar', 'Lab', 'Tutorial', 'Workshop', 'Office hours', 'Other'];
const HOUR_H = 52;
const DAY_START = 8;
const DAY_END = 20;

export default function Timetable() {
  const { state } = useStore();
  const { terms, modules, sessions } = useActiveYear();
  const [termId, setTermId] = useState<string>(() => terms[0]?.id ?? '');
  const [showWeekend, setShowWeekend] = useState(false);
  const [editing, setEditing] = useState<Session | null>(null);

  const activeTerm = terms.find((t) => t.id === termId) ?? terms[0];
  const shown = useMemo(
    () => sessions.filter((s) => s.termId === activeTerm?.id),
    [sessions, activeTerm],
  );
  const days: IsoDay[] = showWeekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  const blank = (day: IsoDay = 1): Session => ({
    id: uid(),
    moduleId: modules[0]?.id ?? '',
    termId: activeTerm?.id ?? '',
    kind: 'Lecture',
    day,
    start: '09:00',
    end: '10:00',
    location: '',
    weeks: null,
  });

  if (!modules.length) {
    return <Empty title="Add a module first">Timetable slots belong to a module.</Empty>;
  }
  if (!activeTerm) {
    return <Empty title="No terms defined">Add term dates in Settings so sessions know when to repeat.</Empty>;
  }

  return (
    <>
      <div className="card-head">
        <h2>Weekly timetable</h2>
        <select style={{ width: 'auto' }} value={activeTerm.id} onChange={(e) => setTermId(e.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.start} → {t.end})
            </option>
          ))}
        </select>
        <label className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={showWeekend}
            onChange={(e) => setShowWeekend(e.target.checked)}
          />
          Weekends
        </label>
        <div className="spacer" />
        <button className="btn primary sm" onClick={() => setEditing(blank())}>
          + Session
        </button>
      </div>

      <div className={showWeekend ? 'tt weekend' : 'tt'}>
        <div className="tt-h" />
        {days.map((d) => (
          <div className="tt-h" key={d}>
            {DAY_NAMES[d]}
          </div>
        ))}
        <div>
          {hours.map((h) => (
            <div className="tt-time" key={h}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div
            className="tt-col"
            key={d}
            onDoubleClick={(e) => {
              const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
              const hour = Math.max(DAY_START, Math.min(DAY_END - 1, DAY_START + Math.floor(y / HOUR_H)));
              setEditing({
                ...blank(d),
                start: `${String(hour).padStart(2, '0')}:00`,
                end: `${String(hour + 1).padStart(2, '0')}:00`,
              });
            }}
          >
            {hours.map((h) => (
              <div className="tt-hour" key={h} />
            ))}
            {shown
              .filter((s) => s.day === d)
              .map((s) => {
                const mod = modules.find((m) => m.id === s.moduleId);
                const top = ((minutesOf(s.start) - DAY_START * 60) / 60) * HOUR_H;
                const height = Math.max(24, ((minutesOf(s.end) - minutesOf(s.start)) / 60) * HOUR_H - 2);
                return (
                  <div
                    key={s.id}
                    className="slot"
                    style={{
                      top,
                      height,
                      background: `${mod?.colour ?? '#888'}26`,
                      borderLeftColor: mod?.colour ?? '#888',
                    }}
                    onClick={() => setEditing(s)}
                    title={`${mod?.code} ${s.kind} · ${s.start}–${s.end}`}
                  >
                    <div className="t">
                      {mod?.code} {s.kind}
                    </div>
                    <div className="s">
                      {s.start}–{s.end}
                      {s.location ? ` · ${s.location}` : ''}
                    </div>
                    {s.weeks && <div className="s">wks {compress(s.weeks)}</div>}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      <p className="tiny dim" style={{ marginTop: 10 }}>
        Double-click an empty slot to add a session there. Sessions repeat every week of {activeTerm.name} unless you
        restrict them to particular teaching weeks.
      </p>

      {editing && (
        <SessionEditor
          session={editing}
          isNew={!state.sessions.some((s) => s.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** [1,2,3,5,7,8] → "1-3, 5, 7-8" */
function compress(weeks: number[]): string {
  const sorted = [...weeks].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** "1-3, 5, 7-8" → [1,2,3,5,7,8]; blank means every week. */
function expand(spec: string): number[] | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const out = new Set<number>();
  for (const part of trimmed.split(',')) {
    const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

function SessionEditor({
  session,
  isNew,
  onClose,
}: {
  session: Session;
  isNew: boolean;
  onClose: () => void;
}) {
  const { update } = useStore();
  const { terms, modules } = useActiveYear();
  const [draft, setDraft] = useState<Session>(session);
  const [weeksText, setWeeksText] = useState(session.weeks ? compress(session.weeks) : '');
  const set = <K extends keyof Session>(k: K, v: Session[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const invalid = minutesOf(draft.end) <= minutesOf(draft.start);

  const save = () => {
    if (invalid) return;
    const final = { ...draft, weeks: expand(weeksText) };
    update((s) => {
      const i = s.sessions.findIndex((x) => x.id === final.id);
      if (i >= 0) s.sessions[i] = final;
      else s.sessions.push(final);
    });
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New session' : 'Edit session'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <ConfirmButton
              onConfirm={() => {
                update((s) => {
                  s.sessions = s.sessions.filter((x) => x.id !== draft.id);
                });
                onClose();
              }}
            />
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={invalid}>
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Module">
          <select value={draft.moduleId} onChange={(e) => set('moduleId', e.target.value)}>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select value={draft.kind} onChange={(e) => set('kind', e.target.value as SessionKind)}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Term">
          <select value={draft.termId} onChange={(e) => set('termId', e.target.value)}>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day">
          <select value={draft.day} onChange={(e) => set('day', Number(e.target.value) as IsoDay)}>
            {([1, 2, 3, 4, 5, 6, 7] as IsoDay[]).map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Start">
          <input type="time" value={draft.start} onChange={(e) => set('start', e.target.value)} />
        </Field>
        <Field label="End">
          <input type="time" value={draft.end} onChange={(e) => set('end', e.target.value)} />
        </Field>
      </div>
      {invalid && <p className="tiny" style={{ color: 'var(--danger)' }}>End time must be after the start time.</p>}
      <Field label="Location">
        <input value={draft.location} onChange={(e) => set('location', e.target.value)} />
      </Field>
      <Field label="Teaching weeks" hint="blank = every week, or e.g. 1-5, 7, 9-11">
        <input value={weeksText} onChange={(e) => setWeeksText(e.target.value)} placeholder="every week" />
      </Field>
    </Modal>
  );
}
