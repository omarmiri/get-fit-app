/**
 * Theme resolution.
 *
 * The app ships two palettes — the original cast iron and a paper-light one —
 * and three answers to which is used: `dark`, `light`, or `system`, which
 * follows whatever the phone is already set to. `system` is the default
 * because the device has usually been told the answer already, and a gym at
 * 6am and one at 6pm are not the same room.
 *
 * Kept free of the DOM so the rules can be tested directly; `ui/theme.ts`
 * applies the result.
 */

/** What the user chose. */
export const THEME_PREFERENCES = ['system', 'dark', 'light'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What actually gets painted. `system` resolves to one of these. */
export type ResolvedTheme = 'dark' | 'light';

export const DEFAULT_THEME: ThemePreference = 'system';

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

/**
 * Resolve a preference against the system setting.
 *
 * `systemPrefersLight` is false when the browser has no opinion, so a device
 * that reports nothing gets the dark palette the app was designed in.
 */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

/** The `<meta name="theme-color">` value for each palette: the page ground. */
export const THEME_COLOR: Readonly<Record<ResolvedTheme, string>> = {
  dark: '#14171a',
  light: '#eceae4',
};

/** Label shown on the settings control. */
export const THEME_LABEL: Readonly<Record<ThemePreference, string>> = {
  system: 'Auto',
  dark: 'Dark',
  light: 'Light',
};
