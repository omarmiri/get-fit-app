// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { captureRedirectSession, currentUser, signOut, takeRedirectError } from '@/services/account';

/**
 * Picking up a session from a returning OAuth redirect.
 *
 * Google sign-in comes back with tokens in the URL fragment. Two things have
 * to be true every time, and neither is visible on screen if it breaks: the
 * tokens must leave the address bar immediately, and they must not stay in
 * browser history where the back button would restore them.
 */

function land(fragment: string): void {
  history.replaceState(null, '', `/${fragment}`);
}

beforeEach(() => {
  signOut();
  takeRedirectError();
  history.replaceState(null, '', '/');
});

describe('a successful redirect', () => {
  it('stores the session it was handed', () => {
    land('#access_token=abc123&refresh_token=r1&expires_in=3600&token_type=bearer');

    expect(captureRedirectSession()).not.toBeNull();
    expect(currentUser()).not.toBeNull();
  });

  it('strips the tokens from the address bar', () => {
    // The whole point. A token left in the URL is a token in the back button,
    // in document.referrer on the next navigation, and in anything the user
    // pastes to share the page.
    land('#access_token=abc123&refresh_token=r1&expires_in=3600');
    captureRedirectSession();

    expect(location.hash).toBe('');
    expect(location.href).not.toContain('abc123');
  });

  it('replaces the history entry rather than adding one', () => {
    const before = history.length;
    land('#access_token=abc123&refresh_token=r1');
    captureRedirectSession();

    expect(history.length).toBe(before);
  });

  it('keeps any query string that was already on the page', () => {
    history.replaceState(null, '', '/?ref=email#access_token=abc123&refresh_token=r1');
    captureRedirectSession();

    expect(location.search).toBe('?ref=email');
    expect(location.hash).toBe('');
  });
});

describe('a refused redirect', () => {
  it('reports the reason and stores nothing', () => {
    // A cancelled consent screen, or Google not enabled on the project.
    land('#error=access_denied&error_description=User+cancelled');
    const user = captureRedirectSession();

    expect(user).toBeNull();
    expect(currentUser()).toBeNull();
    expect(takeRedirectError()).toContain('cancelled');
  });

  it('clears the error once it has been read', () => {
    land('#error=access_denied&error_description=Nope');
    captureRedirectSession();

    expect(takeRedirectError()).toBeTruthy();
    expect(takeRedirectError()).toBeNull();
  });

  it('still strips the fragment', () => {
    land('#error=access_denied&error_description=Nope');
    captureRedirectSession();

    expect(location.hash).toBe('');
  });
});

describe('an ordinary page load', () => {
  it('does nothing when there is no fragment', () => {
    expect(captureRedirectSession()).toBeNull();
    expect(currentUser()).toBeNull();
  });

  it('leaves an unrelated fragment alone', () => {
    // The app does not use fragments itself today, but eating someone else's
    // deep link would be a rude and very confusing thing to do.
    land('#somewhere-else');

    expect(captureRedirectSession()).toBeNull();
    expect(location.hash).toBe('#somewhere-else');
  });

  it('ignores a fragment that only looks similar', () => {
    land('#my_access_token_notes=hello');

    expect(captureRedirectSession()).toBeNull();
    expect(location.hash).toBe('#my_access_token_notes=hello');
  });
});
