import { useState } from 'react';
import { addHours, setHours, setMinutes } from 'date-fns';
import { uid, useStore } from '../lib/store';
import { iso } from '../lib/dates';
import { MODULE_COLOURS, type CalEvent } from '../lib/types';
import { ConfirmButton, Field, Modal } from '../components/ui';

function blank(day?: Date): CalEvent {
  const base = setMinutes(setHours(day ?? new Date(), 12), 0);
  return {
    id: uid(),
    title: '',
    start: iso(base),
    end: iso(addHours(base, 1)),
    allDay: false,
    colour: MODULE_COLOURS[4],
    location: '',
    description: '',
  };
}

export function EventEditor({
  eventId,
  day,
  onClose,
}: {
  eventId: string | null;
  day?: Date;
  onClose: () => void;
}) {
  const { state, update } = useStore();
  const existing = eventId ? state.events.find((e) => e.id === eventId) : undefined;
  const [draft, setDraft] = useState<CalEvent>(existing ?? blank(day));
  const set = <K extends keyof CalEvent>(k: K, v: CalEvent[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    if (!draft.title.trim()) return;
    update((s) => {
      const i = s.events.findIndex((e) => e.id === draft.id);
      if (i >= 0) s.events[i] = draft;
      else s.events.push(draft);
    });
    onClose();
  };

  return (
    <Modal
      title={existing ? 'Edit event' : 'New event'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <ConfirmButton
              onConfirm={() => {
                update((s) => {
                  s.events = s.events.filter((e) => e.id !== draft.id);
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
        <Field label="Starts">
          <input type="datetime-local" value={draft.start} onChange={(e) => set('start', e.target.value)} />
        </Field>
        <Field label="Ends">
          <input type="datetime-local" value={draft.end} onChange={(e) => set('end', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label="Location">
          <input value={draft.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Colour">
          <select value={draft.colour} onChange={(e) => set('colour', e.target.value)}>
            {MODULE_COLOURS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={draft.allDay}
          onChange={(e) => set('allDay', e.target.checked)}
        />
        <span style={{ margin: 0 }}>All day</span>
      </label>
      <Field label="Notes">
        <textarea value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
    </Modal>
  );
}
