# AgentProof

AgentProof is a local CLI that diagnoses whether an AI agent can access a web resource — under which identity it was tested, and which observable signal explains the result.

> **Status: experimental.** Access diagnostics are early; robots.txt policy evaluation is a conservative MVP (see limitations below).

## What it reports

Four separate axes, never collapsed into one:

- **ACCESS** — `accessible` / `denied` / `inconclusive`, plus a `signal` (`ok`, `auth-required`, `access-denied`, `bot-challenge`, `rate-limited`, …). Observed from the HTTP response to the target URL.
- **IDENTITY** — `unclaimed` / `claimed` / `signed` / `verified`. A request carrying `User-Agent: GPTBot` is only a **claimed** GPTBot; it is never presented as the real vendor crawler. `signed` means AgentProof signed the request with its own key (proof of key possession); `verified` is reserved for external recognition and is never asserted by this tool.
- **POLICY** — `allowed` / `disallowed` / `unknown`, derived from the site's `robots.txt`. This is the site's **declared** preference for the chosen agent; it never proves or predicts actual access.
- **AUTHORIZATION** — the AI-facing verdict (see below), one of `CAN_PROCEED` / `NEEDS_USER` / `NOT_AUTHORIZED` / `INFRA_PROBLEM` / `AMBIGUOUS`, synthesised from the other axes. It never implies permission the other axes didn't show.

The axes are independent: a resource can be `POLICY allowed` yet `ACCESS denied`, or `POLICY disallowed` yet `ACCESS accessible`. Reporting that divergence is the point — the axes are never merged.

### Authorization decision axis

A single verdict an AI can act on, with a machine `reason` and a `basis` (`http` or `robots`):

- `CAN_PROCEED` — a successful response with no conflicting signal.
- `NEEDS_USER` — the request needs the human: authentication (`401`), a login/MFA redirect, or an **interactive bot challenge / CAPTCHA**. A challenge outranks everything (even a `200`), and AgentProof never tries to solve or evade it — it stops and reports.
- `NOT_AUTHORIZED` — the agent is not authorized. With `basis: "robots"` this means **not authorized by the site's _declared_ policy**: per [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), `robots.txt` is a declared crawler preference, **not** an HTTP access-authorization mechanism — so a `robots` denial is not the same as an HTTP `401`/`403`. Declared policy is an independent axis; a future user-delegation step must **not** silently override it.
- `INFRA_PROBLEM` — transient (`429`, `5xx`, origin/edge errors).
- `AMBIGUOUS` — cannot be determined safely: a cross-origin redirect, a same-origin **redirect that was observed but not followed** (`validate` does not follow redirects, so the final resource was not accessed), a forbidden response behind an edge/WAF with no determinable cause, or an unrecognised response.

This axis only reads signals AgentProof already collects; it does not scrape HTML to detect CAPTCHAs.

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

# List selectable identities (for an agent to choose ONE before a request)
agentproof identity list --json
```

`identity list` reports the built-in profiles with honest flags: vendor profiles are `diagnosticOnly` (present only to diagnose how a site treats that claimed UA, never to impersonate), and nothing is ever marked `verified`. The intended flow is **discover → choose one authorized identity → one request**, never "try one, then fake another until something passes".

The private key is never printed, never sent to a verifier, and never written into the exported directory, the directory-response headers, the report, or JSON output. `.agentproof/` and `*.private.{jwk,pem}` are git-ignored. `identity init` refuses to overwrite an existing identity unless `--force`, so a stray re-run cannot silently destroy a registered key.

`identity test` exit codes: `0` verified, `2` unverified or inconclusive, `3` malformed signature or network error. Per Cloudflare's current docs, **`200`** = key known and message verified, **`401`** = message well-formed but key not (yet) recognized, **`400`** = otherwise (malformed, or a recognized key whose signature did not verify). AgentProof reports a `401` as **`unverified`** — a verification outcome, not a claim about the verifier's internal state.

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

Because the response must be **signed** (not just served with the right `Content-Type`), a plain static host with no header control is **not sufficient**. The recommended deployment is a **secretless Cloudflare Worker** ([`deploy/cloudflare-worker/`](deploy/cloudflare-worker/)):

- The directory-response signature is **not per-request**, so it is signed **locally** by the CLI and only its **public** result (body + `Signature-Input` + `Signature`) is served. **The private key never reaches the edge** — the Worker holds only public data, has no signing route and no proxy, and 404s everything but the well-known path.
- **How long / renewal:** the signature carries an `expires` (default 7 days; `--expires-in <seconds>`). Re-run `identity directory-response` and update the Worker's variables **before** it lapses (a scheduled CI job is simplest). If you miss the window, verification fails until you redeploy.
- **Domain:** a `*.workers.dev` subdomain works for the crawltest test and is not prohibited for submission; a custom domain is a durability/reputation choice, not a requirement.
- **Zero-code alternative:** Cloudflare Pages with a `_headers` rule can serve the same body and headers. Plain GitHub Pages cannot (no custom media type, no root `/.well-known/` on a project site).

> A Worker that instead holds the private key and signs per request buys nothing here (the signature is not per-request) and only widens key exposure, so AgentProof does **not** do that.

AgentProof only generates the correct body and headers and ships the Worker source. It does **not** host anything, run a server, or deploy on your behalf.

### Threat model (this phase)

| Risk                                         | Mitigation                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Private-key leak                             | Key is generated and used only locally, stored `0600` under git-ignored `.agentproof/`, and never in outputs, the patch, logs, the Worker, or the directory. |
| Compromised Worker / stolen public directory | The edge holds only public data; it cannot sign and there is nothing secret to steal.                                                                        |
| Signing oracle                               | The Worker has **no** signing route — only `GET` of the well-known path; everything else 404s.                                                               |
| Replay of a signed agent request             | Short validity window (`created`/`expires`, default 5 min) plus a fresh 64-byte `nonce` per request.                                                         |
| Stale directory signature                    | Bounded by `expires`; documented refresh-before-lapse. Failure mode is "unverified", never a silent wrong "verified".                                        |
| Identity abuse / revocation                  | Per-user keys (each user runs their own directory): one key can be rotated/revoked without affecting anyone else — the opposite of a shared global key.      |
| Unauthorized agent use                       | The private key stays with its owner; `identity list` steers agents to choose one authorized identity rather than cycle through impersonations.              |

## Delegated authorization (E2, local)

E2 adds the layer between "this agent is who it says it is" and "this agent is authorized by the user to do this". It is a **local, offline demonstration** built on existing standards — not a new token format.

**Three keys, three layers** (kept strictly separate):

- **AgentProof Identity Key** → HTTP Message Signatures / Web Bot Auth → _who the agent is_ (IDENTITY). Untouched by E2.
- **DPoP Key** → the DPoP proof → _possession of the key bound to the token_ (PROOF-OF-POSSESSION).
- **Issuer Key** → signs the access token → _what the user delegated_ (AUTHORIZATION).

So `SIGNED ≠ AUTHORIZED` and `EXTERNALLY VERIFIED ≠ USER AUTHORIZED`: holding a key never grants authorization — only a user-delegated, key-bound token does.

**Standards used:** JWT access token ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068), `typ: at+jwt`) with `iss/sub/aud/client_id/iat/nbf/exp/jti`; audience restriction via the Resource Indicator ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) → `aud`; granularity via Rich Authorization Requests ([RFC 9396](https://www.rfc-editor.org/rfc/rfc9396)) `authorization_details`; sender-constraint via DPoP ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449), `cnf.jkt` + proof `htm/htu/ath/iat/jti`); `alg: Ed25519` ([RFC 9864](https://www.rfc-editor.org/rfc/rfc9864)); [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725) JWT BCP (explicit algorithm allowlist, never `none`). Signing/verification use the [`jose`](https://github.com/panva/jose) library — no hand-rolled JOSE.

- `resource`/`aud` decides **which** Resource Server may accept the token; `authorization_details` decides **what** it may do there.
- The `authorization_details` `type` (`https://agentproof.local/rar/http-resource`) is an **experimental, project-local identifier — not an IETF-registered RAR type**.

**What E2 demonstrates:** a Resource Server can verify and enforce a limited, signed, audience-restricted, sender-constrained delegation. **What it does NOT:** real OAuth, real user authentication, or real consent. The issuer is a **local test fixture / delegation issuer**, not a production Authorization Server. The Resource Server is a local, in-process function (no network, no DB); its replay store is an in-memory `Set<jti>` (not distributed) and its clock is injectable.

Delegated decisions reuse the E1 `decision` vocabulary with a distinct reason set and `basis: "delegation"` (so an HTTP-observation decision and a delegated-authorization decision are never conflated): `ok`, `missing-delegation`, `invalid-token`, `expired-token`, `not-yet-valid`, `insufficient-scope`, `wrong-resource`, `wrong-method`, `key-binding-mismatch`, `invalid-dpop`, `replay-detected`. A protected resource with no delegation is **`NEEDS_USER` / `missing-delegation`** (the next step is to obtain the user's consent), distinct from a _presented-but-failed_ credential, which is `NOT_AUTHORIZED`.

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
