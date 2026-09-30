# AgentProof

AgentProof is a local CLI that diagnoses whether an AI agent can access a web resource — under which identity it was tested, and which observable signal explains the result.

> **Status: experimental.** Access diagnostics are early; robots.txt policy evaluation is a conservative MVP (see limitations below).

## What it reports

Three separate axes, never collapsed into one:

- **ACCESS** — `accessible` / `denied` / `inconclusive`, plus a `signal` (`ok`, `auth-required`, `access-denied`, `bot-challenge`, `rate-limited`, …). Observed from the HTTP response to the target URL.
- **IDENTITY** — `unclaimed` / `claimed` / `signed` / `verified`. A request carrying `User-Agent: GPTBot` is only a **claimed** GPTBot; it is never presented as the real vendor crawler. `signed` means AgentProof signed the request with its own key (proof of key possession); `verified` is reserved for external recognition and is never asserted by this tool.
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

Built-in profiles: `unclaimed`, `agentproof-signed`, `gptbot`, `oai-searchbot`, `chatgpt-user`, `claudebot`, `claude-searchbot`, `claude-user`.

- `unclaimed` is an identifiable automated client that claims no third-party vendor. It sends the tool's own `User-Agent` (`AgentProof`); it does not imitate a human browser.
- `agentproof-signed` is AgentProof's own identity, cryptographically signed with a local key (see [Signed identity](#signed-identity-web-bot-auth)). Its assurance is `signed`, never `verified`.
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

## Signed identity (Web Bot Auth)

AgentProof can present **its own** cryptographic identity using the emerging Web Bot Auth mechanism, so an origin that recognizes the key can treat the request as coming from a known agent. This is the officially-supported, verifiable route — not an anti-bot workaround.

> **AgentProof does not bypass WAFs or anti-bot controls.** It never solves challenges, spoofs fingerprints, rotates IPs, or signs as another vendor. If a verifiable AgentProof identity is still blocked, that is a valid result — the next legitimate step is site permission, an API, or an allowlist, not evasion.

The assurance chain is deliberate, and each rung is a strictly stronger claim than the one before — **none of them are equivalent**:

- **CLAIMED** — the request _says_ who it is (a `User-Agent`/metadata). No proof.
- **SIGNED** — the request _proves possession_ of the AgentProof private key (Ed25519 signature). Still no external recognition.
- **EXTERNALLY VERIFIED** — Cloudflare successfully verified that signed request against a key it recognizes. AgentProof only reports this from real evidence (the verifier test), never inferred from a target returning HTTP 200.
- **AUTHORIZED** — the target site chooses to allow the agent.

In particular: **Cloudflare verified ≠ site authorization.** A recognized identity can still be denied, and that is a valid result.

### Specs implemented

- **RFC 9421** HTTP Message Signatures (signature base, `Signature-Input`, `Signature`); **RFC 8037** Ed25519 (`OKP`) JWK; **RFC 7638** SHA-256 JWK thumbprint for the `keyid`.
- **CURRENT WG SPEC — `draft-ietf-webbotauth-httpsig-protocol-00`** (2026-09-01): the Web Bot Auth protocol, now including the key directory (formerly `draft-meunier-http-message-signatures-directory`). Agent-request `tag="web-bot-auth"`; directory-response `tag="http-message-signatures-directory"`.
- **CLOUDFLARE CURRENT IMPLEMENTATION** — Cloudflare's live Web Bot Auth verifier docs. This is the **source of truth for the registration/test flow** AgentProof targets, and it currently diverges from the WG draft in two places below.

> **Divergences (Cloudflare wins for our flow — we never mix the two):**
>
> 1. **`Signature-Agent` wire format.** The WG draft mandates a _Dictionary_ form (`sig="https://…"`). Cloudflare's verifier requires the legacy **sf-string** form (`Signature-Agent: "https://…"`) and explicitly rejects the Dictionary form. AgentProof emits the sf-string form; the mode is named `cloudflare-compat` and isolated in `src/identity/web-bot-auth/sign.ts` (`SIGNATURE_AGENT_WIRE_FORMAT`) so the serialization can change without touching key storage or the crypto.
> 2. **Directory-response covered components.** The WG draft (Appendix B.1) signs `("@authority";req "content-digest")`. Cloudflare's verifier signs **`("@authority";req)` only** — no `Content-Digest`. AgentProof implements the Cloudflare components; if Cloudflare adopts `content-digest`, it is a localized change in the same file.

### Commands

```bash
# 1. Generate a local identity (private key stays in .agentproof/, mode 0600)
agentproof identity init --signature-agent https://your-domain.example

# 2a. Print the PUBLIC key directory body (JWKS, no private key)
agentproof identity export-directory > http-message-signatures-directory.json

# 2b. Print the SIGNED response headers your server must return for that body
agentproof identity directory-response --authority your-domain.example

# 3. Ask the official verifier whether your key is recognized
agentproof identity test

# 4. Send a signed request while diagnosing a target
agentproof validate https://example.com --as agentproof-signed --identity .agentproof/identity.json
```

The private key is never printed, never sent to a verifier, and never written into the exported directory, the directory-response headers, the report, or JSON output. `.agentproof/` and `*.private.{jwk,pem}` are git-ignored.

`identity test` exit codes: `0` verified, `2` unverified or inconclusive, `3` malformed signature or network error. A **`401` is read as `unverified`, never as a specific cause** — per Cloudflare it can mean the key is unrecognized _or_ that a known key failed verification, and AgentProof does not guess which.

### The key directory is a _signed response_, not just a file

This is the part v1 got wrong. Cloudflare does not merely fetch a JWKS file — it verifies that the directory response itself is **signed by a key listed in it** (proof of possession). So the origin must return, for the directory body:

```http
Content-Type: application/http-message-signatures-directory+json
Signature-Input: sig1=("@authority";req);created=<ts>;expires=<ts>;keyid="<thumbprint>";tag="http-message-signatures-directory"
Signature: sig1=:<base64 ed25519 signature>:
```

`agentproof identity directory-response --authority <host>` produces exactly these headers (the body comes from `export-directory`). It is a **distinct use of the same key** from agent-request signing, with a different tag — the two are never conflated.

### Hosting the key directory (honestly)

The directory must be reachable at the **origin root** well-known path of your `Signature-Agent` value:

```
https://your-domain.example/.well-known/http-message-signatures-directory
```

Because the response must be **signed** (not just served with the right `Content-Type`), a plain static host is **not sufficient on its own**. Minimal legitimate options:

- **Dynamic (recommended): a Cloudflare Worker / Pages Function or your own small server** that returns the JWKS body with the `Content-Type`, `Signature-Input`, and `Signature` headers. The private key lives as a runtime secret (e.g. a Worker secret binding), never in git. This re-signs freely, so expiry is a non-issue.
- **Static with pre-computed headers (possible, with caveats):** host the `export-directory` body and attach the `directory-response` headers (e.g. Cloudflare Pages `_headers`, or any host that lets you set arbitrary response headers).
  - **How long:** only until the signature's `expires` (default 7 days; `--expires-in <seconds>` to change).
  - **How `expires` is renewed:** re-run `identity directory-response` and redeploy the new headers **before** the old ones lapse — e.g. a daily scheduled CI job.
  - **Limitations:** if you miss a refresh, verification fails until you redeploy; clock skew eats into the window; and GitHub Pages is unsuitable anyway (it can set neither the media type nor a root `/.well-known/` path on a project site).

AgentProof only generates the correct body and headers. It does **not** host them, run a server, or deploy anything.

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
