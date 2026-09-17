import type { ResolvedTheme, ThemePreference } from '@/domain/theme';
import { THEME_COLOR, resolveTheme } from '@/domain/theme';

/**
 * Painting the chosen theme.
 *
 * One attribute on `<html>` switches the whole palette — `styles/tokens.css`
 * redefines every colour under `[data-theme='light']` — so this module has
 * only two jobs: set that attribute, and keep the browser's own chrome in
 * step through `<meta name="theme-color">`, which is what colours the status
 * bar on a phone with the app installed.
 */

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * The system setting, or false where the browser will not say.
 *
 * Old WebKit has `matchMedia` but throws on a query it cannot parse, and the
 * service worker's first paint happens before anything else is set up, so a
 * refusal here has to mean "dark" rather than a crash on launch.
 */
export function systemPrefersLight(): boolean {
  try {
    return window.matchMedia(LIGHT_QUERY).matches;
  } catch {
    return false;
  }
}

/** Apply a preference to the document. Returns what it resolved to. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const theme = resolveTheme(preference, systemPrefersLight());

  /*
   * Dark is the absence of the attribute rather than `data-theme="dark"`, so
   * the markup the server sends and the styles it loads already agree before
   * any script runs. The alternative flashes.
   */
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);

  return theme;
}

/**
 * Call `onChange` when the device switches between light and dark.
 *
 * Only matters while the preference is `system`, but the listener is
 * registered once for the life of the app and the caller re-reads the
 * preference — a subscription that came and went with the setting would be
 * one more thing to get wrong.
 */
export function watchSystemTheme(onChange: () => void): void {
  try {
    window.matchMedia(LIGHT_QUERY).addEventListener('change', onChange);
  } catch {
    // A browser without `matchMedia`, or without the modern listener API. The
    // explicit Light and Dark settings still work; only following the system
    // live does not.
  }
}
