import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const privateJwkSchema = z.strictObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().min(1),
  d: z.string().min(1),
});

const publicJwkSchema = z.strictObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string().min(1),
  kid: z.string().min(1),
  use: z.literal('sig'),
});

const identitySchema = z.strictObject({
  version: z.literal(1),
  algorithm: z.literal('ed25519'),
  keyid: z.string().min(1),
  signatureAgent: z.string().min(1).optional(),
  privateJwk: privateJwkSchema,
  publicJwk: publicJwkSchema,
});

export type StoredIdentity = z.infer<typeof identitySchema>;

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

// The identity file holds the private key. It is written user-only (0600) and
// belongs under an ignored directory; it must never be committed or shared.
export function saveIdentity(path: string, identity: StoredIdentity): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function loadIdentity(path: string): StoredIdentity {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new IdentityError(`could not read identity file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IdentityError(`identity file is not valid JSON: ${path}`);
  }
  const result = identitySchema.safeParse(parsed);
  if (!result.success) {
    throw new IdentityError(
      `identity file is not a valid AgentProof identity: ${path}`,
    );
  }
  return result.data;
}
