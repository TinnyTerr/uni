/**
 * The same bundle runs in two places now: the Tauri desktop window, and a
 * browser on a phone. Anything that reaches the filesystem, the OS opener or
 * the native dialogs only exists in the first, so every such call site asks
 * here first rather than throwing an obscure "command not found" from IPC.
 */

/** Tauri v2 injects this on the window before any app code runs. */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Where the app is running, for the odd bit of copy that needs to say so. */
export const platformLabel = (): string => (isTauri() ? 'Desktop' : 'Browser');

/**
 * A stable per-install identifier, so a conflict can say *which* device wrote
 * the other copy instead of "someone, somewhere".
 */
const DEVICE_KEY = 'uni-schedule.device-id';

export function deviceId(): string {
  try {
    const found = localStorage.getItem(DEVICE_KEY);
    if (found) return found;
    const made = `${isTauri() ? 'desktop' : 'web'}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // Private browsing with storage blocked: a per-session id still beats none.
    return `ephemeral-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * When the phone loaded this app *from* the server (rather than a home-screen
 * PWA opened separately), the browser's own address bar already has it — no
 * point making the user retype what they just typed to get here.
 */
export function currentOrigin(): string | null {
  if (isTauri()) return null;
  if (typeof location === 'undefined') return null;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  return location.origin;
}

/** A first guess at a human name for this device, editable in Settings. */
export function guessDeviceName(): string {
  if (isTauri()) return 'Desktop';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Browser';
}
