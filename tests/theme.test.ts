import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, isThemePreference, resolveTheme } from '@/domain/theme';
import { parseState } from '@/state/schema';

describe('resolveTheme', () => {
  it('follows the device when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  it('ignores the device when the user has chosen', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

describe('isThemePreference', () => {
  it('accepts the three settings and nothing else', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe('parseState — theme', () => {
  it('keeps a stored choice', () => {
    const { state } = parseState({ sessions: [], prefs: { theme: 'light' } });
    expect(state.prefs.theme).toBe('light');
  });

  /* State written before schema 14 has no theme at all. */
  it('follows the device when nothing was stored', () => {
    const { state } = parseState({ sessions: [], prefs: {} });
    expect(state.prefs.theme).toBe(DEFAULT_THEME);
    expect(state.prefs.theme).toBe('system');
  });

  it('falls back rather than trusting a hand-edited backup', () => {
    const { state } = parseState({ sessions: [], prefs: { theme: 'neon' } });
    expect(state.prefs.theme).toBe('system');
  });
});
