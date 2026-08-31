import { useMemo, useState } from 'react';
import { useActiveYear, useStore } from '../lib/store';
import {
  CLASSIFICATIONS,
  classify,
  degreeAverage,
  fmtMark,
  marksNeeded,
  moduleResult,
  yearResult,
} from '../lib/grades';
import { Dot, Empty } from '../components/ui';

const TARGETS = [70, 60, 50];

export default function Marks() {
  const { state } = useStore();
  const { year, modules, assessments } = useActiveYear();
  const [target, setTarget] = useState(70);

  const byModule = useMemo(
    () => new Map(modules.map((m) => [m.id, moduleResult(assessments.filter((a) => a.moduleId === m.id))])),
    [modules, assessments],
  );
  const current = useMemo(() => yearResult(modules, (id) => byModule.get(id)!), [modules, byModule]);

  // Degree-level view needs every year, not just the active one.
  const perYear = useMemo(() => {
    return state.years.map((y) => {
      const mods = state.modules.filter((m) => m.yearId === y.id);
      const res = new Map(
        mods.map((m) => [m.id, moduleResult(state.assessments.filter((a) => a.moduleId === m.id))]),
      );
      return { year: y, result: yearResult(mods, (id) => res.get(id)!), moduleCount: mods.length };
    });
  }, [state]);

  const degree = useMemo(
    () =>
      degreeAverage(state.years, (id) => perYear.find((p) => p.year.id === id)?.result.average ?? null),
    [state.years, perYear],
  );

  if (!year) return <Empty title="No academic year">Create one in Settings first.</Empty>;

  return (
    <>
      <div className="grid three">
        <div className="card">
          <div className="tiny dim" style={{ marginBottom: 6 }}>
            {year.name} average
          </div>
          <div className="bigstat">
            <span className="v">{fmtMark(current.average)}</span>
            {current.classification && (
              <span className="pill solid" style={{ background: current.classification.colour }}>
                {current.classification.short}
              </span>
            )}
          </div>
          <div className="tiny dim" style={{ marginTop: 8 }}>
            {current.creditsCounted} / {current.creditsTotal} credits marked
          </div>
        </div>

        <div className="card">
          <div className="tiny dim" style={{ marginBottom: 6 }}>
            Degree average (weighted)
          </div>
          <div className="bigstat">
            <span className="v">{fmtMark(degree.average)}</span>
            {degree.classification && (
              <span className="pill solid" style={{ background: degree.classification.colour }}>
                {degree.classification.short}
              </span>
            )}
          </div>
          <div className="tiny dim" style={{ marginTop: 8 }}>
            Using {degree.weightUsed}% of the declared year weightings
          </div>
        </div>

        <div className="card">
          <div className="tiny dim" style={{ marginBottom: 6 }}>
            Classification bands
          </div>
          <div className="legend" style={{ flexDirection: 'column', gap: 5 }}>
            {CLASSIFICATIONS.map((c) => (
              <div key={c.short} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                <Dot colour={c.colour} />
                <span style={{ flex: 1 }}>{c.label}</span>
                <span className="mono">{c.min}%+</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Modules — {year.name}</h2>
          <div className="spacer" />
          <span className="tiny dim">Needed for</span>
          <div className="seg">
            {TARGETS.map((t) => (
              <button key={t} className={target === t ? 'on' : ''} onClick={() => setTarget(t)}>
                {t}%
              </button>
            ))}
          </div>
        </div>
        {modules.length === 0 ? (
          <Empty title="No modules yet">Add modules and assessments to see marks here.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Module</th>
                <th className="right">Credits</th>
                <th className="right">Marked</th>
                <th className="right">Provisional</th>
                <th className="right" title="Assuming everything unmarked scores zero">
                  Secured
                </th>
                <th className="right">Need for {target}%</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => {
                const r = byModule.get(m.id)!;
                const cls = classify(r.provisional);
                const need = marksNeeded(r, target);
                return (
                  <tr key={m.id}>
                    <td>
                      <Dot colour={m.colour} />
                    </td>
                    <td>
                      <b className="mono">{m.code}</b> <span className="muted">{m.title}</span>
                      <div className="bar" style={{ marginTop: 5, maxWidth: 200 }}>
                        <i style={{ width: `${Math.min(100, r.marked)}%`, background: m.colour }} />
                      </div>
                    </td>
                    <td className="right">{m.credits}</td>
                    <td className="right tiny muted">
                      {r.marked}% of {r.declared}%
                    </td>
                    <td className="right mono">{fmtMark(r.provisional)}</td>
                    <td className="right mono muted">{fmtMark(r.secured)}</td>
                    <td className="right mono">
                      {need === null ? (
                        <span className="dim">done</span>
                      ) : need > 100 ? (
                        <span style={{ color: 'var(--danger)' }}>not reachable</span>
                      ) : need <= 0 ? (
                        <span style={{ color: 'var(--ok)' }}>secured</span>
                      ) : (
                        `${need.toFixed(1)}%`
                      )}
                    </td>
                    <td>{cls && <span className="pill" style={{ color: cls.colour }}>{cls.short}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="tiny dim" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Provisional</b> is the weighted mean of the marks entered so far. <b>Secured</b> assumes everything still
          unmarked scores zero. <b>Need</b> is the average required across the remaining weight to finish the module on{' '}
          {target}%.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Across the degree</h2>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Year</th>
              <th className="right">Modules</th>
              <th className="right">Credits marked</th>
              <th className="right">Average</th>
              <th className="right">Weight toward degree</th>
              <th>Band</th>
            </tr>
          </thead>
          <tbody>
            {perYear.map(({ year: y, result, moduleCount }) => (
              <tr key={y.id}>
                <td>
                  <b>{y.name}</b>
                  {y.id === year.id && <span className="pill" style={{ marginLeft: 8 }}>active</span>}
                </td>
                <td className="right">{moduleCount}</td>
                <td className="right tiny muted">
                  {result.creditsCounted} / {result.creditsTotal}
                </td>
                <td className="right mono">{fmtMark(result.average)}</td>
                <td className="right">{y.degreeWeight}%</td>
                <td>
                  {result.classification && (
                    <span className="pill" style={{ color: result.classification.colour }}>
                      {result.classification.short}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny dim" style={{ marginTop: 10, marginBottom: 0 }}>
          Year weightings are set in Settings — check your programme handbook, since institutions differ (a common
          pattern is 0 / 25 / 75 or 0 / 40 / 60).
        </p>
      </div>
    </>
  );
}
