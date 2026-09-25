import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Auth from '../auth.js';

/*
 * Local verification of Supabase access tokens.
 *
 * Tokens here are signed with a key pair made for the test, and the project's
 * key set is served by a stubbed fetch — so every path is exercised without a
 * network, including the one that must never be taken: accepting a token
 * nobody signed.
 */

const PROJECT = 'https://test-project.supabase.co';

interface Signer {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly jwk: Record<string, unknown>;
}

function signer(kid: string): Signer {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' } };
}

function token(key: Signer, claims: Record<string, unknown> = {}, alg = 'ES256'): string {
  const segment = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = segment({ alg, kid: key.kid, typ: 'JWT' });
  const body = segment({
    sub: 'user-1',
    email: 'me@example.com',
    aud: 'authenticated',
    iss: `${PROJECT}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), {
    key: key.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${head}.${body}.${signature.toString('base64url')}`;
}

let published: Signer[] = [];
let calls: string[] = [];

/** The key the project is signing with. */
function current(): Signer {
  const key = published[0];
  if (!key) throw new Error('no published key');
  return key;
}

async function load(): Promise<typeof Auth> {
  vi.resetModules();
  return import('../auth.js');
}

beforeEach(() => {
  published = [signer('key-1')];
  calls = [];
  vi.stubEnv('SUPABASE_URL', PROJECT);
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/.well-known/jwks.json')) {
      return Promise.resolve(new Response(JSON.stringify({ keys: published.map((key) => key.jwk) })));
    }
    if (url.endsWith('/auth/v1/user')) {
      return Promise.resolve(new Response(JSON.stringify({ id: 'remote-user', email: 'r@example.com' })));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifyToken, locally', () => {
  it('accepts a token the project signed, without asking Supabase who it is', async () => {
    const auth = await load();

    expect(await auth.verifyToken(token(current()))).toEqual({
      id: 'user-1',
      email: 'me@example.com',
    });
    expect(calls.some((url) => url.endsWith('/auth/v1/user'))).toBe(false);
  });

  it('refuses a token signed by anyone else', async () => {
    const auth = await load();
    const forger = signer('key-1');

    expect(await auth.verifyToken(token(forger))).toBeNull();
  });

  it('refuses an expired token', async () => {
    const auth = await load();

    expect(await auth.verifyToken(token(current(), { exp: Math.floor(Date.now() / 1000) - 120 }))).toBeNull();
  });

  it('asks Supabase about a signed token whose issuer or audience it does not expect', async () => {
    const auth = await load();

    // Remote says who it is; a local misreading must not sign the user out.
    expect(await auth.verifyToken(token(current(), { iss: 'https://auth.example.com/auth/v1' }))).toEqual({
      id: 'remote-user',
      email: 'r@example.com',
    });
  });

  it('refuses a tampered token', async () => {
    const auth = await load();
    const [head, , signature] = token(current()).split('.');
    const body = Buffer.from(JSON.stringify({ sub: 'someone-else', aud: 'authenticated' })).toString(
      'base64url',
    );

    expect(await auth.verifyToken(`${head}.${body}.${signature}`)).toBeNull();
  });

  it('falls back to Supabase for a token it cannot judge locally', async () => {
    const auth = await load();

    expect(await auth.verifyToken(token(current(), {}, 'HS256'))).toEqual({
      id: 'remote-user',
      email: 'r@example.com',
    });
  });

  it('picks up a key rotated in after the key set was cached', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const auth = await load();
      expect(await auth.verifyToken(token(current()))).not.toBeNull();

      const rotated = signer('key-2');
      published = [...published, rotated];
      vi.setSystemTime(Date.now() + 2 * 60 * 1000);

      expect(await auth.verifyToken(token(rotated))).toEqual({ id: 'user-1', email: 'me@example.com' });
    } finally {
      vi.useRealTimers();
    }
  });
});
