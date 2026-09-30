# AgentProof

AgentProof is a local CLI that diagnoses whether an AI agent can access a web resource — under which identity it was tested, and which observable signal explains the result.

> **Status: experimental.** Access diagnostics are early; declared-policy (robots.txt) evaluation is not implemented yet.

## What it reports

Three separate axes, never collapsed into one:

- **ACCESS** — `accessible` / `denied` / `inconclusive`, plus a `signal` (`ok`, `auth-required`, `access-denied`, `bot-challenge`, `rate-limited`, …).
- **IDENTITY** — `unclaimed` / `claimed` / `verified`. A request carrying `User-Agent: GPTBot` is only a **claimed** GPTBot; it is never presented as the real vendor crawler.
- **POLICY** — currently always `unknown` (declared site policy is evaluated in a later version).

It observes; it never bypasses. It can detect a bot challenge (e.g. `cf-mitigated: challenge`) and report it as inconclusive, but it never attempts to solve or circumvent one.

## Scope

- Defensive diagnostic, run locally.
- Not a proxy, scraper, WAF, crawler, or hosted service. One URL, one GET, no retries, no redirects followed, no discovery.

## Authorization

AgentProof is designed to test only systems you own or have explicit written authorization to test. Do not use it against third-party systems.

## Usage

```bash
npm install
npm run build
node dist/cli/index.js --help
node dist/cli/index.js --version
node dist/cli/index.js validate https://example.com --as unclaimed
node dist/cli/index.js validate https://example.com --as oai-searchbot
node dist/cli/index.js audit   # placeholder
```

During development, `npm run dev -- validate <url> --as <profile>` runs the CLI from source (Node.js 22.18+).

### Agent profiles

Built-in profiles: `unclaimed`, `gptbot`, `oai-searchbot`, `chatgpt-user`, `claudebot`, `claude-searchbot`, `claude-user`.

- `unclaimed` is an identifiable automated client that claims no third-party vendor. It sends the tool's own `User-Agent` (`AgentProof`); it does not imitate a human browser.
- Vendor profiles are always `claimed` — the tool only emits the declared identity, never verifies it.

Each profile also reports a **request fidelity**: `tool` (the AgentProof client), `token-only` (only the documented agent token was sent), or `vendor-documented` (a full documented vendor User-Agent). Every vendor profile is currently `token-only`: no official source confirming the current full UA strings is present in this workspace, and versions drift, so they are not fabricated here. Paste an exact documented UA into `src/identity/profiles.ts` and switch its `requestFidelity` to `vendor-documented`. Sending an official UA still does not make the identity `verified`.

### Exit codes (`validate`)

`0` accessible or denied (a determined result), `2` inconclusive, `3` tool/network error. Being blocked is a valid diagnostic result, not a failure.

An example policy file lives in [`examples/agentproof.yaml`](examples/agentproof.yaml). It is not parsed yet.

## Development

| Script                 | What it does                   |
| ---------------------- | ------------------------------ |
| `npm run build`        | Compile `src/` to `dist/`      |
| `npm run typecheck`    | Type-check `src/` and `test/`  |
| `npm run lint`         | ESLint with type-aware rules   |
| `npm run format:check` | Check formatting with Prettier |
| `npm test`             | Run tests with Vitest          |

## License

[MIT](LICENSE)
