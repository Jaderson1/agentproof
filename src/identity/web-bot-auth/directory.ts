import type { Ed25519PublicJwk } from './keys.ts';

// draft-meunier-http-message-signatures-directory-05.
export const DIRECTORY_WELL_KNOWN_PATH =
  '/.well-known/http-message-signatures-directory';
export const DIRECTORY_MEDIA_TYPE =
  'application/http-message-signatures-directory+json';

export type KeyDirectory = {
  keys: Ed25519PublicJwk[];
};

// The public key directory is a JWKS. It contains only public material; the
// private `d` never reaches it.
export function buildKeyDirectory(
  publicKeys: readonly Ed25519PublicJwk[],
): KeyDirectory {
  return { keys: [...publicKeys] };
}
