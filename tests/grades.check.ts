import type { Assessment } from '../src/lib/types';
import { marksNeeded, moduleResult } from '../src/lib/grades';

let failures = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const assessment = (weight: number, mark: number | null): Assessment => ({
  id: `a-${weight}`,
  moduleId: 'm1',
  title: 'Assessment',
  kind: 'Exam',
  due: '',
  weight,
  status: mark === null ? 'todo' : 'marked',
  mark,
  description: '',
  notes: [],
});

const underDeclared = moduleResult([assessment(50, 80)]);
ok('secured assumes the rest of the 100% module weight is zero', underDeclared.secured === 40);
ok('needed mark includes undeclared weight up to 100%', marksNeeded(underDeclared, 70) === 60);

const overDeclared = moduleResult([assessment(120, 80)]);
ok('secured uses declared weight when it exceeds 100%', overDeclared.secured === 80);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
(globalThis as { process?: { exitCode?: number } }).process!.exitCode = failures ? 1 : 0;
