import {useSyncExternalStore} from 'react';
import useLocalStorageState from 'use-local-storage-state';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sqlfu-ui/theme';
const THEME_CYCLE: ThemePreference[] = ['system', 'dark', 'light'];

/**
 * Read the currently-persisted theme preference directly from localStorage,
 * WITHOUT going through React. Used at module load time to avoid a light-mode
 * flash on first paint before the app renders.
 */
function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'system';
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === 'light' || parsed === 'dark' || parsed === 'system') {
      return parsed;
    }
    return 'system';
  } catch {
    return 'system';
  }
}

function applyPreferenceToDom(preference: ThemePreference) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}

/**
 * Called once at module load so the DOM has the right data-theme before React
 * mounts. Without this you get a brief flash of light-mode on page load for
 * users who have chosen dark explicitly (or whose system prefers dark).
 */
export function initThemeOnLoad() {
  applyPreferenceToDom(readStoredPreference());
}

export function useThemePreference() {
  const [preference, setPreference] = useLocalStorageState<ThemePreference>(STORAGE_KEY, {
    defaultValue: 'system',
  });

  const setAndApply = (next: ThemePreference) => {
    setPreference(next);
    applyPreferenceToDom(next);
  };

  const cycle = () => {
    const currentIndex = THEME_CYCLE.indexOf(preference);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    setAndApply(THEME_CYCLE[nextIndex]);
  };

  return {preference, setPreference: setAndApply, cycle};
}

/**
 * Subscribe to the OS-level prefers-color-scheme media query. Returns
 * `'dark'` if the user's system prefers dark, else `'light'`.
 *
 * Uses `useSyncExternalStore` instead of useEffect/useState so that
 * components using the resolved theme re-render when the OS preference
 * changes (e.g. user flips system theme while the app is open).
 */
function useSystemTheme(): ResolvedTheme {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    () => 'light',
  );
}

/**
 * Resolve the effective theme ('light' | 'dark') for the current user, taking
 * into account their stored preference and — if the preference is 'system' —
 * the OS `prefers-color-scheme` media query.
 *
 * Use this for third-party components that need an explicit light/dark prop
 * (CodeMirror). Native CSS styling already keys off the same media query, so
 * site chrome updates automatically.
 */
export function useResolvedTheme(): ResolvedTheme {
  const {preference} = useThemePreference();
  const systemTheme = useSystemTheme();
  if (preference === 'light' || preference === 'dark') return preference;
  return systemTheme;
}
