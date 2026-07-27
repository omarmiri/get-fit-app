import { describe, expect, it } from 'vitest';

import { serializeAttribute } from '@/ui/dom';

/**
 * These cover a bug that reached the browser: booleans were written as `=""`
 * for every attribute, which produced invalid `aria-pressed=""` and made the
 * `[data-done='true']` style rules match nothing.
 */
describe('serializeAttribute', () => {
  it('writes ARIA booleans as literal true and false', () => {
    expect(serializeAttribute('aria-pressed', true)).toBe('true');
    expect(serializeAttribute('aria-pressed', false)).toBe('false');
    expect(serializeAttribute('aria-selected', false)).toBe('false');
  });

  it('keeps ARIA state attributes present when false', () => {
    // Omitting aria-pressed says "not a toggle button", not "not pressed".
    expect(serializeAttribute('aria-pressed', false)).not.toBeNull();
  });

  it('writes data booleans as literal true and false so CSS can match them', () => {
    expect(serializeAttribute('data-done', true)).toBe('true');
    expect(serializeAttribute('data-today', false)).toBe('false');
  });

  it('passes ARIA strings through unchanged', () => {
    expect(serializeAttribute('aria-current', 'date')).toBe('date');
    expect(serializeAttribute('aria-label', 'Rest timer')).toBe('Rest timer');
  });

  it('follows the HTML convention for ordinary boolean attributes', () => {
    expect(serializeAttribute('muted', true)).toBe('');
    expect(serializeAttribute('selected', false)).toBeNull();
    expect(serializeAttribute('hidden', true)).toBe('');
  });

  it('stringifies numbers', () => {
    expect(serializeAttribute('width', 320)).toBe('320');
    expect(serializeAttribute('aria-valuenow', 0)).toBe('0');
  });

  it('omits null and undefined for every attribute kind', () => {
    expect(serializeAttribute('aria-label', null)).toBeNull();
    expect(serializeAttribute('data-done', undefined)).toBeNull();
    expect(serializeAttribute('src', null)).toBeNull();
  });
});
