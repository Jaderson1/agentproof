import { createPublicKey, verify as edVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildKeyDirectory,
  directorySignatureBase,
  directorySignatureParams,
  generateIdentity,
  interpretVerifierStatus,
  jwkThumbprint,
  signatureBase,
  signatureParams,
  signDirectoryResponse,
  signRequest,
  toPublicJwk,
  verificationExplanation,
  type DirectoryResponseInput,
  type SignRequestInput,
} from '../src/identity/web-bot-auth/index.ts';

const identity = generateIdentity();

const input = (over: Partial<SignRequestInput> = {}): SignRequestInput => ({
  targetUrl: 'https://example.com/path',
  signatureAgent: 'https://signer.example',
  keyid: identity.keyid,
  created: 1_700_000_000,
  expires: 1_700_000_300,
  nonce: 'fixed-nonce',
  ...over,
});

function signatureBytes(header: string): Buffer {
  const match = /^sig=:(.+):$/.exec(header);
  if (match === null) {
    throw new Error(`unexpected Signature header: ${header}`);
  }
  const b64 = match[1];
  if (b64 === undefined) {
    throw new Error('missing signature bytes');
  }
  return Buffer.from(b64, 'base64');
}

describe('generateIdentity / keys', () => {
  it('produces an Ed25519 keypair with a base64url thumbprint keyid', () => {
    expect(identity.publicJwk.kty).toBe('OKP');
    expect(identity.publicJwk.crv).toBe('Ed25519');
    expect(identity.publicJwk.use).toBe('sig');
    expect(identity.publicJwk.kid).toBe(identity.keyid);
    expect(identity.keyid).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(identity.privateJwk.d.length).toBeGreaterThan(0);
  });

  it('keeps the private scalar out of the public JWK', () => {
    expect(Object.keys(identity.publicJwk)).not.toContain('d');
  });

  it('derives the same keyid from the private key via toPublicJwk', () => {
    expect(toPublicJwk(identity.privateJwk).kid).toBe(identity.keyid);
    expect(jwkThumbprint(identity.publicJwk.x)).toBe(identity.keyid);
  });
});

describe('buildKeyDirectory', () => {
  it('is a JWKS of public keys only (no private scalar)', () => {
    const directory = buildKeyDirectory([identity.publicJwk]);
    expect(directory.keys).toHaveLength(1);
    expect(JSON.stringify(directory)).not.toContain('"d"');
  });
});

describe('signatureParams / signatureBase', () => {
  it('serializes the covered components and parameters', () => {
    const params = signatureParams(input());
    expect(params).toContain('("@authority" "signature-agent")');
    expect(params).toContain(`keyid="${identity.keyid}"`);
    expect(params).toContain('alg="ed25519"');
    expect(params).toContain('nonce="fixed-nonce"');
    expect(params).toContain('tag="web-bot-auth"');
    expect(params).toContain('created=1700000000');
    expect(params).toContain('expires=1700000300');
  });

  it('builds a signature base with a lowercased authority incl. port', () => {
    const base = signatureBase(
      input({ targetUrl: 'https://EXAMPLE.com:8443/x' }),
    );
    expect(base).toContain('"@authority": example.com:8443');
    expect(base).toContain('"signature-agent": "https://signer.example"');
    expect(base).toContain(
      `"@signature-params": ${signatureParams(input({ targetUrl: 'https://EXAMPLE.com:8443/x' }))}`,
    );
  });
});

describe('signRequest', () => {
  it('emits the three Web Bot Auth headers in the documented form', () => {
    const headers = signRequest(identity.privateJwk, input());
    expect(headers['signature-agent']).toBe('"https://signer.example"');
    expect(headers['signature-input']).toBe(`sig=${signatureParams(input())}`);
    expect(headers.signature).toMatch(/^sig=:.+:$/);
  });

  it('produces a signature that verifies against the public key', () => {
    const headers = signRequest(identity.privateJwk, input());
    const publicKey = createPublicKey({
      key: {
        kty: identity.publicJwk.kty,
        crv: identity.publicJwk.crv,
        x: identity.publicJwk.x,
      },
      format: 'jwk',
    });
    const ok = edVerify(
      null,
      Buffer.from(signatureBase(input()), 'utf8'),
      publicKey,
      signatureBytes(headers.signature),
    );
    expect(ok).toBe(true);
  });

  it('is deterministic for identical input and changes with the components', () => {
    const a = signRequest(identity.privateJwk, input()).signature;
    const b = signRequest(identity.privateJwk, input()).signature;
    expect(a).toBe(b);
    expect(
      signRequest(identity.privateJwk, input({ nonce: 'other' })).signature,
    ).not.toBe(a);
    expect(
      signRequest(
        identity.privateJwk,
        input({ targetUrl: 'https://other.example/x' }),
      ).signature,
    ).not.toBe(a);
    expect(
      signRequest(
        identity.privateJwk,
        input({ created: 1_700_000_001, expires: 1_700_000_301 }),
      ).signature,
    ).not.toBe(a);
  });

  it('supports a custom signature label', () => {
    const headers = signRequest(identity.privateJwk, input({ label: 'agent' }));
    expect(headers['signature-input'].startsWith('agent=')).toBe(true);
    expect(headers.signature.startsWith('agent=:')).toBe(true);
  });

  it('rejects a non-positive validity window', () => {
    expect(() =>
      signRequest(identity.privateJwk, input({ created: 100, expires: 100 })),
    ).toThrow();
  });

  it('rejects a non-https Signature-Agent', () => {
    expect(() =>
      signRequest(
        identity.privateJwk,
        input({ signatureAgent: 'http://signer.example' }),
      ),
    ).toThrow();
  });
});

describe('interpretVerifierStatus', () => {
  it('maps 401 to unverified, never to a specific cause', () => {
    expect(interpretVerifierStatus(200)).toBe('verified');
    expect(interpretVerifierStatus(401)).toBe('unverified');
    expect(interpretVerifierStatus(400)).toBe('malformed');
    expect(interpretVerifierStatus(503)).toBe('inconclusive');
  });

  it('explains that a 401 is ambiguous', () => {
    const text = verificationExplanation('unverified');
    expect(text).toContain('did not verify');
    expect(text.toLowerCase()).toContain('key');
  });

  it('explains every status', () => {
    for (const status of [
      'verified',
      'unverified',
      'malformed',
      'inconclusive',
    ] as const) {
      expect(verificationExplanation(status).length).toBeGreaterThan(0);
    }
  });
});

const dirInput = (
  over: Partial<DirectoryResponseInput> = {},
): DirectoryResponseInput => ({
  authority: 'agentproof.example',
  keyid: identity.keyid,
  created: 1_700_000_000,
  expires: 1_700_000_000 + 86_400,
  ...over,
});

function directorySignatureBytes(header: string): Buffer {
  const match = /=:(.+):$/.exec(header);
  if (match === null || match[1] === undefined) {
    throw new Error(`unexpected Signature header: ${header}`);
  }
  return Buffer.from(match[1], 'base64');
}

function publicKeyObject(): ReturnType<typeof createPublicKey> {
  return createPublicKey({
    key: {
      kty: identity.publicJwk.kty,
      crv: identity.publicJwk.crv,
      x: identity.publicJwk.x,
    },
    format: 'jwk',
  });
}

describe('signDirectoryResponse (key directory proof)', () => {
  it('uses the directory tag and @authority;req, not the agent tag', () => {
    const params = directorySignatureParams(dirInput());
    expect(params).toContain('("@authority";req)');
    expect(params).toContain('tag="http-message-signatures-directory"');
    expect(params).not.toContain('web-bot-auth');
  });

  it('does not cover content-digest (Cloudflare mode, not the WG draft)', () => {
    expect(directorySignatureParams(dirInput())).not.toContain(
      'content-digest',
    );
    expect(directorySignatureBase(dirInput())).not.toContain('content-digest');
  });

  it('emits the directory media type and no private material', () => {
    const headers = signDirectoryResponse(identity.privateJwk, dirInput());
    expect(headers['content-type']).toBe(
      'application/http-message-signatures-directory+json',
    );
    expect(JSON.stringify(headers)).not.toContain('"d"');
    expect(headers.signature).not.toContain(identity.privateJwk.d);
  });

  it('produces a directory signature that verifies with the public key', () => {
    const headers = signDirectoryResponse(identity.privateJwk, dirInput());
    const ok = edVerify(
      null,
      Buffer.from(directorySignatureBase(dirInput()), 'utf8'),
      publicKeyObject(),
      directorySignatureBytes(headers.signature),
    );
    expect(ok).toBe(true);
  });

  it('breaks verification when the authority changes', () => {
    const headers = signDirectoryResponse(
      identity.privateJwk,
      dirInput({ authority: 'a.example' }),
    );
    const ok = edVerify(
      null,
      Buffer.from(
        directorySignatureBase(dirInput({ authority: 'b.example' })),
        'utf8',
      ),
      publicKeyObject(),
      directorySignatureBytes(headers.signature),
    );
    expect(ok).toBe(false);
  });

  it('rejects a non-positive validity window', () => {
    expect(() =>
      signDirectoryResponse(
        identity.privateJwk,
        dirInput({ created: 100, expires: 100 }),
      ),
    ).toThrow();
  });
});
