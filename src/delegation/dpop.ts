import { createHash, randomBytes } from 'node:crypto';
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  EmbeddedJWK,
  jwtVerify,
  SignJWT,
  type JWK,
} from 'jose';
import { z } from 'zod';
import type { Ed25519PrivateKey } from './keys.ts';
import { realClock, type Clock } from './model.ts';

// DPoP (RFC 9449). alg is restricted to Ed25519 (RFC 9864 fully-specified);
// "none" and symmetric algorithms are never accepted.
export const DPOP_ALG = 'Ed25519';
const ALLOWED_ALGS = [DPOP_ALG];
const DEFAULT_IAT_WINDOW_SECONDS = 120;

export class DpopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DpopError';
  }
}

// RFC 9449: htu is the target URI without query and fragment.
export function canonicalHtu(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

// RFC 9449 ath: base64url(SHA-256(ASCII(access token))).
export function accessTokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'ascii').digest('base64url');
}

export async function createDpopProof(options: {
  dpopPrivateKey: Ed25519PrivateKey;
  dpopPublicJwk: JWK;
  method: string;
  url: string;
  accessToken: string;
  clock?: Clock;
  jti?: string;
}): Promise<string> {
  const iat = (options.clock ?? realClock)();
  return new SignJWT({
    htm: options.method,
    htu: canonicalHtu(options.url),
    ath: accessTokenHash(options.accessToken),
  })
    .setProtectedHeader({
      alg: DPOP_ALG,
      typ: 'dpop+jwt',
      jwk: options.dpopPublicJwk,
    })
    .setIssuedAt(iat)
    .setJti(options.jti ?? randomBytes(16).toString('base64url'))
    .sign(options.dpopPrivateKey);
}

const dpopClaimsSchema = z.object({
  jti: z.string().min(1),
  htm: z.string().min(1),
  htu: z.string().min(1),
  iat: z.number(),
  ath: z.string().optional(),
});

export type DpopVerifyResult = {
  jkt: string;
  jti: string;
  htm: string;
  htu: string;
  ath: string | undefined;
};

// Verifies the proof's own signature with its EMBEDDED public key, enforces the
// JOSE header (typ/alg, public key present, no private key), the iat window, and
// returns the key thumbprint + bound claims. Request binding (htm/htu/ath),
// cnf.jkt matching and replay are checked by the Resource Server.
export async function verifyDpopProof(
  proof: string,
  options: { now: number; iatWindowSeconds?: number },
): Promise<DpopVerifyResult> {
  const header = decodeProtectedHeader(proof);
  if (header.typ !== 'dpop+jwt') {
    throw new DpopError('unexpected typ');
  }
  if (header.alg !== DPOP_ALG) {
    throw new DpopError('unexpected alg');
  }
  const jwk = header.jwk;
  if (jwk === undefined) {
    throw new DpopError('missing embedded jwk');
  }
  if ('d' in jwk) {
    throw new DpopError('embedded jwk must not contain a private key');
  }

  const { payload } = await jwtVerify(proof, EmbeddedJWK, {
    algorithms: ALLOWED_ALGS,
  });
  const claims = dpopClaimsSchema.parse(payload);

  const window = options.iatWindowSeconds ?? DEFAULT_IAT_WINDOW_SECONDS;
  if (Math.abs(options.now - claims.iat) > window) {
    throw new DpopError('iat outside acceptance window');
  }

  const jkt = await calculateJwkThumbprint(jwk, 'sha256');
  return {
    jkt,
    jti: claims.jti,
    htm: claims.htm,
    htu: claims.htu,
    ath: claims.ath,
  };
}
