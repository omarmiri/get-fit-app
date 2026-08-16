import { describe, expect, it } from 'vitest';

import { normalizeProjectUrl } from '../auth.js';

/**
 * Reducing a pasted `SUPABASE_URL` to the project origin.
 *
 * This exists because of a real deploy. The dashboard shows the project URL
 * with an API suffix in several places, `https://…supabase.co/rest/v1` was
 * pasted into Render, and every auth call quietly became
 * `…/rest/v1/auth/v1/…` and 404'd. Nothing said so: `/health` still reported
 * `configured: true`, because a non-empty string was all it ever checked.
 *
 * A misconfiguration that reports itself as healthy is the expensive kind, so
 * the shapes below are pinned.
 */

describe('stripping API suffixes', () => {
  it('strips the REST suffix that caused this', () => {
    expect(normalizeProjectUrl('https://abc.supabase.co/rest/v1')).toBe('https://abc.supabase.co');
  });

  it('strips the other API suffixes the dashboard shows', () => {
    for (const suffix of ['/auth/v1', '/storage/v1', '/realtime/v1', '/functions/v1']) {
      expect(normalizeProjectUrl(`https://abc.supabase.co${suffix}`)).toBe('https://abc.supabase.co');
    }
  });

  it('strips a suffix that also has a trailing slash', () => {
    expect(normalizeProjectUrl('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
  });

  it('handles a future version number', () => {
    expect(normalizeProjectUrl('https://abc.supabase.co/rest/v2')).toBe('https://abc.supabase.co');
  });
});

describe('leaving correct input alone', () => {
  it('passes a bare project URL through unchanged', () => {
    expect(normalizeProjectUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co');
  });

  it('removes only a trailing slash', () => {
    expect(normalizeProjectUrl('https://abc.supabase.co/')).toBe('https://abc.supabase.co');
  });

  it('trims stray whitespace from a copy-paste', () => {
    expect(normalizeProjectUrl('  https://abc.supabase.co  ')).toBe('https://abc.supabase.co');
  });

  it('leaves an unrecognised path alone', () => {
    // A self-hosted instance could legitimately live under a path prefix, and
    // guessing that it should not would break it for the sake of tidiness.
    expect(normalizeProjectUrl('https://self.hosted/supabase')).toBe('https://self.hosted/supabase');
  });

  it('does not strip a suffix from the middle of a path', () => {
    expect(normalizeProjectUrl('https://self.hosted/rest/v1/extra')).toBe(
      'https://self.hosted/rest/v1/extra',
    );
  });
});

describe('absent or nonsense input', () => {
  it('answers empty for anything unusable', () => {
    for (const value of [undefined, null, '', '   ', 42]) {
      expect(normalizeProjectUrl(value)).toBe(String(value ?? '').trim());
    }
  });
});
