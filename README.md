# AgentProof

AgentProof is a local CLI that diagnoses whether an AI agent can access a web resource — under which identity it was tested, and which observable signal explains the result.

> **Status: experimental.** Access diagnostics are early; robots.txt policy evaluation is a conservative MVP (see limitations below).

## What it reports

Three separate axes, never collapsed into one:

- **ACCESS** — `accessible` / `denied` / `inconclusive`, plus a `signal` (`ok`, `auth-required`, `access-denied`, `bot-challenge`, `rate-limited`, …). Observed from the HTTP response to the target URL.
- **IDENTITY** — `unclaimed` / `claimed` / `verified`. A request carrying `User-Agent: GPTBot` is only a **claimed** GPTBot; it is never presented as the real vendor crawler.
- **POLICY** — `allowed` / `disallowed` / `unknown`, derived from the site's `robots.txt`. This is the site's **declared** preference for the chosen agent; it never proves or predicts actual access.

The three axes are independent: a resource can be `POLICY allowed` yet `ACCESS denied`, or `POLICY disallowed` yet `ACCESS accessible`. Reporting that divergence is the point — the axes are never merged.

It observes; it never bypasses. It can detect a bot challenge (e.g. `cf-mitigated: challenge`) and report it as inconclusive, but it never attempts to solve or circumvent one, and it never tries a `Disallow`ed path a different way.

## Scope

- Defensive diagnostic, run locally.
- Not a proxy, scraper, WAF, crawler, or hosted service. At most two GETs per run — one for `<origin>/robots.txt`, one for the target — with no retries, no redirects followed, and no link or path discovery.

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
node dist/cli/index.js validate https://example.com --as oai-searchbot --json
node dist/cli/index.js audit   # placeholder
```

With `--json`, stdout carries only a single JSON object (the same data as the text report — `url`, `profile`, `access`, `policy`, `limitations`), with no decoration, so another program can `JSON.parse` it directly. Operational messages go to stderr.

During development, `npm run dev -- validate <url> --as <profile>` runs the CLI from source (Node.js 22.18+).

### Agent profiles

Built-in profiles: `unclaimed`, `gptbot`, `oai-searchbot`, `chatgpt-user`, `claudebot`, `claude-searchbot`, `claude-user`.

- `unclaimed` is an identifiable automated client that claims no third-party vendor. It sends the tool's own `User-Agent` (`AgentProof`); it does not imitate a human browser.
- Vendor profiles are always `claimed` — the tool only emits the declared identity, never verifies it.

Each profile also reports a **request fidelity**: `tool` (the AgentProof client), `token-only` (only the documented agent token was sent), or `vendor-documented` (a full documented vendor User-Agent). Every vendor profile is currently `token-only`: no official source confirming the current full UA strings is present in this workspace, and versions drift, so they are not fabricated here. Paste an exact documented UA into `src/identity/profiles.ts` and switch its `requestFidelity` to `vendor-documented`. Sending an official UA still does not make the identity `verified`.

### Policy (robots.txt)

For a target such as `https://example.com/docs/page`, AgentProof consults exactly `https://example.com/robots.txt` (same origin) and evaluates it for the profile's product token (`unclaimed` → `AgentProof`, `oai-searchbot` → `OAI-SearchBot`, …). The result is `allowed`, `disallowed`, or `unknown`, with the matched rule reported as evidence.

Three principles hold:

- **ACCESS ≠ POLICY.** `robots.txt` is declarative evidence, not proof of access. A determined policy never implies the request will (or won't) actually succeed.
- **claimed ≠ verified.** Policy matching uses the declared product token; it does not authenticate the agent.
- **Conservative, never guessing.** When robots.txt cannot be used as evidence — missing, non-2xx, oversized (> 512 KiB), timed out, no group applies to the agent, or a rule uses unsupported pattern syntax — the result is `unknown`, never a fabricated verdict. A failed `robots.txt` fetch on its own does not fail the validation.

How a group is evaluated follows the Robots Exclusion Protocol default: once a group applies to the agent (a specific match, otherwise `*`), a path that no rule disallows is **`allowed`** — including when the group's only directive is an empty `Disallow:`, which imposes no restriction. Rules from **every** group naming the agent are combined.

**Fetch-error semantics are a deliberate product choice, not RFC 9309.** A real crawler has operational fallback behaviour for a missing or unreachable robots.txt; AgentProof instead reports `unknown`, because it describes the declarative evidence it actually observed rather than acting as a crawler.

This is a deliberately small MVP, **not** full RFC 9309 conformance: it reads only `User-agent`, `Allow`, and `Disallow`; groups by user-agent (combining repeated groups); matches by longest path prefix with allow-winning ties; and matches agent tokens case-insensitively but by exact token (no prefix/substring matching). It does **not** implement `*`/`$` path patterns — a group containing such a rule is reported as `unknown` (with a limitation) rather than matched literally.

### Exit codes (`validate`)

`0` accessible or denied (a determined result), `2` inconclusive, `3` tool/network error. Being blocked is a valid diagnostic result, not a failure. A `robots.txt` fetch failure alone is not fatal — policy becomes `unknown` and the run continues.

An example policy file lives in [`examples/agentproof.yaml`](examples/agentproof.yaml). It is a separate concept (an owner-authored audit policy) and is not parsed by `validate`.

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
