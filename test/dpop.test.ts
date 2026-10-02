import { describe, expect, it } from 'vitest';
import {
  accessTokenHash,
  canonicalHtu,
  createDpopProof,
  generateEd25519KeyPair,
  publicJwkOf,
  verifyDpopProof,
  type Ed25519KeyPair,
} from '../src/delegation/index.ts';

const T0 = 1_700_000_000;
const at = () => T0;

let keyPair: Ed25519KeyPair;
let jwk: Awaited<ReturnType<typeof publicJwkOf>>;

async function proof(jti?: string): Promise<string> {
  return createDpopProof({
    dpopPrivateKey: keyPair.privateKey,
    dpopPublicJwk: jwk,
    method: 'GET',
    url: 'https://resource.local/documents/123?x=1',
    accessToken: 'the-access-token',
    clock: at,
    ...(jti !== undefined ? { jti } : {}),
  });
}

describe('DPoP proof', () => {
  it('canonicalHtu drops query and fragment', () => {
    expect(canonicalHtu('https://resource.local/documents/123?x=1#f')).toBe(
      'https://resource.local/documents/123',
    );
  });

  it('accessTokenHash is base64url SHA-256', () => {
    expect(accessTokenHash('the-access-token')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips and never embeds the private key', async () => {
    keyPair = await generateEd25519KeyPair();
    jwk = await publicJwkOf(keyPair);
    const token = await proof();
    const result = await verifyDpopProof(token, { now: T0 });
    expect(result.htm).toBe('GET');
    expect(result.htu).toBe('https://resource.local/documents/123');
    expect(result.ath).toBe(accessTokenHash('the-access-token'));
    expect(result.jkt.length).toBeGreaterThan(0);
    expect(token.split('.').length).toBe(3);
    // decode header and confirm the embedded jwk is public-only
    const header = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as { typ: string; alg: string; jwk: Record<string, unknown> };
    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('Ed25519');
    expect('d' in header.jwk).toBe(false);
  });

  it('rejects a proof outside the iat window', async () => {
    keyPair = await generateEd25519KeyPair();
    jwk = await publicJwkOf(keyPair);
    const token = await proof();
    await expect(
      verifyDpopProof(token, { now: T0 + 10_000, iatWindowSeconds: 120 }),
    ).rejects.toThrow();
  });
});
