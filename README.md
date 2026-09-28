# AgentProof

AgentProof is a local CLI for testing whether declared AI-agent access policies match real-world enforcement.

> **Status: experimental.** Nothing is implemented yet beyond the CLI skeleton.

## Scope

- Defensive tool, run locally by the site operator.
- Not a proxy, not a scraper, not a WAF, not a hosted service.

## Authorization

AgentProof is designed to test only systems you own or have explicit written authorization to test. Do not use it against third-party systems.

## Usage

```bash
npm install
npm run build
node dist/cli/index.js --help
node dist/cli/index.js --version
node dist/cli/index.js audit   # prints a placeholder message
```

During development, `npm run dev -- --help` runs the CLI from source (Node.js 22.18+).

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
