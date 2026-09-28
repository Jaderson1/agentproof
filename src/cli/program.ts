import { Command } from 'commander';
import { exitCodeForStatus } from '../audit/index.ts';

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
      'Test whether declared AI-agent access policies match real-world enforcement.',
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

  return program;
}
