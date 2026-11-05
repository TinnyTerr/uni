# Uni Schedule

An app for UK university life: weekly timetable, calendar, coursework deadlines
and module marks — with links into your own markdown notes.

React + TypeScript in the front, Tauri v2 (Rust) behind it on the desktop. The
same front end also runs as an installable PWA, so the timetable is on your
phone; a small server you run yourself holds the copy both devices agree on.
Nothing goes anywhere you did not put it.

## Running it

```bash
bun install
bun run app        # dev window with hot reload
bun run dist       # build installers into src-tauri/target/release/bundle/
bun run pwa        # build the web app and serve it to your phone
bun run test       # the sync reconciliation checks
bun run typecheck
```

`bun run dist` builds whatever the machine you are on can build — `.deb` and
`.AppImage` on Linux, an NSIS `.exe` and an `.msi` on Windows. Tauri ignores the
targets that do not apply, so the same config covers both.

System packages needed once, on Ubuntu/Debian:

```bash
sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev
```

Installing the build:

```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb     # or
chmod +x src-tauri/target/release/bundle/appimage/*.AppImage
```

## On your phone

`bun run pwa` builds the front end and starts the sync server on port 4173. It
prints the addresses it can be reached on:

```
  reachable at
    http://localhost:4173
    http://192.168.1.20:4173   <- use this on your phone
```

Open that address on your phone, then add it to the home screen — “Install app”
in Chrome, Share → “Add to Home Screen” in Safari. It opens full screen, works
offline, and syncs when it can reach the server.

Run the server on whatever machine stays on. It only ever serves the built app
and the state document, so a Pi is plenty:

```bash
bun run build
UNI_TOKEN=$(openssl rand -hex 16) PORT=4173 bun run serve
```

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4173` | Listen port |
| `UNI_DATA` | `server/data` | Where `state.json` and `history/` live |
| `UNI_TOKEN` | *(unset)* | Shared secret; unset means anyone on the network can read and write |
| `UNI_HISTORY` | `30` | Past revisions kept, as a crude undo |

Set `UNI_TOKEN` if the machine is reachable by anything you do not control, and
put the same value in **Settings → Sync server → Access token** on each device.

## Which copy wins

Every device keeps a complete local copy and works with no network at all. The
server is what they reconcile against when they can reach it.

The server stores the document, a revision number, and who wrote it last. A
device may only write by naming the revision it started from — anything else
comes back as a conflict rather than quietly overwriting. That is the whole
protocol; there is no field-level merge, because a schedule is hand-edited
records with no honest automatic answer to “you both changed this deadline”.

When both sides have changed since they last agreed, **Settings → Sync server →
When both copies have changed** decides what happens:

- **Ask me (default: latest wins)** — the default. Shows both copies side by
  side with what is in each, the more recent one already selected. Enter takes
  the latest; the other is one click away. Ticking “always do this” writes your
  choice back as the rule.
- **Latest wins, silently** — never interrupts.
- **This device always wins** / **The server always wins** — for a device you
  want to treat as the author of record, or as a read-only mirror.

Nothing is thrown away in the moment either way: the server keeps the previous
revisions under `server/data/history/`.

Settings that describe a *device* rather than the schedule — the server address
and token, the note folders, the device name — never travel, so a phone cannot
repoint your desktop or push filesystem paths at it.

## Updates

The desktop app checks the repository's releases and installs signed updates
in place: **Settings → Updates**. Builds are verified against a public key
compiled into the app, so an update can only come from a build signed with your
private key. Linux updates arrive as the AppImage, Windows as the NSIS
installer running in passive mode.

Cutting a release:

```bash
bun run release 0.2.0            # one version into package.json, Cargo.toml, tauri.conf.json
git commit -am "release 0.2.0"
git tag v0.2.0 && git push --follow-tags
```

The tag triggers `.gitea/workflows/release.yml`, in three stages:

1. **prepare** — checks the tag agrees with all three manifests, then opens the
   release. Doing this once, up front, is what stops the two build jobs racing
   each other to create it.
2. **build** — a matrix over `ubuntu-latest` and `windows-latest`. Each builds
   and signs its own bundles and attaches them, signatures included, to that
   release. `fail-fast` is off, so one platform failing does not deny the other
   its release.
3. **manifest** — collects every signature back off the release, composes the
   `latest.json` that covers both platforms, and repoints the floating `latest`
   release that installed copies check against. It runs even if one build
   failed, so a working platform still ships.

The Windows job needs a Windows runner registered with your Gitea instance. If
there isn't one it will sit queued rather than fail — the Linux build and the
manifest still complete, and the manifest simply won't carry a Windows entry.

It needs three secrets on the repository:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/uni-schedule.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password (empty if you set none) |
| `RELEASE_TOKEN` | a Gitea token with write access to the repo |

The private key is not in this repository and must not be — `.gitignore` refuses
`*.key`. Losing it means existing installs can no longer verify updates and have
to be reinstalled by hand, so keep a copy somewhere safe. A new keypair comes
from `bunx tauri signer generate -w ~/.tauri/uni-schedule.key`; its public half
goes into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

## What's in it

- **Today** — the day's sessions, what's next, deadlines inside your horizon,
  overdue work, and where each module currently stands.
- **Calendar** — week and month views over timetable sessions, deadlines and
  one-off events. Shows which teaching week of which term you're looking at.
- **Timetable** — the weekly grid. Sessions repeat across a term and can be
  restricted to particular teaching weeks (`1-5, 7, 9-11`).
- **Campus map** — click out the outline of each building on an OpenStreetMap
  map; select one to resize or move it by its handles. A session's location is
  matched to a building by its code or name ("MB 2.14"), or by the compact room
  code: two-letter building, floor, room, so `RC426` is the Royal College, floor
  4, room 26. The next class is highlighted with a directions link, and Today and
  the map warn when the walk (edge to edge between outlines, by bounding box) between back-to-back
  sessions is longer than the gap. Tiles you have viewed are cached for offline
  use on the phone install.
- **Floor plans** — per building, add floors and draw rooms by clicking their corners, then close on the first corner (drag corners to reshape, add or right-click remove them)
  (optionally over an uploaded plan image, which you can drag into line with the rooms), plus exits and passages. A passage
  is linked to its other end in another building, which makes the walk between
  the two indoors and straight-line. "Find room" on the next class opens the
  floor with the room lit. All of it syncs with the rest of the document.
- **Modules** — code, title, credits, colour, lecturer, linked notes.
- **Assessments** — deadlines with kind, weight, status and mark.
- **Marks** — UK marking throughout. Per module: *provisional* (weighted mean
  of marks so far), *secured* (assuming everything unmarked scores zero), and
  what you'd need across the remaining weight to land on 70 / 60 / 50. Year
  averages are credit-weighted; the degree average uses the weighting you set
  per year. Bands are 1st / 2:1 / 2:2 / 3rd.
- **Notes** — search across every configured note repo, preview inline, open in
  your editor, and see which modules and assessments link to each note.

- **Menu bar (macOS)** — the current or next session sits in the menu bar; the
  dropdown lists today's timetable. Updates every minute.

`Alt+1` … `Alt+9` jump between sections. On a phone the sidebar is a drawer
behind the ☰ button.

Note folders are read from the filesystem, so they are desktop-only; the phone
syncs the schedule, deadlines and marks, and says so where notes would be.

## Calendar files (iCal)

**Settings → Calendar files** exports the timetable (every term), deadlines and
events as `.ics`, and imports one. Imported events keep their UID, so importing
a university feed again updates in place instead of duplicating. Recurrence is
the common subset: DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL,
BYDAY and EXDATE, expanded about a year ahead; TZID and UTC times are converted
to local time.

The sync server also serves a live feed at `/api/calendar.ics` (add
`?token=…` when `UNI_TOKEN` is set) that Google, Apple and Outlook can subscribe
to. It runs the app's own TypeScript, so it needs Bun and the source tree next
to `server/`. The URL carries the token, so treat it as a secret.

## Notes: the provider layer

Your notes are separate git repos today and may become a hosted service later,
so the app never talks to the filesystem directly from the UI. Everything goes
through one interface, `src/lib/notes/provider.ts`:

```ts
interface NotesProvider {
  id: string;
  isConfigured(): boolean;
  list(): Promise<NoteRef[]>;
  search(query: string, limit?: number): Promise<NoteHit[]>;
  read(link): Promise<NoteBody>;
  openExternally(link): Promise<void>;
  status(): Promise<SourceStatus[]>;
}
```

v1 ships `LocalGitNotesProvider` (`src/lib/notes/localGit.ts`), which points at
folders you choose in Settings, indexes their markdown in Rust, and reports each
folder's git branch / remote / uncommitted-file count.

**When the hosted service arrives:**

1. Write `src/lib/notes/hosted.ts` implementing the same interface.
2. Register it in `useNotesProviders()` in `src/lib/store.tsx` — the one place
   providers are constructed.
3. Nothing in `views/` or `components/` changes.

Every stored link records the `providerId` that created it, so links made
against local repos keep resolving after you add a second provider, and a link
whose provider is gone reports that clearly instead of failing silently.

## Data

One JSON document. On the desktop it is the file shown in **Settings →
Preferences & data** (`~/.local/share/com.davmcdonald.unischedule/data.json` on
Linux); in the browser it is local storage. Writes are debounced, and on disk
they are atomic — temp file then rename — so a crash can't truncate a good save.
"Back up now" drops a timestamped copy in `backups/`, or downloads one in the
browser.

The server keeps its own copy the same way, at `server/data/state.json`, with
the last `UNI_HISTORY` revisions beside it.

Note reading is confined to the folders you configured: the Rust side
canonicalises the path and refuses anything outside them.

## Layout

```
src/
  lib/
    types.ts          persisted shapes + STATE_VERSION
    store.tsx         React context, load/save, migrations, the sync loop
    sync.ts           revision protocol, conflict shapes, what travels
    persist.ts        this device's own copy: Tauri file, or browser storage
    platform.ts       desktop or browser, and this device's identity
    dates.ts          term weeks, ISO weekdays, grids
    campus.ts         buildings, room codes, walking time, passages
    grades.ts         UK marking: module/year/degree averages, classifications
    occurrences.ts    expands sessions + deadlines + events into calendar items
    notes/            provider interface and the local-git implementation
  views/              one file per section, plus SyncSettings and UpdateSettings
  components/         modal, fields, note linking, the conflict prompt
src-tauri/src/
  store.rs            atomic JSON persistence + backups
  notes.rs            markdown indexing, search, sandboxed reads, git status
server/
  index.mjs           serves the PWA and holds the authoritative document
scripts/
  bump-version.mjs      one version into all three manifests
  collect-artifacts.mjs flattens a platform's bundles into one directory
  latest-json.mjs       updater manifest from the signed build artefacts
  publish-release.mjs   opens the release, attaches files, collects signatures
tests/
  sync.check.ts       the reconciliation primitives, no browser needed
```
