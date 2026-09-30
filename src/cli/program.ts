import { Command } from 'commander';
import { exitCodeForStatus } from '../audit/index.ts';
import { HttpProbeError, probeHttp } from '../http/index.ts';
import {
  buildRequestHeaders,
  getAgentProfile,
  listAgentProfiles,
} from '../identity/index.ts';
import { evaluateRobotsPolicy, fetchRobots } from '../robots/index.ts';
import {
  buildValidationReport,
  renderValidationReport,
  validationExitCode,
} from '../validation/index.ts';

export type ProgramOptions = {
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  setExitCode: (code: number) => void;
};

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
    .action(async (url: string, options: { as: string; json: boolean }) => {
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

      const headers = buildRequestHeaders(profile);
      // robots.txt is best-effort: its failure alone yields policy 'unknown',
      // never a fatal exit. Only the target probe can fail the validation.
      const robots = await fetchRobots(url, { headers });

      try {
        const observation = await probeHttp(url, { headers });
        const policy = evaluateRobotsPolicy(
          robots,
          profile.robotsUserAgent,
          url,
        );
        const report = buildValidationReport(url, profile, observation, policy);
        stdout(
          options.json
            ? `${JSON.stringify(report)}\n`
            : `${renderValidationReport(report)}\n`,
        );
        setExitCode(validationExitCode(report));
      } catch (error) {
        const detail =
          error instanceof HttpProbeError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        if (options.json) {
          stdout(`${JSON.stringify({ error: detail })}\n`);
        } else {
          stderr(`${detail}\n`);
        }
        setExitCode(3);
      }
    });

  return program;
}
