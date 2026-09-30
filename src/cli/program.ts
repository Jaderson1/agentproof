import { Command } from 'commander';
import { exitCodeForStatus } from '../audit/index.ts';
import { HttpProbeError, probeHttp } from '../http/index.ts';
import {
  buildRequestHeaders,
  getAgentProfile,
  listAgentProfiles,
} from '../identity/index.ts';
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
    .action(async (url: string, options: { as: string }) => {
      const profile = getAgentProfile(options.as);
      if (profile === undefined) {
        const ids = listAgentProfiles()
          .map((candidate) => candidate.id)
          .join(', ');
        stderr(`Unknown profile: ${options.as}\n`);
        stderr(`Available profiles: ${ids}\n`);
        setExitCode(3);
        return;
      }

      try {
        const observation = await probeHttp(url, {
          headers: buildRequestHeaders(profile),
        });
        const report = buildValidationReport(url, profile, observation);
        stdout(`${renderValidationReport(report)}\n`);
        setExitCode(validationExitCode(report));
      } catch (error) {
        const detail =
          error instanceof HttpProbeError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        stderr(`${detail}\n`);
        setExitCode(3);
      }
    });

  return program;
}
