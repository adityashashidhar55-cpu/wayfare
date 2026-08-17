/**
 * Base URL for what are normally same-origin API calls.
 *
 * In the browser this returns '' so requests stay relative (/api/...). Inside
 * the Capacitor native shell the bundled frontend is served from the WebView's
 * local origin (https://localhost), so API calls must be absolute - the user
 * enters their deployment's server address on first launch and it is persisted
 * in localStorage under 'wayfare.server'.
 */
const SERVER_KEY = 'wayfare.server';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

/** True when running inside the Capacitor native shell. */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

/** Saved deployment origin (no trailing slash), or '' when unset. */
export function getServerUrl(): string {
  try {
    return (localStorage.getItem(SERVER_KEY) ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Persist the deployment origin (trailing slashes trimmed). */
export function setServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_KEY, url.replace(/\/+$/, ''));
  } catch {
    /* storage unavailable\u2014 the setup gate will simply re-appear */
  }
}

/** '' on the web; the saved deployment origin inside the native app. */
export function apiBase(): string {
  return isNativeApp() ? getServerUrl() : '';
}
