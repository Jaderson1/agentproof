export type AgentPurpose = 'crawl' | 'search' | 'user-fetch' | 'generic';

export type IdentityAssurance = 'unclaimed' | 'claimed' | 'verified';

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
  },
  {
    id: 'gptbot',
    label: 'GPTBot',
    request: { userAgent: 'GPTBot' },
    claim: { provider: 'OpenAI', purpose: 'crawl' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
  },
  {
    id: 'oai-searchbot',
    label: 'OAI-SearchBot',
    request: { userAgent: 'OAI-SearchBot' },
    claim: { provider: 'OpenAI', purpose: 'search' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
  },
  {
    id: 'chatgpt-user',
    label: 'ChatGPT-User',
    request: { userAgent: 'ChatGPT-User' },
    claim: { provider: 'OpenAI', purpose: 'user-fetch' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
  },
  {
    id: 'claudebot',
    label: 'ClaudeBot',
    request: { userAgent: 'ClaudeBot' },
    claim: { provider: 'Anthropic', purpose: 'crawl' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
  },
  {
    id: 'claude-searchbot',
    label: 'Claude-SearchBot',
    request: { userAgent: 'Claude-SearchBot' },
    claim: { provider: 'Anthropic', purpose: 'search' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
  },
  {
    id: 'claude-user',
    label: 'Claude-User',
    request: { userAgent: 'Claude-User' },
    claim: { provider: 'Anthropic', purpose: 'user-fetch' },
    assurance: 'claimed',
    requestFidelity: 'token-only',
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
