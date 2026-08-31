import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useStore } from '../lib/store';
import { occurrencesByDay, type Occurrence } from '../lib/occurrences';
import { DAY_SHORT, WEEK_OPTS, monthGrid, termContaining, termWeek, weekGrid, ymd } from '../lib/dates';
import { EventEditor } from './EventEditor';

type Mode = 'month' | 'week';

const HOUR_H = 52;
const DAY_START = 7;
const DAY_END = 22;

export default function CalendarView() {
  const { state } = useStore();
  const [mode, setMode] = useState<Mode>('week');
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState<Date>(new Date());
  const [editing, setEditing] = useState<{ id: string | null; day?: Date } | null>(null);

  const days = useMemo(() => (mode === 'month' ? monthGrid(cursor) : weekGrid(cursor)), [mode, cursor]);
  const byDay = useMemo(() => occurrencesByDay(state, days), [state, days]);

  const step = (dir: number) =>
    setCursor((c) => (mode === 'month' ? addMonths(c, dir) : addDays(c, dir * 7)));

  const term = termContaining(state.terms, cursor);
  const week = term ? termWeek(term, mode === 'month' ? startOfMonth(cursor) : cursor) : null;

  return (
    <div className="week-wrap">
      <div className="cal-head">
        <div className="cal-title">
          {mode === 'month'
            ? format(cursor, 'MMMM yyyy')
            : `${format(startOfWeek(cursor, WEEK_OPTS), 'd MMM')} – ${format(
                addDays(startOfWeek(cursor, WEEK_OPTS), 6),
                'd MMM yyyy',
              )}`}
        </div>
        <button className="btn sm" onClick={() => step(-1)}>
          ‹
        </button>
        <button className="btn sm" onClick={() => setCursor(new Date())}>
          Today
        </button>
        <button className="btn sm" onClick={() => step(1)}>
          ›
        </button>
        {term && week !== null && (
          <span className="pill">
            {term.name} · week {week}
          </span>
        )}
        <div className="spacer" style={{ flex: 1 }} />
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>
            Week
          </button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
            Month
          </button>
        </div>
        <button className="btn primary sm" onClick={() => setEditing({ id: null, day: selected })}>
          + Event
        </button>
      </div>

      {mode === 'month' ? (
        <MonthView
          days={days}
          cursor={cursor}
          byDay={byDay}
          selected={selected}
          onSelect={(d) => {
            setSelected(d);
            setCursor(d);
          }}
          onOpen={(o) => o.kind === 'event' && setEditing({ id: o.refId })}
          onAdd={(d) => setEditing({ id: null, day: d })}
        />
      ) : (
        <WeekView days={days} byDay={byDay} onOpen={(o) => o.kind === 'event' && setEditing({ id: o.refId })} />
      )}

      {editing && (
        <EventEditor
          eventId={editing.id}
          day={editing.day}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function MonthView({
  days,
  cursor,
  byDay,
  selected,
  onSelect,
  onOpen,
  onAdd,
}: {
  days: Date[];
  cursor: Date;
  byDay: Map<string, Occurrence[]>;
  selected: Date;
  onSelect: (d: Date) => void;
  onOpen: (o: Occurrence) => void;
  onAdd: (d: Date) => void;
}) {
  const today = new Date();
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div className="month">
        {DAY_SHORT.map((d) => (
          <div className="month-dow" key={d}>
            {d}
          </div>
        ))}
        {days.map((d) => {
          const items = byDay.get(ymd(d)) ?? [];
          const cls = [
            'month-cell',
            isSameMonth(d, cursor) ? '' : 'out',
            isSameDay(d, today) ? 'today' : '',
            isSameDay(d, selected) ? 'sel' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={ymd(d)} className={cls} onClick={() => onSelect(d)} onDoubleClick={() => onAdd(d)}>
              <span className="daynum">{format(d, 'd')}</span>
              {items.slice(0, 4).map((o) => (
                <div
                  key={o.key}
                  className={o.kind === 'deadline' ? 'chip deadline' : 'chip'}
                  style={{ borderLeftColor: o.colour }}
                  title={`${o.title} — ${o.subtitle}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(o);
                  }}
                >
                  <span className={o.done ? 'strike' : ''}>
                    {o.kind !== 'deadline' && !o.allDay ? `${format(o.start, 'HH:mm')} ` : ''}
                    {o.title}
                  </span>
                </div>
              ))}
              {items.length > 4 && <span className="more">+{items.length - 4} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  days,
  byDay,
  onOpen,
}: {
  days: Date[];
  byDay: Map<string, Occurrence[]>;
  onOpen: (o: Occurrence) => void;
}) {
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const today = new Date();
  const nowTop =
    (today.getHours() + today.getMinutes() / 60 - DAY_START) * HOUR_H;

  const topFor = (d: Date) => (d.getHours() + d.getMinutes() / 60 - DAY_START) * HOUR_H;

  return (
    <>
      <div className="week-dows">
        <div />
        {days.map((d) => (
          <div key={ymd(d)} className={isSameDay(d, today) ? 'week-dow today' : 'week-dow'}>
            {format(d, 'EEE d')}
          </div>
        ))}
      </div>
      <div className="week-body">
        <div className="week-grid">
          <div>
            {hours.map((h) => (
              <div className="hour-label" key={h}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map((d) => {
            const items = byDay.get(ymd(d)) ?? [];
            const timed = items.filter((o) => !o.allDay);
            return (
              <div className="day-col" key={ymd(d)}>
                {hours.map((h) => (
                  <div className="hour-line" key={h} />
                ))}
                {isSameDay(d, today) && nowTop > 0 && nowTop < hours.length * HOUR_H && (
                  <div className="now-line" style={{ top: nowTop }} />
                )}
                {timed.map((o) => {
                  const top = Math.max(0, topFor(o.start));
                  const mins = Math.max(30, (o.end.getTime() - o.start.getTime()) / 60000);
                  const height = o.kind === 'deadline' ? 24 : (mins / 60) * HOUR_H - 2;
                  return (
                    <div
                      key={o.key}
                      className="slot"
                      style={{
                        top,
                        height,
                        background: `${o.colour}22`,
                        borderLeftColor: o.colour,
                      }}
                      title={`${o.title}\n${o.subtitle}`}
                      onClick={() => onOpen(o)}
                    >
                      <div className={o.done ? 't strike' : 't'}>
                        {o.kind === 'deadline' ? '⚑ ' : ''}
                        {o.title}
                      </div>
                      <div className="s">{o.location || o.subtitle}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
