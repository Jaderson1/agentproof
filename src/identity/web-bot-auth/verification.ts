export type ExternalVerificationStatus =
  'verified' | 'unverified' | 'malformed' | 'inconclusive';

// Maps the documented Cloudflare Web Bot Auth test-endpoint status to our model.
// 200 = key known and message verified. 401 is AMBIGUOUS — per Cloudflare it can
// mean the key is unknown OR that a known key failed verification — so it is
// reported as 'unverified', never as a specific cause we cannot observe.
// 400 = malformed signature/message. Anything else is inconclusive.
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
      return 'Cloudflare did not verify this request. A 401 can mean that the key is not recognized or that a known key failed verification.';
    case 'malformed':
      return 'The verifier reported the signature or message as malformed.';
    case 'inconclusive':
      return 'The verifier returned an unexpected status; the result is inconclusive.';
  }
}
