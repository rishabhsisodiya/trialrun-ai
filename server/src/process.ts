import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  /** Replaces the inherited environment when given. */
  env?: NodeJS.ProcessEnv;
  /** Written to the child's stdin, which is then closed. */
  input?: string;
  timeoutMs: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class CommandNotFoundError extends Error {
  constructor(command: string) {
    super(`${command} is not installed or not on PATH`);
    this.name = 'CommandNotFoundError';
  }
}

export class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`${command} did not finish within ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'CommandTimeoutError';
  }
}

// Far above any real engine reply; stops a runaway child filling memory.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Runs a command to completion without a shell, so arguments are never re-parsed. */
export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? new CommandNotFoundError(command) : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new CommandTimeoutError(command, options.timeoutMs));
      else resolve({ code, stdout, stderr });
    });

    // A child that exits early closes stdin first; that is reported through `close`.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}
