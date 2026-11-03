/**
 * The reconciliation primitives, checked without a browser or a server.
 *
 * These are the parts where a quiet mistake loses data rather than throwing:
 * a hash that is not stable across a JSON round trip makes every reconcile
 * look like a local edit and push forever, and a merge that forgets to keep
 * the device-local settings lets a phone repoint the desktop at nothing.
 *
 *   npm test
 */
import { emptyState, type AppState } from '../src/lib/types';
import {
  toDoc, fromDoc, hashDoc, looksUnused, normaliseUrl, summarise,
  whichIsNewer, resolutionFor, LOCAL_ONLY_SETTINGS,
} from '../src/lib/sync';

let failures = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const desktop: AppState = emptyState();
desktop.settings.server = { url: 'http://box:4173', token: 'sekret', enabled: true, conflictPolicy: 'prompt' };
desktop.settings.notesRoots = [{ id: 'r1', name: 'notes', path: '/home/lm/notes' }];
desktop.settings.deviceName = 'Desktop';
desktop.settings.horizonDays = 21;
desktop.modules = [{ id: 'm1', yearId: 'y1', code: 'CS101', title: 'Algorithms', credits: 20, colour: '#fff', lecturer: '', location: '', notes: [] }];

const doc = toDoc(desktop);
ok('device-local settings are stripped before sending',
  LOCAL_ONLY_SETTINGS.every((k) => !(k in (doc.settings as Record<string, unknown>))));
ok('shared settings still travel', (doc.settings as any).horizonDays === 21);
ok('records travel', doc.modules.length === 1);

// A phone adopting the desktop's document keeps its own server + name.
const phone: AppState = emptyState();
phone.settings.server = { url: 'http://box:4173', token: 'sekret', enabled: true, conflictPolicy: 'latest' };
phone.settings.deviceName = 'iPhone';
phone.settings.notesRoots = [];

const adopted = fromDoc(doc, phone);
ok('adopting keeps this device\'s name', adopted.settings.deviceName === 'iPhone');
ok('adopting keeps this device\'s conflict policy', adopted.settings.server.conflictPolicy === 'latest');
ok('adopting keeps this device\'s empty notes roots', adopted.settings.notesRoots.length === 0);
ok('adopting takes the shared settings', adopted.settings.horizonDays === 21);
ok('adopting takes the records', adopted.modules[0]?.code === 'CS101');

// The hash must be stable across a JSON round trip and key reordering, or every
// reconcile would look like a local edit and push forever.
const roundTripped = JSON.parse(JSON.stringify(doc));
ok('hash survives a JSON round trip', hashDoc(doc) === hashDoc(roundTripped));
const reordered = { settings: doc.settings, events: doc.events, assessments: doc.assessments,
                    sessions: doc.sessions, modules: doc.modules, terms: doc.terms,
                    years: doc.years, buildings: doc.buildings, version: doc.version } as typeof doc;
ok('hash ignores key order', hashDoc(doc) === hashDoc(reordered));
ok('hash changes with content', hashDoc(doc) !== hashDoc({ ...doc, modules: [] }));

// The key invariant behind adopt(): re-deriving the doc from the adopted state
// must reproduce the server's hash, or the client would push straight back.
ok('adopt then re-send is a no-op', hashDoc(toDoc(adopted)) === hashDoc(doc));

ok('a seeded document counts as unused', looksUnused(toDoc(emptyState())));
ok('a document with modules does not', !looksUnused(doc));

ok('bare host gets a scheme', normaliseUrl('192.168.1.20:4173') === 'http://192.168.1.20:4173');
ok('trailing slash is dropped', normaliseUrl('http://box:4173/') === 'http://box:4173');
ok('https is left alone', normaliseUrl('https://uni.example.com') === 'https://uni.example.com');
ok('empty stays empty', normaliseUrl('   ') === '');

ok('newer local wins', whichIsNewer('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z') === 'local');
ok('newer server wins', whichIsNewer('2026-01-03T00:00:00Z', '2026-01-02T00:00:00Z') === 'server');
ok('a tie goes to the server', whichIsNewer('2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z') === 'server');
ok('never-edited local loses', whichIsNewer('2026-01-02T00:00:00Z', null) === 'server');

const conflict = { server: { rev: 3, updatedAt: '2026-01-01T00:00:00Z', device: 'iPhone', doc },
                   local: doc, localAt: '2026-01-05T00:00:00Z', newer: 'local' as const };
ok('prompt policy asks', resolutionFor('prompt', conflict) === 'ask');
ok('latest policy takes the newer side', resolutionFor('latest', conflict) === 'local');
ok('local policy always keeps this device', resolutionFor('local', conflict) === 'local');
ok('server policy always takes the server', resolutionFor('server', conflict) === 'server');

const counts = summarise(doc);
ok('summary counts modules', counts.modules === 1 && counts.marked === 0);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
// Typed loosely so the check needs no @types/node just to set an exit code.
(globalThis as { process?: { exitCode?: number } }).process!.exitCode = failures ? 1 : 0;
