import { describe, expect, it } from 'vitest';

import { toDownloadUrl } from '../drive.js';

/**
 * Guards on the Drive link handler.
 *
 * A server that fetches a URL on a client's behalf is a server-side request
 * forgery primitive unless it is fenced in. The fence here is that the user's
 * URL is never fetched as given: a Google file id is extracted from it and a
 * fresh URL is built from a fixed template.
 *
 * These tests are that fence's regression suite. They matter more than the
 * happy path, because the happy path fails visibly and a hole here does not.
 */

const url = (input: string): string | null => toDownloadUrl(input);

describe('recognising a share link', () => {
  it('handles the link Drive actually gives you when you press Share', () => {
    expect(url('https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0j/view?usp=sharing')).toBe(
      'https://drive.google.com/uc?export=download&id=1A2b3C4d5E6f7G8h9I0j',
    );
  });

  it('handles the older open?id= form', () => {
    expect(url('https://drive.google.com/open?id=1A2b3C4d5E6f7G8h9I0j')).toBe(
      'https://drive.google.com/uc?export=download&id=1A2b3C4d5E6f7G8h9I0j',
    );
  });

  it('exports a native Google Doc as plain text', () => {
    // A doc has no downloadable bytes, and people do paste plans into one.
    expect(url('https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0j/edit')).toBe(
      'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0j/export?format=txt',
    );
  });

  it('ignores surrounding whitespace', () => {
    expect(url('  https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0j/view  ')).not.toBeNull();
  });
});

describe('refusing everything else', () => {
  it('refuses hosts that are not Google', () => {
    for (const input of [
      'https://example.com/file/d/1A2b3C4d5E6f7G8h9I0j/view',
      'https://drive.google.com.evil.test/file/d/1A2b3C4d5E6f7G8h9I0j/view',
      'https://notdrive.google.com.attacker.test/open?id=1A2b3C4d5E6f7G8h9I0j',
    ]) {
      expect(url(input), input).toBeNull();
    }
  });

  it('refuses internal and link-local addresses', () => {
    // The attack this whole module is shaped around: persuading the server to
    // fetch something only it can reach.
    for (const input of [
      'http://localhost:3000/admin',
      'https://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'https://[::1]/',
      'http://10.0.0.1/',
      'https://192.168.1.1/',
    ]) {
      expect(url(input), input).toBeNull();
    }
  });

  it('refuses non-https schemes, including the sneaky ones', () => {
    for (const input of [
      'http://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0j/view',
      'file:///etc/passwd',
      'ftp://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0j',
      'javascript:alert(1)',
      'data:text/plain,{"kind":"rackfile.plan"}',
    ]) {
      expect(url(input), input).toBeNull();
    }
  });

  it('refuses a Google URL carrying no file id', () => {
    expect(url('https://drive.google.com/drive/my-drive')).toBeNull();
    expect(url('https://drive.google.com/')).toBeNull();
  });

  it('refuses an id that is not shaped like an id', () => {
    expect(url('https://drive.google.com/open?id=../../etc/passwd')).toBeNull();
    expect(url('https://drive.google.com/open?id=short')).toBeNull();
  });

  it('refuses junk without throwing', () => {
    for (const input of ['', '   ', 'not a url', 'https://', '{}']) {
      expect(() => url(input)).not.toThrow();
      expect(url(input), input).toBeNull();
    }
  });

  it('cannot be steered by a userinfo prefix', () => {
    // `https://drive.google.com@evil.test/` has hostname evil.test, not Drive.
    expect(url('https://drive.google.com@evil.test/file/d/1A2b3C4d5E6f7G8h9I0j/view')).toBeNull();
  });

  it('never lets the supplied URL through unchanged', () => {
    /*
     * The property that makes the fence hold: whatever comes back is built
     * from a template with an extracted id, so a query string, fragment or
     * path smuggled in the original cannot survive into the fetched URL.
     */
    const result = url(
      'https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0j/view?usp=sharing&redirect=http://169.254.169.254/#frag',
    );

    expect(result).toBe('https://drive.google.com/uc?export=download&id=1A2b3C4d5E6f7G8h9I0j');
    expect(result).not.toContain('169.254');
    expect(result).not.toContain('#');
  });
});
