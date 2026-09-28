#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createProgram } from './program.ts';

function readVersion(): string {
  const raw = readFileSync(
    new URL('../../package.json', import.meta.url),
    'utf8',
  );
  const pkg: unknown = JSON.parse(raw);

  if (
    typeof pkg === 'object' &&
    pkg !== null &&
    'version' in pkg &&
    typeof pkg.version === 'string'
  ) {
    return pkg.version;
  }

  throw new Error('Could not read version from package.json');
}

const program = createProgram({
  version: readVersion(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  setExitCode: (code) => {
    process.exitCode = code;
  },
});

await program.parseAsync(process.argv);
