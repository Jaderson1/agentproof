export type AgentPurpose = 'crawl' | 'search' | 'user-fetch' | 'generic';

export type IdentityAssurance = 'unclaimed' | 'claimed' | 'signed' | 'verified';

export type RequestIdentityFidelity =
  'tool' | 'vendor-documented' | 'token-only';

export type AgentProfile = {
  id: string;
  label: string;
  request: {
    userAgent?: string;
    headers?: Readonly<Record<string, string>>;
  };
  claim: {
    provider?: string;
    purpose?: AgentPurpose;
  };
  assurance: IdentityAssurance;
  requestFidelity: RequestIdentityFidelity;
  // Product token used for robots.txt group matching (data, not derived).
  robotsUserAgent: string;
};

// Vendor profiles carry the bare product token, not a full vendor UA string:
// no official source is present in this workspace to confirm the current
// documented strings, and versions drift. They are marked 'token-only'. When a
// documented UA is available, paste it here and switch requestFidelity to
// 'vendor-documented'. Emitting an official UA never makes the identity verified.
const PROFILES: readonly AgentProfile[] = [
  {
    id: 'unclaimed',
    label: 'AgentProof generic client',
    request: {},
    claim: {},
    assurance: 'unclaimed',
    requestFidelity: 'tool',
    robotsUserAgent: 'AgentProof',
  },
  {
    // AgentProof's own identity, cryptographically signed with our key.
    // 'signed' proves possession of the key, not external recognition — it is
    // never 'verified' until a verifier (e.g. Cloudflare) confirms the key.
    id: 'agentproof-signed',
    label: 'AgentProof signed agent',
    request: {},
    claim: {},
    assurance: 'signed',
    requestFidelity: 'tool',
    robotsUserAgent: 'AgentProof',
  },
  {
    id: 'gptbot',
    label: 'GPTBot',
    request: { userAgent: 'GPTBot' },
    claim: { provider: 'OpenAI', purpose: 'crawl' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
    robotsUserAgent: 'GPTBot',
  },
  {
    id: 'oai-searchbot',
    label: 'OAI-SearchBot',
    request: { userAgent: 'OAI-SearchBot' },
    claim: { provider: 'OpenAI', purpose: 'search' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
    robotsUserAgent: 'OAI-SearchBot',
  },
  {
    id: 'chatgpt-user',
    label: 'ChatGPT-User',
    request: { userAgent: 'ChatGPT-User' },
    claim: { provider: 'OpenAI', purpose: 'user-fetch' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
    robotsUserAgent: 'ChatGPT-User',
  },
  {
    id: 'claudebot',
    label: 'ClaudeBot',
    request: { userAgent: 'ClaudeBot' },
    claim: { provider: 'Anthropic', purpose: 'crawl' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
    robotsUserAgent: 'ClaudeBot',
  },
  {
    id: 'claude-searchbot',
    label: 'Claude-SearchBot',
    request: { userAgent: 'Claude-SearchBot' },
    claim: { provider: 'Anthropic', purpose: 'search' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
    robotsUserAgent: 'Claude-SearchBot',
  },
  {
    id: 'claude-user',
    label: 'Claude-User',
    request: { userAgent: 'Claude-User' },
    claim: { provider: 'Anthropic', purpose: 'user-fetch' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
    robotsUserAgent: 'Claude-User',
  },
];

export function getAgentProfile(id: string): AgentProfile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}

export function listAgentProfiles(): readonly AgentProfile[] {
  return PROFILES;
}

export function buildRequestHeaders(
  profile: AgentProfile,
): Record<string, string> {
  const headers: Record<string, string> = { ...profile.request.headers };
  if (profile.request.userAgent !== undefined) {
    headers['user-agent'] = profile.request.userAgent;
  }
  return headers;
}
