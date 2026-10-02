import { z } from 'zod';
import type { AuthorizationDecision } from '../authorization/index.ts';

// E2 — delegated authorization (LOCAL demo). This models a user-delegated,
// audience-restricted, sender-constrained credential. It is NOT OAuth in
// production and the issuer here is a test fixture, not an Authorization Server.

export type Clock = () => number; // epoch seconds
export const realClock: Clock = () => Math.floor(Date.now() / 1000);

// Experimental, PROJECT-LOCAL Rich Authorization Request type. This is NOT an
// IETF-registered RAR type — it only has meaning inside AgentProof's local demo.
export const RAR_TYPE = 'https://agentproof.local/rar/http-resource';

export const authorizationDetailSchema = z.object({
  type: z.literal(RAR_TYPE),
  // RFC 9396 common fields:
  locations: z.array(z.string()).min(1),
  actions: z.array(z.string()).min(1),
  // Our type-specific fields:
  path: z.string().min(1),
  method: z.string().min(1),
});
export type AuthorizationDetail = z.infer<typeof authorizationDetailSchema>;

// RFC 9068 JWT access token claims (the ones we rely on), plus RFC 9449 cnf.jkt.
export const accessTokenClaimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  client_id: z.string().min(1),
  iat: z.number(),
  nbf: z.number().optional(),
  exp: z.number(),
  jti: z.string().min(1),
  cnf: z.object({ jkt: z.string().min(1) }),
  authorization_details: z.array(authorizationDetailSchema).min(1),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export type DelegationReason =
  | 'ok'
  | 'missing-delegation'
  | 'invalid-token'
  | 'expired-token'
  | 'not-yet-valid'
  | 'insufficient-scope'
  | 'wrong-resource'
  | 'wrong-method'
  | 'key-binding-mismatch'
  | 'invalid-dpop'
  | 'replay-detected';

// Same SHAPE as the E1 authorization result (reuses AuthorizationDecision), but
// a DISTINCT reason set and a fixed basis, so an HTTP-observation decision (E1)
// and a delegated-authorization decision (E2) are never conflated.
export type DelegationDecision = {
  decision: AuthorizationDecision;
  reason: DelegationReason;
  basis: 'delegation';
};
