import { useMemo, useState } from 'react';
import { differenceInCalendarDays, format, isSameDay } from 'date-fns';
import { useActiveYear, useStore } from '../lib/store';
import { occurrencesOn, upcomingDeadlines } from '../lib/occurrences';
import { moduleResult, yearResult, fmtMark, classify } from '../lib/grades';
import { parse, relativeDay, termContaining } from '../lib/dates';
import { Dot, Empty } from '../components/ui';
import { NoteLinkChips, NoteViewer } from '../components/NoteLinks';
import type { NoteLink } from '../lib/types';
import { transitionsOn } from '../lib/campus';

export default function Dashboard({ go }: { go: (view: string) => void }) {
  const { state } = useStore();
  const { year, terms, modules, assessments } = useActiveYear();
  const [viewing, setViewing] = useState<NoteLink | null>(null);
  const now = new Date();

  const today = useMemo(() => occurrencesOn(state, now), [state]);
  const tomorrow = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return occurrencesOn(state, d);
  }, [state]);

  const walks = useMemo(() => transitionsOn(state, now).filter((t) => t.to.end >= now), [state]);

  const deadlines = useMemo(
    () => upcomingDeadlines(state, state.settings.horizonDays, now),
    [state],
  );
  const overdue = useMemo(
    () =>
      state.assessments
        .filter((a) => a.status !== 'submitted' && a.status !== 'marked' && parse(a.due) < now)
        .sort((a, b) => parse(a.due).getTime() - parse(b.due).getTime()),
    [state],
  );

  const results = useMemo(() => {
    const byModule = new Map(
      modules.map((m) => [m.id, moduleResult(assessments.filter((a) => a.moduleId === m.id))]),
    );
    return {
      byModule,
      year: yearResult(modules, (id) => byModule.get(id)!),
    };
  }, [modules, assessments]);

  const term = termContaining(terms, now);
  const nextUp = today.find((o) => o.end >= now) ?? tomorrow[0];

  return (
    <div className="grid two">
      <div>
        <div className="card">
          <div className="card-head">
            <h2>Today</h2>
            <div className="spacer" />
            <span className="tiny dim">{format(now, 'EEEE d MMMM')}</span>
          </div>
          {today.length === 0 ? (
            <p className="muted tiny">Nothing scheduled. {term ? `${term.name} term.` : 'Outside term dates.'}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {today.map((o) => (
                <div
                  key={o.key}
                  style={{ display: 'flex', gap: 10, alignItems: 'baseline', opacity: o.end < now ? 0.5 : 1 }}
                >
                  <span className="mono nowrap" style={{ width: 44, color: 'var(--muted)' }}>
                    {o.kind === 'deadline' ? format(o.start, 'HH:mm') : format(o.start, 'HH:mm')}
                  </span>
                  <Dot colour={o.colour} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className={o.done ? 'strike' : ''}>{o.title}</div>
                    <div className="tiny dim">
                      {o.subtitle}
                      {o.location ? ` · ${o.location}` : ''}
                    </div>
                  </div>
                  {o.kind === 'deadline' && <span className="pill">deadline</span>}
                </div>
              ))}
            </div>
          )}
          {walks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {walks.map((t) => (
                <div key={t.to.key} className="tiny" style={{ padding: '2px 0' }}>
                  <span className="dim">
                    {format(t.to.start, 'HH:mm')} {t.fromBuilding.code || t.fromBuilding.name} →{' '}
                    {t.toBuilding.code || t.toBuilding.name}:
                  </span>{' '}
                  {t.walk} min walk, {t.gap} min gap
                  {t.shortBy > 0 && (
                    <b style={{ color: 'var(--danger)' }}> · you'll be about {t.shortBy} min late</b>
                  )}
                </div>
              ))}
            </div>
          )}
          {nextUp && (
            <p className="tiny dim" style={{ marginTop: 12, marginBottom: 0 }}>
              Next: <b className="muted">{nextUp.title}</b> at {format(nextUp.start, 'HH:mm')}
              {isSameDay(nextUp.start, now) ? '' : ' tomorrow'}
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Deadlines</h2>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={() => go('assessments')}>
              All →
            </button>
          </div>
          {overdue.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="tiny overdue" style={{ marginBottom: 6 }}>
                {overdue.length} overdue
              </div>
              {overdue.slice(0, 4).map((a) => {
                const mod = state.modules.find((m) => m.id === a.moduleId);
                return (
                  <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0' }}>
                    <Dot colour={mod?.colour ?? '#888'} />
                    <span style={{ flex: 1 }}>{a.title}</span>
                    <span className="tiny overdue">{relativeDay(parse(a.due), now)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {deadlines.length === 0 && overdue.length === 0 ? (
            <p className="muted tiny">Nothing due in the next {state.settings.horizonDays} days.</p>
          ) : (
            deadlines.map(({ assessment: a, due }) => {
              const mod = state.modules.find((m) => m.id === a.moduleId);
              const days = differenceInCalendarDays(due, now);
              return (
                <div key={a.id} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '5px 0' }}>
                  <Dot colour={mod?.colour ?? '#888'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{a.title}</div>
                    <div className="tiny dim">
                      {mod?.code} · {a.weight}% · {a.kind}
                    </div>
                  </div>
                  <div className="right nowrap">
                    <div className="tiny" style={{ color: days <= 2 ? 'var(--danger)' : 'var(--muted)' }}>
                      {relativeDay(due, now)}
                    </div>
                    <div className="tiny dim">{format(due, 'EEE d MMM, HH:mm')}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div>
        <div className="card">
          <div className="card-head">
            <h2>{year?.name ?? 'No year'} so far</h2>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={() => go('marks')}>
              Marks →
            </button>
          </div>
          <div className="bigstat">
            <span className="v">{fmtMark(results.year.average)}</span>
            {results.year.classification && (
              <span className="pill solid" style={{ background: results.year.classification.colour }}>
                {results.year.classification.short}
              </span>
            )}
          </div>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Credit-weighted across {results.year.creditsCounted} of {results.year.creditsTotal} credits with marks
            recorded.
          </p>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Modules</h2>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={() => go('modules')}>
              Manage →
            </button>
          </div>
          {modules.length === 0 ? (
            <Empty title="No modules yet">
              Add your modules to build the timetable, deadlines and marks views.
            </Empty>
          ) : (
            modules.map((m) => {
              const r = results.byModule.get(m.id)!;
              const cls = classify(r.provisional);
              return (
                <div key={m.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                    <Dot colour={m.colour} />
                    <b className="mono">{m.code}</b>
                    <span className="muted" style={{ flex: 1, minWidth: 0 }}>
                      {m.title}
                    </span>
                    <span className="tiny dim">{m.credits} cr</span>
                    <span style={{ width: 56 }} className="right mono">
                      {fmtMark(r.provisional, 0)}
                    </span>
                    {cls && <span className="pill" style={{ color: cls.colour }}>{cls.short}</span>}
                  </div>
                  <div className="bar" style={{ marginTop: 6 }}>
                    <i style={{ width: `${Math.min(100, r.marked)}%`, background: m.colour }} />
                  </div>
                  {m.notes.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <NoteLinkChips links={m.notes} onOpen={setViewing} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      {viewing && <NoteViewer link={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
