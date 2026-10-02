import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Ed25519PrivateKey } from './keys.ts';
import { realClock, type AuthorizationDetail, type Clock } from './model.ts';

// LOCAL DELEGATION ISSUER — a TEST FIXTURE that stands in for a future
// Authorization Server. It performs NO user authentication and NO real consent;
// it simply mints a signed, audience-restricted, key-bound access token so the
// Resource Server and the protocol can be exercised locally.
const JWT_ALG = 'Ed25519';

export type DelegationGrant = {
  issuer: string;
  subject: string; // the user (local fixture, e.g. "user-123")
  clientId: string; // the agent client (local fixture, e.g. "agentproof-test-agent")
  resource: string; // RFC 8707 resource indicator -> token `aud`
  dpopJkt: string; // RFC 9449 cnf.jkt (thumbprint of the DPoP public key)
  authorizationDetails: readonly AuthorizationDetail[];
  ttlSeconds: number;
  notBeforeOffsetSeconds?: number; // relative to iat; >0 makes the token not-yet-valid
};

function randomJti(): string {
  return randomBytes(16).toString('base64url'); // 128 bits
}

export async function issueAccessToken(
  signingKey: Ed25519PrivateKey,
  grant: DelegationGrant,
  clock: Clock = realClock,
): Promise<string> {
  const iat = clock();
  const nbf = iat + (grant.notBeforeOffsetSeconds ?? 0);
  const exp = iat + grant.ttlSeconds;
  return new SignJWT({
    client_id: grant.clientId,
    cnf: { jkt: grant.dpopJkt },
    authorization_details: [...grant.authorizationDetails],
  })
    .setProtectedHeader({ alg: JWT_ALG, typ: 'at+jwt' })
    .setIssuer(grant.issuer)
    .setSubject(grant.subject)
    .setAudience(grant.resource)
    .setIssuedAt(iat)
    .setNotBefore(nbf)
    .setExpirationTime(exp)
    .setJti(randomJti())
    .sign(signingKey);
}
