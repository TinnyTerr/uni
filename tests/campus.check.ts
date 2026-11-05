/** Building resolution, walking time, and the iCalendar round trip. */
import { emptyState, type AppState, type Building } from '../src/lib/types';
import { resolveBuilding, walkMinutes, transitionsOn, parseRoomCode, findRoom, passageBetween, boundsOf, roomPointsOf, setRoomPoints, centroidOf } from '../src/lib/campus';
import { buildIcs, parseIcs, mergeImported } from '../src/lib/ical';

let failures = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const mb: Building = { id: 'b1', code: 'MB', name: 'Maths Building', lat: 53.4668, lng: -2.2339 };
const rb: Building = { id: 'b2', code: 'Roscoe', name: 'Roscoe Building', lat: 53.4670, lng: -2.2330 };
const far: Building = { id: 'b3', code: 'FB', name: 'Far Building', lat: 53.4800, lng: -2.2500 };
const all = [mb, rb, far];

ok('code then room', resolveBuilding('MB 2.14', all)?.building.id === 'b1');
ok('room is what is left', resolveBuilding('MB 2.14', all)?.room === '2.14');
ok('case and punctuation', resolveBuilding('mb-2.14', all)?.room === '2.14');
ok('room before building', resolveBuilding('Room 3, Roscoe Building', all)?.building.id === 'b2');
ok('code must start a word', resolveBuilding('LAMB LAB', all) === null);
const lt: Building = { id: 'b5', code: 'LT', name: 'Lecture Theatres', lat: 53.4660, lng: -2.2320 };
ok('list of rooms resolves to the building', resolveBuilding('LT1201 & LT1221', [...all, lt])?.building.id === 'b5');
ok('list of rooms gives the first room', resolveBuilding('LT1201 & LT1221', [...all, lt])?.room === '1201');
ok('list of rooms with and', resolveBuilding('LT1201 and LT1221', [...all, lt])?.building.id === 'b5');
ok('no location, no match', resolveBuilding('', all) === null);
ok('walk is at least a minute', walkMinutes(mb, rb) >= 1);
ok('farther is longer', walkMinutes(mb, far) > walkMinutes(mb, rb));

// RC426: building RC, floor 4, room 26.
const rc: Building = {
  id: 'b4', code: 'RC', name: 'Royal College', lat: 55.8620, lng: -4.2447,
  floors: [{ id: 'f4', level: 4, w: 100, h: 100, connectors: [{ id: 'p1', kind: 'passage', label: 'to LB', x: 0, y: 0, linkTo: 'p2' }],
    rooms: [{ id: 'r', code: '26, 27', name: '', x: 0, y: 0, w: 10, h: 10 }] }],
};
const lb: Building = {
  id: 'b5', code: 'LB', name: 'Livingstone', lat: 55.8624, lng: -4.2447,
  floors: [{ id: 'f0', level: 0, w: 100, h: 100, rooms: [], connectors: [{ id: 'p2', kind: 'passage', label: 'to RC', x: 0, y: 0, linkTo: 'p1' }] }],
};
const camp = [rc, lb, mb];
ok('RC426 is floor 4 room 26', parseRoomCode('RC426', camp)?.ref.floor === 4 && parseRoomCode('RC426', camp)?.ref.room === '26');
ok('room codes are case blind', parseRoomCode('rc426', camp)?.building.id === 'b4');
ok('unknown prefix is not a room', parseRoomCode('XX426', camp) === null);
ok('resolves to the building', resolveBuilding('RC426', camp)?.building.id === 'b4');
ok('plan room is found', findRoom('RC426', camp)?.room.id === 'r');
ok('second number in a comma list is found', findRoom('RC427', camp)?.room.id === 'r');
ok('missing plan room is null', findRoom('RC428', camp) === null);
ok('passage joins the buildings', passageBetween(rc, lb) !== null && passageBetween(rc, mb) === null);
ok('default box surrounds the pin', (() => { const b = boundsOf(rc); return b[0] < rc.lat && b[2] > rc.lat && b[1] < rc.lng && b[3] > rc.lng; })());

// A Monday term with two back-to-back sessions in different buildings.
const s: AppState = emptyState();
s.buildings = all;
s.years = [{ id: 'y', name: 'Y', degreeWeight: 100 }];
s.terms = [{ id: 't', yearId: 'y', name: 'Autumn', start: '2026-09-21', end: '2026-12-11' }];
s.modules = [{ id: 'm', yearId: 'y', code: 'CS1', title: 'Algo', credits: 20, colour: '#fff', lecturer: '', location: '', notes: [] }];
s.sessions = [
  { id: 's1', moduleId: 'm', termId: 't', kind: 'Lecture', day: 1, start: '09:00', end: '10:00', location: 'MB 1.1', weeks: null },
  { id: 's2', moduleId: 'm', termId: 't', kind: 'Lab', day: 1, start: '10:05', end: '11:00', location: 'FB G.2', weeks: null },
];
const monday = new Date(2026, 9, 5);
const t = transitionsOn(s, monday);
ok('one transition found', t.length === 1);
ok('tight gap is flagged late', t[0]?.gap === 5 && t[0].shortBy > 0);

const ics = buildIcs(s, { now: new Date(2026, 9, 1) });
ok('ics is a calendar', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
ok('ics uses CRLF', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
ok('ics lines fold at 75 octets', ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
const back = parseIcs(ics);
ok('every session instance comes back', back.filter((e) => e.title.startsWith('CS1 Lecture')).length === 12);
ok('times survive', back.some((e) => e.start.getHours() === 10 && e.start.getMinutes() === 5 && e.location === 'FB G.2'));

const feed = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:abc',
  'DTSTART;TZID=Europe/London:20261005T090000',
  'DTEND;TZID=Europe/London:20261005T100000',
  'RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE',
  'EXDATE;TZID=Europe/London:20261007T090000',
  'SUMMARY:Seminar\\, group A',
  'LOCATION:Roscoe 1.',
  ' 2',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:day',
  'DTSTART;VALUE=DATE:20261101',
  'DTEND;VALUE=DATE:20261103',
  'SUMMARY:Reading week',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc',
  'DTSTART:20261201T120000Z',
  'DURATION:PT90M',
  'SUMMARY:Call',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const p = parseIcs(feed, { now: new Date(2026, 9, 1) });
const sem = p.filter((e) => e.uid.startsWith('abc#'));
ok('COUNT includes the excluded date', sem.length === 3);
ok('BYDAY emits Mon and Wed', sem.map((e) => e.start.getDay()).join() === '1,1,3');
ok('text unescaped and unfolded', sem[0].title === 'Seminar, group A' && sem[0].location === 'Roscoe 1.2');
const rd = p.find((e) => e.uid === 'day')!;
ok('all-day end is inclusive', rd.allDay && rd.end.getDate() === 2);
const call = p.find((e) => e.uid === 'utc')!;
ok('duration sets the end', call.end.getTime() - call.start.getTime() === 90 * 60_000);

let n = 0;
const first = mergeImported([], p, () => `id${n++}`, '#abc');
const again = mergeImported(first.events, p, () => `id${n++}`, '#abc');
ok('first import adds', first.added === p.length && first.updated === 0);
ok('second import updates in place', again.added === 0 && again.updated === p.length && again.events.length === first.events.length);

const box = { id: 'q', code: '1', name: '', x: 0, y: 0, w: 10, h: 20 };
ok('plain room is its four corners', roomPointsOf(box).length === 4);
setRoomPoints(box, [[0, 0], [30, 0], [30, 10], [10, 10], [10, 40], [0, 40]]);
ok('outline updates the box', box.x === 0 && box.y === 0 && box.w === 30 && box.h === 40);
ok('centroid of a square', centroidOf([[0, 0], [10, 0], [10, 10], [0, 10]]).join() === '5,5');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
(globalThis as { process?: { exitCode?: number } }).process!.exitCode = failures ? 1 : 0;
