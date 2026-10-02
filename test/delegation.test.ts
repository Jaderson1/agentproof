import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDpopProof,
  createResourceServer,
  generateEd25519KeyPair,
  issueAccessToken,
  jwkThumbprint,
  publicJwkOf,
  RAR_TYPE,
  type AuthorizationDetail,
  type DelegationDecision,
  type Ed25519KeyPair,
} from '../src/delegation/index.ts';

const T0 = 1_700_000_000;
const RESOURCE = 'https://resource.local';
const ISSUER = 'https://issuer.local';
const at = (t: number) => (): number => t;

let issuer: Ed25519KeyPair;
let agentA: Ed25519KeyPair;
let agentB: Ed25519KeyPair;
let jwkA: Awaited<ReturnType<typeof publicJwkOf>>;
let jwkB: Awaited<ReturnType<typeof publicJwkOf>>;
let jktA: string;

beforeAll(async () => {
  issuer = await generateEd25519KeyPair();
  agentA = await generateEd25519KeyPair();
  agentB = await generateEd25519KeyPair();
  jwkA = await publicJwkOf(agentA);
  jwkB = await publicJwkOf(agentB);
  jktA = await jwkThumbprint(jwkA);
});

const detail = (path: string, method: string): AuthorizationDetail => ({
  type: RAR_TYPE,
  locations: [`${RESOURCE}${path}`],
  actions: ['read'],
  path,
  method,
});

async function issue(
  overrides: {
    resource?: string;
    dpopJkt?: string;
    details?: AuthorizationDetail[];
    ttlSeconds?: number;
    notBeforeOffsetSeconds?: number;
    issuedAt?: number;
  } = {},
): Promise<string> {
  return issueAccessToken(
    issuer.privateKey,
    {
      issuer: ISSUER,
      subject: 'user-123',
      clientId: 'agentproof-test-agent',
      resource: overrides.resource ?? RESOURCE,
      dpopJkt: overrides.dpopJkt ?? jktA,
      authorizationDetails: overrides.details ?? [
        detail('/documents/123', 'GET'),
      ],
      ttlSeconds: overrides.ttlSeconds ?? 300,
      ...(overrides.notBeforeOffsetSeconds !== undefined
        ? { notBeforeOffsetSeconds: overrides.notBeforeOffsetSeconds }
        : {}),
    },
    at(overrides.issuedAt ?? T0),
  );
}

async function proof(
  token: string,
  overrides: {
    method?: string;
    url?: string;
    keyPair?: Ed25519KeyPair;
    jwk?: Awaited<ReturnType<typeof publicJwkOf>>;
    accessToken?: string;
    jti?: string;
  } = {},
): Promise<string> {
  return createDpopProof({
    dpopPrivateKey: (overrides.keyPair ?? agentA).privateKey,
    dpopPublicJwk: overrides.jwk ?? jwkA,
    method: overrides.method ?? 'GET',
    url: overrides.url ?? `${RESOURCE}/documents/123`,
    accessToken: overrides.accessToken ?? token,
    clock: at(T0),
    ...(overrides.jti !== undefined ? { jti: overrides.jti } : {}),
  });
}

function makeServer(now = T0): ReturnType<typeof createResourceServer> {
  return createResourceServer({
    issuer: ISSUER,
    resource: RESOURCE,
    issuerPublicKey: issuer.publicKey,
    publicPaths: ['/public'],
    replayStore: new Set<string>(),
    clock: at(now),
  });
}

// Flip the first character of the payload segment: this always changes the
// signing input, so the signature no longer verifies (whereas flipping trailing
// signature bits can be a no-op after base64url decoding).
function tamper(jwt: string): string {
  const parts = jwt.split('.');
  const payload = parts[1] ?? '';
  const first = payload.charAt(0);
  const flipped = `${first === 'e' ? 'f' : 'e'}${payload.slice(1)}`;
  return `${parts[0] ?? ''}.${flipped}.${parts[2] ?? ''}`;
}

describe('E2 delegated authorization — end to end', () => {
  it('Case 1: authorized GET /documents/123 → CAN_PROCEED', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token),
    });
    expect(result).toEqual<DelegationDecision>({
      decision: 'CAN_PROCEED',
      reason: 'ok',
      basis: 'delegation',
    });
  });

  it('Case 2: GET /documents/456 (out of scope) → insufficient-scope', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/456`,
      accessToken: token,
      dpopProof: await proof(token, { url: `${RESOURCE}/documents/456` }),
    });
    expect(result.decision).toBe('NOT_AUTHORIZED');
    expect(result.reason).toBe('insufficient-scope');
  });

  it('Case 3: POST /documents/123 (wrong method) → wrong-method', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'POST',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token, { method: 'POST' }),
    });
    expect(result.reason).toBe('wrong-method');
  });

  it('Case 4: token for another resource/audience → wrong-resource', async () => {
    const token = await issue({ resource: 'https://other-resource.local' });
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token),
    });
    expect(result.reason).toBe('wrong-resource');
  });

  it('Case 5: expired token → expired-token', async () => {
    const token = await issue({ ttlSeconds: 300 });
    const result = await makeServer(T0 + 1000)({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token),
    });
    expect(result.reason).toBe('expired-token');
  });

  it('Case 6: token not yet valid → not-yet-valid', async () => {
    const token = await issue({ notBeforeOffsetSeconds: 3600 });
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token),
    });
    expect(result.reason).toBe('not-yet-valid');
  });

  it('Case 7: tampered token → invalid-token', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: tamper(token),
      dpopProof: await proof(token, { accessToken: tamper(token) }),
    });
    expect(result.reason).toBe('invalid-token');
  });

  it('Case 8: Agent B using Agent A delegation → key-binding-mismatch', async () => {
    const token = await issue({ dpopJkt: jktA });
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token, { keyPair: agentB, jwk: jwkB }),
    });
    expect(result.reason).toBe('key-binding-mismatch');
  });

  it('Case 9: tampered DPoP proof → invalid-dpop', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: tamper(await proof(token)),
    });
    expect(result.reason).toBe('invalid-dpop');
  });

  it('Case 10: DPoP proof with a different method → invalid-dpop', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token, { method: 'POST' }),
    });
    expect(result.reason).toBe('invalid-dpop');
  });

  it('Case 11: DPoP proof with a different URL → invalid-dpop', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof: await proof(token, { url: `${RESOURCE}/documents/999` }),
    });
    expect(result.reason).toBe('invalid-dpop');
  });

  it('Case 12: replay of the same proof → replay-detected', async () => {
    const token = await issue();
    const server = makeServer();
    const dpopProof = await proof(token, { jti: 'fixed-jti-1' });
    const first = await server({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof,
    });
    const second = await server({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
      accessToken: token,
      dpopProof,
    });
    expect(first.decision).toBe('CAN_PROCEED');
    expect(second.reason).toBe('replay-detected');
  });

  it('Case 13: public resource without delegation → CAN_PROCEED', async () => {
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/public`,
    });
    expect(result).toEqual<DelegationDecision>({
      decision: 'CAN_PROCEED',
      reason: 'ok',
      basis: 'delegation',
    });
  });

  it('Case 14: protected resource without delegation → NEEDS_USER / missing-delegation', async () => {
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123`,
    });
    expect(result).toEqual<DelegationDecision>({
      decision: 'NEEDS_USER',
      reason: 'missing-delegation',
      basis: 'delegation',
    });
  });

  it('a query string does not change the authorized resource', async () => {
    const token = await issue();
    const result = await makeServer()({
      method: 'GET',
      url: `${RESOURCE}/documents/123?foo=bar`,
      accessToken: token,
      dpopProof: await proof(token, {
        url: `${RESOURCE}/documents/123?foo=bar`,
      }),
    });
    expect(result.decision).toBe('CAN_PROCEED');
  });
});

describe('E2 security matrix', () => {
  it('every attack denies and the valid request allows', async () => {
    const good = await issue();
    const rows: {
      name: string;
      run: () => Promise<DelegationDecision>;
      expect: 'ALLOW' | 'DENY';
    }[] = [
      {
        name: 'tampered token',
        expect: 'DENY',
        run: async () =>
          makeServer()({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: tamper(good),
            dpopProof: await proof(good, { accessToken: tamper(good) }),
          }),
      },
      {
        name: 'expired token',
        expect: 'DENY',
        run: async () => {
          const t = await issue({ ttlSeconds: 60 });
          return makeServer(T0 + 1000)({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: t,
            dpopProof: await proof(t),
          });
        },
      },
      {
        name: 'token for another resource',
        expect: 'DENY',
        run: async () => {
          const t = await issue({ resource: 'https://other-resource.local' });
          return makeServer()({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: t,
            dpopProof: await proof(t),
          });
        },
      },
      {
        name: 'insufficient scope',
        expect: 'DENY',
        run: async () =>
          makeServer()({
            method: 'GET',
            url: `${RESOURCE}/admin`,
            accessToken: good,
            dpopProof: await proof(good, { url: `${RESOURCE}/admin` }),
          }),
      },
      {
        name: 'Agent B using Agent A token',
        expect: 'DENY',
        run: async () =>
          makeServer()({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: good,
            dpopProof: await proof(good, { keyPair: agentB, jwk: jwkB }),
          }),
      },
      {
        name: 'DPoP wrong method',
        expect: 'DENY',
        run: async () =>
          makeServer()({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: good,
            dpopProof: await proof(good, { method: 'DELETE' }),
          }),
      },
      {
        name: 'DPoP wrong URL',
        expect: 'DENY',
        run: async () =>
          makeServer()({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: good,
            dpopProof: await proof(good, { url: `${RESOURCE}/documents/999` }),
          }),
      },
      {
        name: 'replay',
        expect: 'DENY',
        run: async () => {
          const server = makeServer();
          const p = await proof(good, { jti: 'matrix-replay' });
          await server({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: good,
            dpopProof: p,
          });
          return server({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: good,
            dpopProof: p,
          });
        },
      },
      {
        name: 'valid request',
        expect: 'ALLOW',
        run: async () =>
          makeServer()({
            method: 'GET',
            url: `${RESOURCE}/documents/123`,
            accessToken: good,
            dpopProof: await proof(good),
          }),
      },
    ];

    for (const row of rows) {
      const result = await row.run();
      if (row.expect === 'ALLOW') {
        expect(result.decision, row.name).toBe('CAN_PROCEED');
      } else {
        expect(result.decision, row.name).toBe('NOT_AUTHORIZED');
      }
    }
  });
});
