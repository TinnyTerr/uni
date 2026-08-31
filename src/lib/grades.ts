import type { Assessment, Module, Year } from './types';

/** UK undergraduate honours bands. */
export interface Classification {
  label: string;
  short: string;
  min: number;
  colour: string;
}

export const CLASSIFICATIONS: Classification[] = [
  { label: 'First', short: '1st', min: 70, colour: '#4fae86' },
  { label: 'Upper second', short: '2:1', min: 60, colour: '#5b8def' },
  { label: 'Lower second', short: '2:2', min: 50, colour: '#c98a3e' },
  { label: 'Third', short: '3rd', min: 40, colour: '#d1699f' },
  { label: 'Fail', short: 'Fail', min: 0, colour: '#e0736d' },
];

export function classify(mark: number | null): Classification | null {
  if (mark === null || Number.isNaN(mark)) return null;
  return CLASSIFICATIONS.find((c) => mark >= c.min) ?? CLASSIFICATIONS[CLASSIFICATIONS.length - 1];
}

export interface ModuleResult {
  /** Weighted mean of the marks entered so far, over their own weight. */
  provisional: number | null;
  /** Mark assuming everything still unmarked scores zero. */
  secured: number | null;
  /** Percent of the module's assessment weight that has been marked. */
  marked: number;
  /** Total weight declared across all assessments; should be 100. */
  declared: number;
  count: number;
}

export function moduleResult(assessments: Assessment[]): ModuleResult {
  const declared = assessments.reduce((s, a) => s + (a.weight || 0), 0);
  const done = assessments.filter((a) => a.mark !== null && a.weight > 0);
  const marked = done.reduce((s, a) => s + a.weight, 0);
  if (!done.length || marked === 0) {
    return { provisional: null, secured: null, marked: 0, declared, count: assessments.length };
  }
  const points = done.reduce((s, a) => s + a.weight * (a.mark as number), 0);
  return {
    provisional: points / marked,
    secured: declared > 0 ? points / declared : null,
    marked,
    declared,
    count: assessments.length,
  };
}

export interface YearResult {
  average: number | null;
  creditsCounted: number;
  creditsTotal: number;
  classification: Classification | null;
}

/** Credit-weighted mean of module marks — the usual UK year average. */
export function yearResult(
  modules: Module[],
  resultFor: (moduleId: string) => ModuleResult,
): YearResult {
  const creditsTotal = modules.reduce((s, m) => s + (m.credits || 0), 0);
  let points = 0;
  let credits = 0;
  for (const m of modules) {
    const r = resultFor(m.id);
    if (r.provisional === null || !m.credits) continue;
    points += m.credits * r.provisional;
    credits += m.credits;
  }
  const average = credits > 0 ? points / credits : null;
  return {
    average,
    creditsCounted: credits,
    creditsTotal,
    classification: classify(average),
  };
}

/** Weighted across years using each year's declared degree weighting. */
export function degreeAverage(
  years: Year[],
  averageFor: (yearId: string) => number | null,
): { average: number | null; classification: Classification | null; weightUsed: number } {
  let points = 0;
  let weight = 0;
  for (const y of years) {
    const avg = averageFor(y.id);
    if (avg === null || !y.degreeWeight) continue;
    points += y.degreeWeight * avg;
    weight += y.degreeWeight;
  }
  const average = weight > 0 ? points / weight : null;
  return { average, classification: classify(average), weightUsed: weight };
}

/** What you must average on the remaining weight to reach `target`. */
export function marksNeeded(result: ModuleResult, target: number): number | null {
  const remaining = result.declared - result.marked;
  if (remaining <= 0.001) return null;
  const have = result.provisional === null ? 0 : result.provisional * result.marked;
  return (target * result.declared - have) / remaining;
}

export const fmtMark = (m: number | null, dp = 1) =>
  m === null || Number.isNaN(m) ? '—' : `${m.toFixed(dp)}%`;
