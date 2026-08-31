/**
 * Local-git notes provider: each configured folder is a checkout of one of
 * your note repos. Indexing, searching and reading all happen in Rust; this
 * file is only the adapter that shapes them to `NotesProvider`.
 *
 * There is no Rust side in the browser, so on a phone this provider reports
 * itself as unconfigured and every call returns empty rather than throwing.
 * Links made on the desktop still render — they just cannot be opened there.
 */
import type { NotesRoot } from '../types';
import { isTauri } from '../platform';
import type { NoteBody, NoteHit, NoteRef, NotesProvider, SourceStatus } from './provider';

/** Loaded on demand: the Tauri modules are not importable in a plain browser. */
const invoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  import('@tauri-apps/api/core').then((m) => m.invoke<T>(cmd, args));

interface RawNote {
  id: string;
  title: string;
  path: string;
  rel_path: string;
  root_id: string;
  root_name: string;
  modified_ms: number;
  size_bytes: number;
}

interface RawHit extends RawNote {
  snippet: string;
  score: number;
}

interface GitInfo {
  is_repo: boolean;
  branch: string | null;
  remote: string | null;
  dirty_files: number;
  last_commit: string | null;
}

const shape = (n: RawNote): NoteRef => ({
  id: n.id,
  title: n.title,
  path: n.path,
  relPath: n.rel_path,
  rootId: n.root_id,
  rootName: n.root_name,
  modifiedMs: n.modified_ms,
});

export class LocalGitNotesProvider implements NotesProvider {
  readonly id = 'local-git';
  readonly label = 'Local note repos';
  readonly configurable = true;

  /** Roots are owned by app settings; the provider reads them on each call. */
  constructor(private getRoots: () => NotesRoot[]) {}

  isConfigured() {
    return isTauri() && this.getRoots().length > 0;
  }

  /** False on a phone, where there is no filesystem to index. */
  get available() {
    return isTauri();
  }

  async list(): Promise<NoteRef[]> {
    if (!this.isConfigured()) return [];
    const raw = await invoke<RawNote[]>('notes_index', { roots: this.getRoots() });
    return raw.map(shape);
  }

  async search(query: string, limit = 40): Promise<NoteHit[]> {
    if (!this.isConfigured() || !query.trim()) return [];
    const raw = await invoke<RawHit[]>('notes_search', {
      roots: this.getRoots(),
      query,
      limit,
    });
    return raw.map((h) => ({ ...shape(h), snippet: h.snippet, score: h.score }));
  }

  async read(link: { path: string }): Promise<NoteBody> {
    if (!isTauri()) {
      throw new Error('Notes are only readable on the desktop app, not in the browser.');
    }
    return invoke<NoteBody>('notes_read', { path: link.path, roots: this.getRoots() });
  }

  async openExternally(link: { path: string }) {
    if (!isTauri()) {
      throw new Error('Opening a note needs the desktop app.');
    }
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(link.path);
  }

  async status(): Promise<SourceStatus[]> {
    if (!isTauri()) {
      return [
        {
          id: 'no-fs',
          name: 'Not available here',
          detail: 'note folders live on the desktop; this device syncs the schedule only',
          ok: false,
          meta: {},
        },
      ];
    }
    const roots = this.getRoots();
    return Promise.all(
      roots.map(async (root) => {
        let info: GitInfo | null = null;
        try {
          info = await invoke<GitInfo>('notes_git_info', { path: root.path });
        } catch {
          /* falls through to the not-a-repo case below */
        }
        const meta: Record<string, string> = { Path: root.path };
        if (info?.is_repo) {
          meta.Branch = info.branch ?? 'unknown';
          meta.Remote = info.remote ?? 'none';
          meta.Uncommitted = info.dirty_files ? `${info.dirty_files} file(s)` : 'clean';
          if (info.last_commit) meta['Last commit'] = info.last_commit;
        }
        return {
          id: root.id,
          name: root.name,
          detail: info?.is_repo
            ? `git · ${info.branch ?? '?'}${info.dirty_files ? ` · ${info.dirty_files} uncommitted` : ' · clean'}`
            : 'plain folder (not a git repo)',
          ok: true,
          meta,
        };
      }),
    );
  }
}
