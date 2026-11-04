/** Persisted document version — bump when a migration is needed. */
export const STATE_VERSION = 3;

export type Id = string;

/** ISO weekday: 1 = Monday … 7 = Sunday (matches date-fns getISODay). */
export type IsoDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface NoteLink {
  providerId: string;
  noteId: string;
  title: string;
  /** Kept so a link still resolves if the index is stale. */
  path: string;
}

export interface Year {
  id: Id;
  name: string;
  /** Share of the final degree classification, in percent. 0 = not counted. */
  degreeWeight: number;
}

export interface Term {
  id: Id;
  yearId: Id;
  name: string;
  /** yyyy-MM-dd */
  start: string;
  end: string;
}

export interface Module {
  id: Id;
  yearId: Id;
  code: string;
  title: string;
  credits: number;
  colour: string;
  lecturer: string;
  location: string;
  notes: NoteLink[];
}

export type SessionKind =
  | 'Lecture'
  | 'Seminar'
  | 'Lab'
  | 'Tutorial'
  | 'Workshop'
  | 'Office hours'
  | 'Other';

export interface Session {
  id: Id;
  moduleId: Id;
  termId: Id;
  kind: SessionKind;
  day: IsoDay;
  /** HH:mm, 24h */
  start: string;
  end: string;
  location: string;
  /** 1-based term week numbers this runs in; null = every week of the term. */
  weeks: number[] | null;
}

export type AssessmentKind =
  | 'Coursework'
  | 'Exam'
  | 'Presentation'
  | 'Lab report'
  | 'Dissertation'
  | 'Other';

export type AssessmentStatus = 'todo' | 'doing' | 'submitted' | 'marked';

export interface Assessment {
  id: Id;
  moduleId: Id;
  title: string;
  kind: AssessmentKind;
  /** ISO datetime, local. */
  due: string;
  /** Percent of the module's final mark. */
  weight: number;
  status: AssessmentStatus;
  /** Percentage mark, or null if not marked yet. */
  mark: number | null;
  description: string;
  notes: NoteLink[];
}

export interface CalEvent {
  id: Id;
  title: string;
  /** ISO datetime, local. */
  start: string;
  end: string;
  allDay: boolean;
  colour: string;
  location: string;
  description: string;
  /** iCalendar UID when imported, so re-importing the feed updates in place. */
  uid?: string;
}

/** A room on a floor plan, in the plan's own units. `x/y/w/h` is always its bounding box. */
export interface Room {
  id: Id;
  /** The part of the code after building and floor: "26" in RC426. */
  code: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Outline as [x, y] corners, at least 3. Absent on older saves, which are plain boxes. */
  points?: [number, number][];
}

/**
 * A way out of the plan. An exit leads outside; a passage leads into another
 * building, and `linkTo` names the connector at the far end.
 */
export interface Connector {
  id: Id;
  kind: 'exit' | 'passage';
  label: string;
  x: number;
  y: number;
  linkTo?: Id;
}

/** One level of a building. `level` 0 is the ground floor. */
export interface Floor {
  id: Id;
  level: number;
  /** Optional scanned plan, as a data URL. Rooms are drawn over it. */
  image?: string;
  w: number;
  h: number;
  rooms: Room[];
  connectors: Connector[];
}

/**
 * A campus building: an outline on the map. Rooms are "<code><floor><room>", so
 * RC426 is room 26 on floor 4 of the building coded RC.
 */
export interface Building {
  id: Id;
  /** Short code as it appears in timetables, e.g. "RC" or "Roscoe". */
  code: string;
  name: string;
  /** Centre of the box; kept in step with `bounds` and used for walking time. */
  lat: number;
  lng: number;
  /** [south, west, north, east]. Older saves have none and get a default box. */
  bounds?: [number, number, number, number];
  /** Outline as [lat, lng] corners, at least 3. `bounds` is its bounding box. Absent on older saves. */
  points?: [number, number][];
  floors?: Floor[];
}

export interface NotesRoot {
  id: Id;
  name: string;
  path: string;
}

/**
 * What to do when this device and the server have both changed since they last
 * agreed. There is no field-level merge worth trusting for hand-edited records,
 * so every option here picks a whole document.
 */
export type ConflictPolicy =
  /** Ask, with the more recently edited copy offered as the default. */
  | 'prompt'
  /** Take whichever copy was edited most recently, without asking. */
  | 'latest'
  /** Always keep this device's copy and push it over the server's. */
  | 'local'
  /** Always take the server's copy and discard this device's changes. */
  | 'server';

export interface ServerConfig {
  /** Base URL of the sync server, e.g. http://192.168.1.20:4173. Empty = off. */
  url: string;
  /** Shared secret, when the server was started with UNI_TOKEN. */
  token: string;
  /** Whether to sync at all; lets you keep an address without using it. */
  enabled: boolean;
  conflictPolicy: ConflictPolicy;
}

export interface Settings {
  activeYearId: Id | null;
  notesRoots: NotesRoot[];
  /** Days ahead the dashboard counts as "coming up". */
  horizonDays: number;
  theme: 'dark' | 'light';
  /**
   * Which server is the source of truth for this device. Device-local: it is
   * stripped before the document is sent, so a phone cannot repoint a desktop.
   */
  server: ServerConfig;
  /** Shown to other devices when a conflict names who wrote what. */
  deviceName: string;
}

export interface AppState {
  version: number;
  years: Year[];
  terms: Term[];
  modules: Module[];
  sessions: Session[];
  assessments: Assessment[];
  events: CalEvent[];
  buildings: Building[];
  settings: Settings;
}

export const MODULE_COLOURS = [
  '#5b8def',
  '#e0736d',
  '#4fae86',
  '#c98a3e',
  '#9b73d6',
  '#3fa3b8',
  '#d1699f',
  '#7a8c4a',
] as const;

export function emptyState(): AppState {
  return {
    version: STATE_VERSION,
    years: [],
    terms: [],
    modules: [],
    sessions: [],
    assessments: [],
    events: [],
    buildings: [],
    settings: {
      activeYearId: null,
      notesRoots: [],
      horizonDays: 14,
      theme: 'dark',
      server: { url: '', token: '', enabled: false, conflictPolicy: 'prompt' },
      deviceName: '',
    },
  };
}
