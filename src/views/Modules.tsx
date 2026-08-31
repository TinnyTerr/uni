import { useState } from 'react';
import { uid, useActiveYear, useNotesProviders, useStore } from '../lib/store';
import { moduleResult, fmtMark } from '../lib/grades';
import { MODULE_COLOURS, type Module } from '../lib/types';
import { ConfirmButton, Dot, Empty, Field, Modal } from '../components/ui';
import { NoteLinkChips, NoteLinkEditor, NoteViewer } from '../components/NoteLinks';
import type { NoteLink } from '../lib/types';

export default function Modules() {
  const { state, update } = useStore();
  const { year, modules, assessments, sessions } = useActiveYear();
  const [editing, setEditing] = useState<Module | null>(null);
  const [viewing, setViewing] = useState<NoteLink | null>(null);

  const blank = (): Module => ({
    id: uid(),
    yearId: year?.id ?? '',
    code: '',
    title: '',
    credits: 20,
    colour: MODULE_COLOURS[modules.length % MODULE_COLOURS.length],
    lecturer: '',
    location: '',
    notes: [],
  });

  if (!year) {
    return <Empty title="No academic year">Create one in Settings first.</Empty>;
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Modules — {year.name}</h2>
          <span className="pill">{modules.reduce((s, m) => s + m.credits, 0)} credits</span>
          <div className="spacer" />
          <button className="btn primary sm" onClick={() => setEditing(blank())}>
            + Module
          </button>
        </div>
        {modules.length === 0 ? (
          <Empty title="No modules yet" action={<button className="btn primary" onClick={() => setEditing(blank())}>Add your first module</button>}>
            Modules are the spine of the app — timetable slots, deadlines and marks all hang off them.
          </Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Code</th>
                <th>Title</th>
                <th className="right">Credits</th>
                <th className="right">Sessions</th>
                <th className="right">Assessments</th>
                <th className="right">Mark</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => {
                const r = moduleResult(assessments.filter((a) => a.moduleId === m.id));
                return (
                  <tr key={m.id}>
                    <td>
                      <Dot colour={m.colour} />
                    </td>
                    <td className="mono">{m.code}</td>
                    <td>
                      {m.title}
                      {m.lecturer && <div className="tiny dim">{m.lecturer}</div>}
                    </td>
                    <td className="right">{m.credits}</td>
                    <td className="right">{sessions.filter((s) => s.moduleId === m.id).length}</td>
                    <td className="right">
                      {r.count}
                      {r.declared !== 100 && r.count > 0 && (
                        <span className="tiny" style={{ color: 'var(--warn)' }} title="Assessment weights do not total 100%">
                          {' '}
                          ({r.declared}%)
                        </span>
                      )}
                    </td>
                    <td className="right mono">{fmtMark(r.provisional, 1)}</td>
                    <td>
                      <NoteLinkChips links={m.notes} onOpen={setViewing} />
                    </td>
                    <td className="right nowrap">
                      <button className="btn ghost sm" onClick={() => setEditing(m)}>
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
        <ModuleEditor
          module={editing}
          isNew={!state.modules.some((m) => m.id === editing.id)}
          onClose={() => setEditing(null)}
          onDelete={() => {
            update((s) => {
              s.modules = s.modules.filter((m) => m.id !== editing.id);
              s.sessions = s.sessions.filter((x) => x.moduleId !== editing.id);
              s.assessments = s.assessments.filter((x) => x.moduleId !== editing.id);
            });
            setEditing(null);
          }}
        />
      )}
      {viewing && <NoteViewer link={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function ModuleEditor({
  module,
  isNew,
  onClose,
  onDelete,
}: {
  module: Module;
  isNew: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { update } = useStore();
  const { local } = useNotesProviders();
  const [draft, setDraft] = useState<Module>(module);
  const set = <K extends keyof Module>(k: K, v: Module[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    if (!draft.code.trim() && !draft.title.trim()) return;
    update((s) => {
      const i = s.modules.findIndex((m) => m.id === draft.id);
      if (i >= 0) s.modules[i] = draft;
      else s.modules.push(draft);
    });
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New module' : draft.code || 'Module'}
      onClose={onClose}
      footer={
        <>
          {!isNew && <ConfirmButton onConfirm={onDelete} label="Delete module" confirmLabel="Delete module and its data?" />}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Code" hint="e.g. COMP2011">
          <input autoFocus value={draft.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Credits" hint="UK modules are usually 10, 15 or 20">
          <input
            type="number"
            min={0}
            max={240}
            value={draft.credits}
            onChange={(e) => set('credits', Number(e.target.value))}
          />
        </Field>
      </div>
      <Field label="Title">
        <input value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="row">
        <Field label="Lecturer">
          <input value={draft.lecturer} onChange={(e) => set('lecturer', e.target.value)} />
        </Field>
        <Field label="Usual location">
          <input value={draft.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
      </div>
      <Field label="Colour">
        <div style={{ display: 'flex', gap: 7 }}>
          {MODULE_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set('colour', c)}
              aria-label={c}
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: c,
                border: draft.colour === c ? '2px solid var(--text)' : '1px solid var(--line-2)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </Field>
      <Field label="Linked notes">
        <NoteLinkEditor provider={local} links={draft.notes} onChange={(n) => set('notes', n)} />
      </Field>
    </Modal>
  );
}
