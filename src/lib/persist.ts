/**
 * Where a device keeps its own copy of the document.
 *
 * This is deliberately *not* the sync layer. Every device — desktop or phone —
 * holds a complete local copy it can read and edit with no network at all;
 * `sync.ts` then reconciles that copy with the server. On the desktop the copy
 * is the JSON file Rust writes atomically; in a browser it is local storage.
 */
import type { AppState } from './types';
import { isTauri } from './platform';

export interface LocalPersistence {
  /** Shown in Settings so you can find the file, or know there isn't one. */
  location(): Promise<string>;
  /** `null` when this device has never saved, so the caller can seed. */
  load(): Promise<unknown | null>;
  save(state: AppState): Promise<void>;
  /** Returns a description of where the copy went. */
  backup(stamp: string): Promise<string>;
}

class TauriPersistence implements LocalPersistence {
  private call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    // Imported lazily: in a browser this module is never loaded at all.
    return import('@tauri-apps/api/core').then(({ invoke }) => invoke<T>(cmd, args));
  }

  location() {
    return this.call<string>('data_location');
  }

  async load() {
    const raw = await this.call<unknown>('load_state');
    return raw ?? null;
  }

  async save(state: AppState) {
    await this.call<string>('save_state', { state });
  }

  backup(stamp: string) {
    return this.call<string>('backup_state', { stamp });
  }
}

const WEB_KEY = 'uni-schedule.doc';

class WebPersistence implements LocalPersistence {
  async location() {
    return 'Browser storage on this device';
  }

  async load() {
    const raw = localStorage.getItem(WEB_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // Better to start clean than to wedge the app on a corrupt entry, but
      // keep the bad copy around in case it can be rescued by hand.
      localStorage.setItem(`${WEB_KEY}.broken`, raw);
      return null;
    }
  }

  async save(state: AppState) {
    try {
      localStorage.setItem(WEB_KEY, JSON.stringify(state));
    } catch (e) {
      throw new Error(`browser storage is full or blocked: ${String(e)}`);
    }
  }

  /** No filesystem here, so a backup is a download. */
  async backup(stamp: string) {
    const raw = localStorage.getItem(WEB_KEY);
    if (!raw) throw new Error('nothing saved yet');
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `uni-schedule-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return `Downloaded uni-schedule-${stamp}.json`;
  }
}

export const persistence: LocalPersistence = isTauri()
  ? new TauriPersistence()
  : new WebPersistence();
