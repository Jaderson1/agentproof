import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';

export type Ed25519PrivateJwk = {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d: string;
};

export type Ed25519PublicJwk = {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  use: 'sig';
};

export type GeneratedIdentity = {
  keyid: string;
  privateJwk: Ed25519PrivateJwk;
  publicJwk: Ed25519PublicJwk;
};

export class KeyMaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyMaterialError';
  }
}

// base64url JWK SHA-256 thumbprint for an OKP/Ed25519 key. The canonical form
// (RFC 7638 §3, with the OKP members of RFC 8037 Appendix A.3) is the JSON object
// with members in lexicographic order and no whitespace: crv, kty, x.
export function jwkThumbprint(x: string): string {
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
  return createHash('sha256').update(canonical).digest('base64url');
}

type RawJwk = { x?: string; d?: string };

function jwkField(jwk: RawJwk, field: 'x' | 'd'): string {
  const value = jwk[field];
  if (typeof value !== 'string' || value === '') {
    throw new KeyMaterialError(`generated JWK is missing "${field}"`);
  }
  return value;
}

function exportJwk(key: KeyObject): RawJwk {
  return key.export({ format: 'jwk' });
}

export function generateIdentity(): GeneratedIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = jwkField(exportJwk(publicKey), 'x');
  const d = jwkField(exportJwk(privateKey), 'd');
  const keyid = jwkThumbprint(x);
  return {
    keyid,
    privateJwk: { kty: 'OKP', crv: 'Ed25519', x, d },
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x, kid: keyid, use: 'sig' },
  };
}

export function toPublicJwk(privateJwk: Ed25519PrivateJwk): Ed25519PublicJwk {
  const keyid = jwkThumbprint(privateJwk.x);
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: privateJwk.x,
    kid: keyid,
    use: 'sig',
  };
}
