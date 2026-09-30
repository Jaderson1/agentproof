import { createPrivateKey, sign as edSign } from 'node:crypto';
import { DIRECTORY_MEDIA_TYPE } from './directory.ts';
import type { Ed25519PrivateJwk } from './keys.ts';

// Wire-format mode for the Signature-Agent header and the covered components.
// The current WG draft (draft-ietf-webbotauth-httpsig-protocol-00) specifies a
// Dictionary-form Signature-Agent, but Cloudflare's current verifier requires
// the legacy sf-string form and explicitly rejects the Dictionary form. We emit
// the Cloudflare-compatible form and keep the serialization isolated here so it
// can change later without touching key storage or the Ed25519 signing.
export const SIGNATURE_AGENT_WIRE_FORMAT = 'cloudflare-compat';

export type SignRequestInput = {
  targetUrl: string;
  // https origin that hosts the key directory (the Signature-Agent value).
  signatureAgent: string;
  keyid: string;
  created: number;
  expires: number;
  nonce?: string;
  label?: string;
};

export type WebBotAuthHeaders = {
  'signature-agent': string;
  'signature-input': string;
  signature: string;
};

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

const TAG = 'web-bot-auth';
const DIRECTORY_TAG = 'http-message-signatures-directory';
const DEFAULT_LABEL = 'sig';
const DIRECTORY_LABEL = 'sig1';

function assertHttpsAgent(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SignatureError(`invalid Signature-Agent URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new SignatureError(`Signature-Agent URL must be https: ${url}`);
  }
}

function authorityOf(targetUrl: string): string {
  return new URL(targetUrl).host.toLowerCase();
}

// The serialized RFC 9421 @signature-params value. This exact string is both
// signed and emitted (after the label) in the Signature-Input header.
export function signatureParams(input: SignRequestInput): string {
  const params = [
    `created=${String(input.created)}`,
    `expires=${String(input.expires)}`,
    `keyid="${input.keyid}"`,
    'alg="ed25519"',
  ];
  if (input.nonce !== undefined) {
    params.push(`nonce="${input.nonce}"`);
  }
  params.push(`tag="${TAG}"`);
  return `("@authority" "signature-agent");${params.join(';')}`;
}

// The RFC 9421 signature base: one line per covered component, then the
// @signature-params line. Covered components follow Cloudflare's documented
// Web Bot Auth form: @authority plus the signature-agent header.
export function signatureBase(input: SignRequestInput): string {
  return [
    `"@authority": ${authorityOf(input.targetUrl)}`,
    `"signature-agent": "${input.signatureAgent}"`,
    `"@signature-params": ${signatureParams(input)}`,
  ].join('\n');
}

export function signRequest(
  privateJwk: Ed25519PrivateJwk,
  input: SignRequestInput,
): WebBotAuthHeaders {
  assertHttpsAgent(input.signatureAgent);
  if (input.expires <= input.created) {
    throw new SignatureError('signature "expires" must be after "created"');
  }
  const label = input.label ?? DEFAULT_LABEL;
  const base = signatureBase(input);
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signature = edSign(null, Buffer.from(base, 'utf8'), key).toString(
    'base64',
  );
  return {
    // cloudflare-compat sf-string form (see SIGNATURE_AGENT_WIRE_FORMAT).
    'signature-agent': `"${input.signatureAgent}"`,
    'signature-input': `${label}=${signatureParams(input)}`,
    signature: `${label}=:${signature}:`,
  };
}

// --- Key directory RESPONSE signing (a distinct use of the same key) ----------
// The origin serving the key directory must prove possession of a key listed in
// it. This signs the directory's own HTTP response, NOT an agent request, and
// uses tag "http-message-signatures-directory", not "web-bot-auth".
//
// Covered components follow Cloudflare's current verifier: ("@authority";req)
// only. The WG draft additionally covers "content-digest"; AgentProof implements
// the Cloudflare-compatible components and does not mix the two.

export type DirectoryResponseInput = {
  // The authority (host[:port]) clients use to fetch the directory.
  authority: string;
  keyid: string;
  created: number;
  expires: number;
  label?: string;
};

export type DirectoryResponseHeaders = {
  'content-type': string;
  'signature-input': string;
  signature: string;
};

function normalizeAuthority(authority: string): string {
  try {
    return new URL(authority).host.toLowerCase();
  } catch {
    return authority.toLowerCase();
  }
}

export function directorySignatureParams(
  input: DirectoryResponseInput,
): string {
  const params = [
    `created=${String(input.created)}`,
    `expires=${String(input.expires)}`,
    `keyid="${input.keyid}"`,
    `tag="${DIRECTORY_TAG}"`,
  ];
  return `("@authority";req);${params.join(';')}`;
}

export function directorySignatureBase(input: DirectoryResponseInput): string {
  return [
    `"@authority";req: ${normalizeAuthority(input.authority)}`,
    `"@signature-params": ${directorySignatureParams(input)}`,
  ].join('\n');
}

export function signDirectoryResponse(
  privateJwk: Ed25519PrivateJwk,
  input: DirectoryResponseInput,
): DirectoryResponseHeaders {
  if (input.expires <= input.created) {
    throw new SignatureError(
      'directory signature "expires" must be after "created"',
    );
  }
  const label = input.label ?? DIRECTORY_LABEL;
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signature = edSign(
    null,
    Buffer.from(directorySignatureBase(input), 'utf8'),
    key,
  ).toString('base64');
  return {
    'content-type': DIRECTORY_MEDIA_TYPE,
    'signature-input': `${label}=${directorySignatureParams(input)}`,
    signature: `${label}=:${signature}:`,
  };
}
