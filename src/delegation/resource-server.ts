import { errors as joseErrors, jwtVerify } from 'jose';
import type { Ed25519PublicKey } from './keys.ts';
import {
  accessTokenClaimsSchema,
  realClock,
  type AccessTokenClaims,
  type Clock,
  type DelegationDecision,
  type DelegationReason,
} from './model.ts';
import { accessTokenHash, canonicalHtu, verifyDpopProof } from './dpop.ts';

const TOKEN_ALG = 'Ed25519';

export type ResourceServerConfig = {
  issuer: string;
  resource: string; // this server's identity; must equal the token `aud`
  issuerPublicKey: Ed25519PublicKey;
  publicPaths?: readonly string[];
  // Shared, injected state. The returned function is NOT pure (it records jti
  // into this Set for replay prevention) but is deterministic given this state.
  replayStore: Set<string>;
  clock?: Clock;
  dpopIatWindowSeconds?: number;
};

export type ProtectedRequest = {
  method: string;
  url: string;
  accessToken?: string;
  dpopProof?: string;
};

function decision(
  d: DelegationDecision['decision'],
  reason: DelegationReason,
): DelegationDecision {
  return { decision: d, reason, basis: 'delegation' };
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function mapTokenError(error: unknown): DelegationDecision {
  if (error instanceof joseErrors.JWTExpired) {
    return decision('NOT_AUTHORIZED', 'expired-token');
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === 'nbf') {
      return decision('NOT_AUTHORIZED', 'not-yet-valid');
    }
    if (error.claim === 'aud') {
      return decision('NOT_AUTHORIZED', 'wrong-resource');
    }
    return decision('NOT_AUTHORIZED', 'invalid-token');
  }
  // Signature failure, wrong issuer, disallowed alg, wrong typ, malformed,
  // or a schema-parse failure — all treated as an invalid token.
  return decision('NOT_AUTHORIZED', 'invalid-token');
}

// Builds a local Resource Server bound to the given state. It demonstrates that
// a server can verify and enforce a limited, signed, audience-restricted,
// sender-constrained delegation — not OAuth, authentication, or consent.
export function createResourceServer(config: ResourceServerConfig) {
  const clock = config.clock ?? realClock;
  const publicPaths = config.publicPaths ?? [];

  return async function authorize(
    request: ProtectedRequest,
  ): Promise<DelegationDecision> {
    const path = requestPath(request.url);

    if (publicPaths.includes(path)) {
      return decision('CAN_PROCEED', 'ok');
    }

    if (request.accessToken === undefined || request.dpopProof === undefined) {
      return decision('NEEDS_USER', 'missing-delegation');
    }

    // 1) Access token: issuer signature, typ, iss, aud, exp/nbf (clock-injected).
    let claims: AccessTokenClaims;
    try {
      const now = clock();
      const { payload } = await jwtVerify(
        request.accessToken,
        config.issuerPublicKey,
        {
          algorithms: [TOKEN_ALG],
          typ: 'at+jwt',
          issuer: config.issuer,
          audience: config.resource,
          currentDate: new Date(now * 1000),
        },
      );
      claims = accessTokenClaimsSchema.parse(payload);
    } catch (error) {
      return mapTokenError(error);
    }

    // 2) DPoP proof: signature (embedded key), header, iat window.
    let dpop;
    try {
      dpop = await verifyDpopProof(request.dpopProof, {
        now: clock(),
        ...(config.dpopIatWindowSeconds !== undefined
          ? { iatWindowSeconds: config.dpopIatWindowSeconds }
          : {}),
      });
    } catch {
      return decision('NOT_AUTHORIZED', 'invalid-dpop');
    }

    // Request binding: the proof must match THIS method, URL and access token.
    if (
      dpop.htm !== request.method ||
      dpop.htu !== canonicalHtu(request.url) ||
      dpop.ath !== accessTokenHash(request.accessToken)
    ) {
      return decision('NOT_AUTHORIZED', 'invalid-dpop');
    }

    // 3) Key binding: the presented key must be the one bound to the token.
    if (dpop.jkt !== claims.cnf.jkt) {
      return decision('NOT_AUTHORIZED', 'key-binding-mismatch');
    }

    // 4) Replay: a given proof (jti) is accepted at most once.
    if (config.replayStore.has(dpop.jti)) {
      return decision('NOT_AUTHORIZED', 'replay-detected');
    }
    config.replayStore.add(dpop.jti);

    // 5) Scope: method + path must be covered by an authorization_detail.
    const samePath = claims.authorization_details.filter(
      (detail) => detail.path === path,
    );
    if (samePath.length === 0) {
      return decision('NOT_AUTHORIZED', 'insufficient-scope');
    }
    if (!samePath.some((detail) => detail.method === request.method)) {
      return decision('NOT_AUTHORIZED', 'wrong-method');
    }

    return decision('CAN_PROCEED', 'ok');
  };
}
