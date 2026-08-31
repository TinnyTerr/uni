import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { uid, useActiveYear, useNotesProviders, useStore } from '../lib/store';
import { iso, parse, relativeDay } from '../lib/dates';
import type { Assessment, AssessmentKind, AssessmentStatus, NoteLink } from '../lib/types';
import { ConfirmButton, Dot, Empty, Field, Modal } from '../components/ui';
import { NoteLinkChips, NoteLinkEditor, NoteViewer } from '../components/NoteLinks';

const KINDS: AssessmentKind[] = ['Coursework', 'Exam', 'Presentation', 'Lab report', 'Dissertation', 'Other'];
const STATUSES: { id: AssessmentStatus; label: string }[] = [
  { id: 'todo', label: 'Not started' },
  { id: 'doing', label: 'In progress' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'marked', label: 'Marked' },
];

type Filter = 'open' | 'all' | 'done';

export default function Assessments() {
  const { state, update } = useStore();
  const { year, modules, assessments } = useActiveYear();
  const [filter, setFilter] = useState<Filter>('open');
  const [editing, setEditing] = useState<Assessment | null>(null);
  const [viewing, setViewing] = useState<NoteLink | null>(null);
  const now = new Date();

  const rows = useMemo(() => {
    const done = (a: Assessment) => a.status === 'submitted' || a.status === 'marked';
    return assessments
      .filter((a) => (filter === 'all' ? true : filter === 'done' ? done(a) : !done(a)))
      .sort((a, b) => parse(a.due).getTime() - parse(b.due).getTime());
  }, [assessments, filter]);

  const blank = (): Assessment => ({
    id: uid(),
    moduleId: modules[0]?.id ?? '',
    title: '',
    kind: 'Coursework',
    due: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 16, 0)),
    weight: 100,
    status: 'todo',
    mark: null,
    description: '',
    notes: [],
  });

  if (!year) return <Empty title="No academic year">Create one in Settings first.</Empty>;
  if (!modules.length) return <Empty title="Add a module first">Every assessment belongs to a module.</Empty>;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Assessments</h2>
          <div className="seg">
            {(['open', 'done', 'all'] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'open' ? 'Outstanding' : f === 'done' ? 'Handed in' : 'All'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button className="btn primary sm" onClick={() => setEditing(blank())}>
            + Assessment
          </button>
        </div>

        {rows.length === 0 ? (
          <Empty title="Nothing here">
            {filter === 'open' ? 'No outstanding work — enjoy it.' : 'No assessments recorded yet.'}
          </Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Assessment</th>
                <th>Module</th>
                <th>Kind</th>
                <th className="right">Weight</th>
                <th>Due</th>
                <th>Status</th>
                <th className="right">Mark</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const mod = modules.find((m) => m.id === a.moduleId);
                const due = parse(a.due);
                const open = a.status !== 'submitted' && a.status !== 'marked';
                const late = open && due < now;
                return (
                  <tr key={a.id}>
                    <td>
                      <Dot colour={mod?.colour ?? '#888'} />
                    </td>
                    <td>
                      <div className={open ? '' : 'strike'}>{a.title}</div>
                      {a.description && <div className="tiny dim">{a.description}</div>}
                    </td>
                    <td className="mono tiny">{mod?.code}</td>
                    <td className="tiny muted">{a.kind}</td>
                    <td className="right">{a.weight}%</td>
                    <td className="nowrap">
                      <div className={late ? 'overdue' : ''}>{format(due, 'EEE d MMM')}</div>
                      <div className="tiny dim">
                        {format(due, 'HH:mm')} · {relativeDay(due, now)}
                      </div>
                    </td>
                    <td>
                      <select
                        className={`status-${a.status}`}
                        style={{ width: 'auto', padding: '3px 6px', fontSize: 12 }}
                        value={a.status}
                        onChange={(e) =>
                          update((s) => {
                            const t = s.assessments.find((x) => x.id === a.id);
                            if (t) t.status = e.target.value as AssessmentStatus;
                          })
                        }
                      >
                        {STATUSES.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="right mono">{a.mark === null ? '—' : `${a.mark}%`}</td>
                    <td>
                      <NoteLinkChips links={a.notes} onOpen={setViewing} />
                    </td>
                    <td className="right">
                      <button className="btn ghost sm" onClick={() => setEditing(a)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <AssessmentEditor
          assessment={editing}
          isNew={!state.assessments.some((a) => a.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {viewing && <NoteViewer link={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function AssessmentEditor({
  assessment,
  isNew,
  onClose,
}: {
  assessment: Assessment;
  isNew: boolean;
  onClose: () => void;
}) {
  const { update } = useStore();
  const { modules } = useActiveYear();
  const { local } = useNotesProviders();
  const [draft, setDraft] = useState<Assessment>(assessment);
  const set = <K extends keyof Assessment>(k: K, v: Assessment[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    if (!draft.title.trim()) return;
    // Recording a mark implies the work is marked; keep the two consistent.
    const final = { ...draft, status: draft.mark !== null ? 'marked' : draft.status } as Assessment;
    update((s) => {
      const i = s.assessments.findIndex((a) => a.id === final.id);
      if (i >= 0) s.assessments[i] = final;
      else s.assessments.push(final);
    });
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New assessment' : draft.title || 'Assessment'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <ConfirmButton
              onConfirm={() => {
                update((s) => {
                  s.assessments = s.assessments.filter((a) => a.id !== draft.id);
                });
                onClose();
              }}
            />
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!draft.title.trim()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Title">
        <input autoFocus value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
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
          <select value={draft.kind} onChange={(e) => set('kind', e.target.value as AssessmentKind)}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Due" hint="deadline or exam time">
          <input type="datetime-local" value={draft.due} onChange={(e) => set('due', e.target.value)} />
        </Field>
        <Field label="Weight" hint="% of the module">
          <input
            type="number"
            min={0}
            max={100}
            value={draft.weight}
            onChange={(e) => set('weight', Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="row">
        <Field label="Status">
          <select value={draft.status} onChange={(e) => set('status', e.target.value as AssessmentStatus)}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mark" hint="percentage, blank if unmarked">
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={draft.mark ?? ''}
            onChange={(e) => set('mark', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
      </div>
      <Field label="Brief">
        <textarea value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="Linked notes">
        <NoteLinkEditor provider={local} links={draft.notes} onChange={(n) => set('notes', n)} />
      </Field>
    </Modal>
  );
}
