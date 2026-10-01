import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { exitCodeForStatus } from '../audit/index.ts';
import { probeHttp } from '../http/index.ts';
import {
  buildRequestHeaders,
  getAgentProfile,
  listAgentProfiles,
} from '../identity/index.ts';
import {
  buildKeyDirectory,
  DIRECTORY_MEDIA_TYPE,
  DIRECTORY_WELL_KNOWN_PATH,
  generateIdentity,
  interpretVerifierStatus,
  loadIdentity,
  saveIdentity,
  signDirectoryResponse,
  signRequest,
  verificationExplanation,
  type ExternalVerificationStatus,
  type StoredIdentity,
  type WebBotAuthHeaders,
} from '../identity/web-bot-auth/index.ts';
import { evaluateRobotsPolicy, fetchRobots } from '../robots/index.ts';
import {
  buildValidationReport,
  renderValidationReport,
  validationExitCode,
  type ReportIdentity,
} from '../validation/index.ts';

export type ProgramOptions = {
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  setExitCode: (code: number) => void;
};

const DEFAULT_IDENTITY_DIR = '.agentproof';
const DEFAULT_IDENTITY_FILE = join(DEFAULT_IDENTITY_DIR, 'identity.json');
const DEFAULT_TEST_ENDPOINT = 'https://crawltest.com/cdn-cgi/web-bot-auth';
const SIGNATURE_VALIDITY_SECONDS = 300;
const DIRECTORY_VALIDITY_SECONDS_DEFAULT = 7 * 24 * 60 * 60;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Signs the target request with the identity's private key. created/expires give
// a short validity window and the nonce is fresh per call.
function createSignedHeaders(
  identity: StoredIdentity,
  targetUrl: string,
  signatureAgent: string,
): WebBotAuthHeaders {
  const created = Math.floor(Date.now() / 1000);
  return signRequest(identity.privateJwk, {
    targetUrl,
    signatureAgent,
    keyid: identity.keyid,
    created,
    expires: created + SIGNATURE_VALIDITY_SECONDS,
    nonce: randomBytes(64).toString('base64url'),
  });
}

type SignResolution =
  { ok: true; headers: WebBotAuthHeaders } | { ok: false; error: string };

function resolveSignedHeaders(
  targetUrl: string,
  identityPath: string | undefined,
  signatureAgentOverride: string | undefined,
): SignResolution {
  if (identityPath === undefined) {
    return {
      ok: false,
      error:
        'The agentproof-signed profile requires --identity <path>. Create one with: agentproof identity init',
    };
  }
  let identity: StoredIdentity;
  try {
    identity = loadIdentity(identityPath);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  const signatureAgent = signatureAgentOverride ?? identity.signatureAgent;
  if (signatureAgent === undefined) {
    return {
      ok: false,
      error:
        'No Signature-Agent URL is set. Re-run: agentproof identity init --signature-agent https://your-domain, or pass --signature-agent.',
    };
  }
  try {
    return {
      ok: true,
      headers: createSignedHeaders(identity, targetUrl, signatureAgent),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function identityTestExitCode(status: ExternalVerificationStatus): number {
  if (status === 'verified') {
    return 0;
  }
  if (status === 'malformed') {
    return 3;
  }
  return 2;
}

export function createProgram({
  version,
  stdout,
  stderr,
  setExitCode,
}: ProgramOptions): Command {
  const program = new Command();

  program
    .name('agentproof')
    .description(
      'Diagnose whether an AI agent can access a web resource, and why.',
    )
    .version(version)
    .configureOutput({ writeOut: stdout, writeErr: stderr });

  program
    .command('audit')
    .description('Run an audit (not implemented yet).')
    .action(() => {
      stdout('AgentProof audit is not implemented yet.\n');
      setExitCode(exitCodeForStatus('inconclusive'));
    });

  program
    .command('validate')
    .description('Diagnose access to a URL under one agent profile.')
    .argument('<url>', 'the URL to request')
    .option('--as <profile>', 'agent profile id', 'unclaimed')
    .option('--json', 'emit the diagnosis as JSON on stdout', false)
    .option(
      '--identity <path>',
      'path to a local AgentProof identity file (for signed profiles)',
    )
    .option(
      '--signature-agent <url>',
      'https URL of the origin hosting your key directory (overrides the identity file)',
    )
    .action(
      async (
        url: string,
        options: {
          as: string;
          json: boolean;
          identity?: string;
          signatureAgent?: string;
        },
      ) => {
        const fail = (detail: string): void => {
          if (options.json) {
            stdout(`${JSON.stringify({ error: detail })}\n`);
          } else {
            stderr(`${detail}\n`);
          }
          setExitCode(3);
        };

        const profile = getAgentProfile(options.as);
        if (profile === undefined) {
          if (options.json) {
            stdout(
              `${JSON.stringify({ error: `Unknown profile: ${options.as}` })}\n`,
            );
          } else {
            const ids = listAgentProfiles()
              .map((candidate) => candidate.id)
              .join(', ');
            stderr(`Unknown profile: ${options.as}\n`);
            stderr(`Available profiles: ${ids}\n`);
          }
          setExitCode(3);
          return;
        }

        let signedHeaders: WebBotAuthHeaders | undefined;
        let reportIdentity: ReportIdentity | undefined;
        if (profile.assurance === 'signed') {
          const resolved = resolveSignedHeaders(
            url,
            options.identity,
            options.signatureAgent,
          );
          if (!resolved.ok) {
            fail(resolved.error);
            return;
          }
          signedHeaders = resolved.headers;
          reportIdentity = {
            signature: 'present',
            externalVerification: 'not-confirmed',
          };
        }

        const baseHeaders = buildRequestHeaders(profile);
        // robots.txt is best-effort and always fetched unsigned; its failure
        // alone yields policy 'unknown', never a fatal exit.
        const robots = await fetchRobots(url, { headers: baseHeaders });

        try {
          const observation = await probeHttp(url, {
            headers: { ...baseHeaders, ...(signedHeaders ?? {}) },
          });
          const policy = evaluateRobotsPolicy(
            robots,
            profile.robotsUserAgent,
            url,
          );
          const report = buildValidationReport(
            url,
            profile,
            observation,
            policy,
            reportIdentity,
          );
          stdout(
            options.json
              ? `${JSON.stringify(report)}\n`
              : `${renderValidationReport(report)}\n`,
          );
          setExitCode(validationExitCode(report));
        } catch (error) {
          fail(errorMessage(error));
        }
      },
    );

  const identity = program
    .command('identity')
    .description('Manage the AgentProof signing identity (Web Bot Auth).');

  identity
    .command('init')
    .description(
      'Generate a local Ed25519 identity. The private key stays local.',
    )
    .option(
      '--dir <dir>',
      'directory to store the identity',
      DEFAULT_IDENTITY_DIR,
    )
    .option(
      '--signature-agent <url>',
      'https URL of the origin that will host your key directory',
    )
    .option('--force', 'overwrite an existing identity file', false)
    .action(
      (options: { dir: string; signatureAgent?: string; force: boolean }) => {
        const path = join(options.dir, 'identity.json');
        // Never silently destroy an existing (possibly already-registered) key.
        if (!options.force && existsSync(path)) {
          stderr(
            `Refusing to overwrite an existing identity at ${path}. Re-run with --force to replace it (this discards the current key).\n`,
          );
          setExitCode(3);
          return;
        }
        const generated = generateIdentity();
        const record: StoredIdentity = {
          version: 1,
          algorithm: 'ed25519',
          keyid: generated.keyid,
          ...(options.signatureAgent !== undefined
            ? { signatureAgent: options.signatureAgent }
            : {}),
          privateJwk: generated.privateJwk,
          publicJwk: generated.publicJwk,
        };
        try {
          saveIdentity(path, record);
        } catch (error) {
          stderr(`${errorMessage(error)}\n`);
          setExitCode(3);
          return;
        }
        stdout(
          `AgentProof identity created.\nKey ID: ${generated.keyid}\nStored: ${path} (contains your PRIVATE key — do not commit or share)\n`,
        );
        if (options.signatureAgent === undefined) {
          stdout(
            'No Signature-Agent set. Re-run with --signature-agent https://your-domain once you know where the directory will be hosted.\n',
          );
        }
      },
    );

  identity
    .command('export-directory')
    .description(
      'Print the PUBLIC key directory (JWKS) to host. No private key.',
    )
    .option(
      '--identity <path>',
      'path to the identity file',
      DEFAULT_IDENTITY_FILE,
    )
    .option(
      '--out <path>',
      'write the directory JSON to this file instead of stdout',
    )
    .action((options: { identity: string; out?: string }) => {
      let record: StoredIdentity;
      try {
        record = loadIdentity(options.identity);
      } catch (error) {
        stderr(`${errorMessage(error)}\n`);
        setExitCode(3);
        return;
      }
      const directory = buildKeyDirectory([record.publicJwk]);
      const json = `${JSON.stringify(directory, null, 2)}\n`;
      if (options.out !== undefined) {
        try {
          writeFileSync(options.out, json);
        } catch (error) {
          stderr(`${errorMessage(error)}\n`);
          setExitCode(3);
          return;
        }
        stdout(`Wrote public key directory to ${options.out}\n`);
      } else {
        stdout(json);
      }
      stderr(
        `Host this exactly at: <your Signature-Agent origin>${DIRECTORY_WELL_KNOWN_PATH}\nServe it with Content-Type: ${DIRECTORY_MEDIA_TYPE}\n`,
      );
    });

  identity
    .command('directory-response')
    .description(
      'Print the signed HTTP response headers a server must return for the key directory.',
    )
    .option(
      '--identity <path>',
      'path to the identity file',
      DEFAULT_IDENTITY_FILE,
    )
    .option(
      '--authority <host>',
      'authority (host) serving the directory; defaults to the Signature-Agent host',
    )
    .option(
      '--expires-in <seconds>',
      'signature validity window in seconds',
      String(DIRECTORY_VALIDITY_SECONDS_DEFAULT),
    )
    .option('--json', 'emit the result as JSON on stdout', false)
    .action(
      (options: {
        identity: string;
        authority?: string;
        expiresIn: string;
        json: boolean;
      }) => {
        const emitError = (detail: string): void => {
          if (options.json) {
            stdout(`${JSON.stringify({ error: detail })}\n`);
          } else {
            stderr(`${detail}\n`);
          }
          setExitCode(3);
        };

        let record: StoredIdentity;
        try {
          record = loadIdentity(options.identity);
        } catch (error) {
          emitError(errorMessage(error));
          return;
        }

        let authority = options.authority;
        if (authority === undefined && record.signatureAgent !== undefined) {
          try {
            authority = new URL(record.signatureAgent).host;
          } catch {
            authority = undefined;
          }
        }
        if (authority === undefined) {
          emitError(
            'No authority. Pass --authority <host>, or set a Signature-Agent with identity init.',
          );
          return;
        }

        const expiresIn = Number(options.expiresIn);
        if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
          emitError(
            '--expires-in must be a positive integer number of seconds.',
          );
          return;
        }

        const created = Math.floor(Date.now() / 1000);
        const expires = created + expiresIn;
        let headers;
        try {
          headers = signDirectoryResponse(record.privateJwk, {
            authority,
            keyid: record.keyid,
            created,
            expires,
          });
        } catch (error) {
          emitError(errorMessage(error));
          return;
        }

        if (options.json) {
          stdout(
            `${JSON.stringify({
              authority,
              keyid: record.keyid,
              tag: 'http-message-signatures-directory',
              created,
              expires,
              headers,
            })}\n`,
          );
        } else {
          stdout(
            [
              `Content-Type: ${headers['content-type']}`,
              `Signature-Input: ${headers['signature-input']}`,
              `Signature: ${headers.signature}`,
              '',
            ].join('\n'),
          );
          stderr(
            [
              `Serve these response headers (body = 'agentproof identity export-directory') at:`,
              `  https://${authority}${DIRECTORY_WELL_KNOWN_PATH}`,
              `Signature valid until Unix ${String(expires)} (${String(expiresIn)}s). Regenerate and redeploy before it lapses.`,
              '',
            ].join('\n'),
          );
        }
      },
    );

  identity
    .command('test')
    .description(
      'Sign a request to a Web Bot Auth verifier and report the result.',
    )
    .option(
      '--identity <path>',
      'path to the identity file',
      DEFAULT_IDENTITY_FILE,
    )
    .option('--endpoint <url>', 'verifier test endpoint', DEFAULT_TEST_ENDPOINT)
    .option('--signature-agent <url>', 'override the Signature-Agent origin')
    .option('--json', 'emit the result as JSON on stdout', false)
    .action(
      async (options: {
        identity: string;
        endpoint: string;
        signatureAgent?: string;
        json: boolean;
      }) => {
        const emitError = (detail: string, code: number): void => {
          if (options.json) {
            stdout(`${JSON.stringify({ error: detail })}\n`);
          } else {
            stderr(`${detail}\n`);
          }
          setExitCode(code);
        };

        let record: StoredIdentity;
        try {
          record = loadIdentity(options.identity);
        } catch (error) {
          emitError(errorMessage(error), 3);
          return;
        }
        const signatureAgent = options.signatureAgent ?? record.signatureAgent;
        if (signatureAgent === undefined) {
          emitError(
            'No Signature-Agent URL is set. Re-run identity init with --signature-agent, or pass --signature-agent.',
            3,
          );
          return;
        }

        let headers: WebBotAuthHeaders;
        try {
          headers = createSignedHeaders(
            record,
            options.endpoint,
            signatureAgent,
          );
        } catch (error) {
          emitError(errorMessage(error), 3);
          return;
        }

        let status: number;
        try {
          const observation = await probeHttp(options.endpoint, { headers });
          status = observation.status;
        } catch (error) {
          emitError(errorMessage(error), 3);
          return;
        }

        const verification = interpretVerifierStatus(status);
        const explanation = verificationExplanation(verification);
        if (options.json) {
          stdout(
            `${JSON.stringify({
              endpoint: options.endpoint,
              keyid: record.keyid,
              signatureAgent,
              httpStatus: status,
              externalVerification: verification,
              explanation,
            })}\n`,
          );
        } else {
          stdout(
            [
              'AgentProof identity test',
              '',
              'Endpoint',
              options.endpoint,
              '',
              'Key ID',
              record.keyid,
              '',
              'HTTP',
              String(status),
              '',
              'External verification',
              verification.replace(/-/g, ' ').toUpperCase(),
              '',
              explanation,
              '',
            ].join('\n'),
          );
        }
        setExitCode(identityTestExitCode(verification));
      },
    );

  identity
    .command('list')
    .description(
      'List selectable identities/profiles. Never marks anything verified.',
    )
    .option('--json', 'emit the list as JSON on stdout', false)
    .action((options: { json: boolean }) => {
      const identities = listAgentProfiles().map((profile) => {
        const usable =
          profile.assurance === 'unclaimed' || profile.assurance === 'signed';
        const entry: {
          id: string;
          assurance: string;
          usable: boolean;
          diagnosticOnly?: boolean;
          requiresIdentityFile?: boolean;
        } = { id: profile.id, assurance: profile.assurance, usable };
        if (profile.assurance === 'claimed') {
          entry.diagnosticOnly = true;
        }
        if (profile.assurance === 'signed') {
          entry.requiresIdentityFile = true;
        }
        return entry;
      });

      if (options.json) {
        stdout(`${JSON.stringify({ identities })}\n`);
        return;
      }

      const lines = identities.map((entry) => {
        const tags = [
          entry.usable ? 'usable' : 'diagnostic-only',
          entry.requiresIdentityFile === true ? 'needs --identity' : '',
        ]
          .filter((tag) => tag !== '')
          .join(', ');
        return `${entry.id.padEnd(20)} ${entry.assurance.padEnd(10)} ${tags}`;
      });
      stdout(['AgentProof identities', '', ...lines, ''].join('\n'));
    });

  return program;
}
