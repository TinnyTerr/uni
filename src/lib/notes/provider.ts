/**
 * The only surface the UI is allowed to know about.
 *
 * v1 ships one implementation backed by local git checkouts. When the notes
 * move to a hosted service, write a second implementation of this interface,
 * register it below, and nothing in `views/` or `components/` changes.
 */
import type { NoteLink } from '../types';

export interface NoteRef {
  id: string;
  title: string;
  /** Opaque locator the provider understands; a filesystem path for local git. */
  path: string;
  /** Human-readable location within the source, e.g. "algorithms/heaps.md". */
  relPath: string;
  /** Which configured source this came from. */
  rootId: string;
  rootName: string;
  modifiedMs: number;
}

export interface NoteBody {
  path: string;
  content: string;
  truncated: boolean;
}

export interface NoteHit extends NoteRef {
  snippet: string;
  score: number;
}

export interface SourceStatus {
  id: string;
  name: string;
  detail: string;
  ok: boolean;
  /** Provider-specific extras, rendered as key/value rows in Settings. */
  meta: Record<string, string>;
}

export interface NotesProvider {
  readonly id: string;
  readonly label: string;
  /** False for providers with no user-configurable local folders. */
  readonly configurable: boolean;
  /** True when the provider has somewhere to read from. */
  isConfigured(): boolean;
  list(): Promise<NoteRef[]>;
  search(query: string, limit?: number): Promise<NoteHit[]>;
  read(link: Pick<NoteLink, 'path' | 'noteId'>): Promise<NoteBody>;
  /** Hand off to the OS / web app so the note can be edited properly. */
  openExternally(link: Pick<NoteLink, 'path' | 'noteId'>): Promise<void>;
  status(): Promise<SourceStatus[]>;
}

export function toLink(providerId: string, note: NoteRef): NoteLink {
  return { providerId, noteId: note.id, title: note.title, path: note.path };
}

const registry = new Map<string, NotesProvider>();

export function registerProvider(p: NotesProvider) {
  registry.set(p.id, p);
}

export function getProvider(id: string): NotesProvider | undefined {
  return registry.get(id);
}

export function allProviders(): NotesProvider[] {
  return [...registry.values()];
}

/** The provider a link belongs to, so stored links keep working across a migration. */
export function providerFor(link: NoteLink): NotesProvider | undefined {
  return registry.get(link.providerId);
}
