import { describe, expect, it } from 'vitest';
import {
  buildRequestHeaders,
  getAgentProfile,
  listAgentProfiles,
  type AgentProfile,
} from '../src/identity/index.ts';

function profile(id: string): AgentProfile {
  const found = getAgentProfile(id);
  if (found === undefined) {
    throw new Error(`missing test profile: ${id}`);
  }
  return found;
}

describe('agent profiles', () => {
  it('marks the unclaimed profile as unclaimed, tool fidelity, no vendor claim', () => {
    const unclaimed = profile('unclaimed');
    expect(unclaimed.assurance).toBe('unclaimed');
    expect(unclaimed.requestFidelity).toBe('tool');
    expect(unclaimed.claim.provider).toBeUndefined();
    expect(buildRequestHeaders(unclaimed)).toEqual({});
  });

  it('marks vendor profiles as claimed, never verified', () => {
    for (const id of ['gptbot', 'oai-searchbot', 'claudebot', 'claude-user']) {
      expect(profile(id).assurance).toBe('claimed');
    }
    for (const candidate of listAgentProfiles()) {
      expect(candidate.assurance).not.toBe('verified');
    }
  });

  it('marks vendor profiles as token-only fidelity', () => {
    for (const candidate of listAgentProfiles()) {
      if (candidate.assurance === 'claimed') {
        expect(candidate.requestFidelity).toBe('token-only');
      }
    }
  });

  it('sends the claimed User-Agent for a vendor profile', () => {
    expect(buildRequestHeaders(profile('oai-searchbot'))).toEqual({
      'user-agent': 'OAI-SearchBot',
    });
  });

  it('returns undefined for an unknown profile', () => {
    expect(getAgentProfile('does-not-exist')).toBeUndefined();
  });
});
