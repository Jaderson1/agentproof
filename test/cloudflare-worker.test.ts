import { describe, expect, it } from 'vitest';
import worker, {
  handleDirectoryRequest,
  type DirectoryEnv,
} from '../deploy/cloudflare-worker/src/worker.ts';

const WELL_KNOWN =
  'https://agentproof.example/.well-known/http-message-signatures-directory';

const env = (over: Partial<DirectoryEnv> = {}): DirectoryEnv => ({
  AGENTPROOF_DIRECTORY:
    '{"keys":[{"kty":"OKP","crv":"Ed25519","x":"AAAA","kid":"kid","use":"sig"}]}',
  AGENTPROOF_SIGNATURE_INPUT:
    'sig1=("@authority";req);created=1;expires=2;keyid="kid";tag="http-message-signatures-directory"',
  AGENTPROOF_SIGNATURE: 'sig1=:AAAA:',
  ...over,
});

describe('key-directory Worker', () => {
  it('serves the directory at the well-known path with the right headers', async () => {
    const res = handleDirectoryRequest(new Request(WELL_KNOWN), env());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/http-message-signatures-directory+json',
    );
    expect(res.headers.get('signature-input')).toContain(
      'tag="http-message-signatures-directory"',
    );
    expect(res.headers.get('signature')).toBe('sig1=:AAAA:');
    const body = await res.text();
    expect(JSON.parse(body)).toHaveProperty('keys');
    expect(body).not.toContain('"d"');
  });

  it('404s on unrelated routes and has no signing endpoint', () => {
    for (const path of ['/', '/sign', '/health', '/.well-known/other']) {
      const res = handleDirectoryRequest(
        new Request(`https://agentproof.example${path}`),
        env(),
      );
      expect(res.status).toBe(404);
    }
  });

  it('rejects a POST to the well-known path (no arbitrary signing)', () => {
    const res = handleDirectoryRequest(
      new Request(WELL_KNOWN, { method: 'POST' }),
      env(),
    );
    expect(res.status).toBe(405);
  });

  it('returns 503 when not configured, rather than an empty directory', () => {
    const res = handleDirectoryRequest(new Request(WELL_KNOWN), {});
    expect(res.status).toBe(503);
  });

  it('exposes the same handler as the default fetch export', () => {
    const res = worker.fetch(new Request(WELL_KNOWN), env());
    expect(res.status).toBe(200);
  });
});
