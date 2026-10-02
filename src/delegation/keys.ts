import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
} from 'jose';

// Ed25519 key material for E2. These keys are SEPARATE from the AgentProof
// identity key used by Web Bot Auth / HTTP Message Signatures — identity,
// proof-of-possession, and the issuer are three distinct keys (three layers).
export type Ed25519KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
export type Ed25519PrivateKey = Ed25519KeyPair['privateKey'];
export type Ed25519PublicKey = Ed25519KeyPair['publicKey'];

export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  return generateKeyPair('Ed25519', { extractable: true });
}

export async function publicJwkOf(keyPair: Ed25519KeyPair): Promise<JWK> {
  return exportJWK(keyPair.publicKey);
}

export async function jwkThumbprint(jwk: JWK): Promise<string> {
  return calculateJwkThumbprint(jwk, 'sha256');
}
