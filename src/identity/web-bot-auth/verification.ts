export type ExternalVerificationStatus =
  'verified' | 'unverified' | 'malformed' | 'inconclusive';

// Maps the documented Cloudflare Web Bot Auth test-endpoint status to our model.
// Per Cloudflare's current docs: 200 = key known and message verified; 401 = the
// message was well-formed but the key is not recognized; 400 = otherwise (a
// malformed message, or a recognized key whose signature did not verify). We
// still report 401 as 'unverified' rather than committing to an internal cause.
export function interpretVerifierStatus(
  httpStatus: number,
): ExternalVerificationStatus {
  if (httpStatus === 200) {
    return 'verified';
  }
  if (httpStatus === 401) {
    return 'unverified';
  }
  if (httpStatus === 400) {
    return 'malformed';
  }
  return 'inconclusive';
}

export function verificationExplanation(
  status: ExternalVerificationStatus,
): string {
  switch (status) {
    case 'verified':
      return 'The verifier recognized the key and verified the request signature.';
    case 'unverified':
      return 'Cloudflare did not verify this request. Per its current docs a 401 means the message was well-formed but the key is not (yet) recognized.';
    case 'malformed':
      return 'The verifier rejected the message (a 400 — malformed, or a recognized key whose signature did not verify).';
    case 'inconclusive':
      return 'The verifier returned an unexpected status; the result is inconclusive.';
  }
}
