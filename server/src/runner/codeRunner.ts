import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CodeLanguage } from '../../../shared/types.ts';
import { CommandNotFoundError, CommandTimeoutError, run } from '../process.ts';

export interface RunCase {
  name: string;
  args: unknown[];
}

export interface CaseOutcome {
  name: string;
  /** The function's return value, as JSON data. */
  actual: unknown;
  error: string | null;
}

export interface RunOutcome {
  cases: CaseOutcome[];
  stdout: string;
  /** Set when nothing ran: a syntax error, a timeout, a missing interpreter. */
  error: string | null;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_STDOUT = 4000;
export const RUN_TIMEOUT_MS = 10_000;

/** True when a name is safe to splice into the harness as a function name. */
export function isIdentifier(name: string): boolean {
  return IDENTIFIER.test(name);
}

// The harness is appended to the candidate's code, so it sees the function without
// the candidate having to export anything. It only reports what the function returned;
// deciding pass or fail stays in one place, on the server.
const NODE_HARNESS = (fn: string) => `
;
{
  const { readFileSync, writeFileSync } = await import('node:fs');
  const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const target = typeof ${fn} === 'function' ? ${fn} : null;
  const out = [];
  for (const one of cases) {
    const row = { name: one.name, actual: null, error: null };
    try {
      if (!target) throw new Error('function ${fn} is not defined');
      const value = await target(...structuredClone(one.args));
      const text = JSON.stringify(value);
      row.actual = text === undefined ? null : JSON.parse(text);
    } catch (problem) {
      row.error = String((problem && problem.message) || problem);
    }
    out.push(row);
  }
  writeFileSync(process.argv[3], JSON.stringify(out));
}
`;

const PYTHON_HARNESS = (fn: string) => `

def __trialrun_run():
    import json, sys
    with open(sys.argv[1]) as handle:
        cases = json.load(handle)
    target = globals().get(${JSON.stringify(fn)})
    out = []
    for one in cases:
        row = {"name": one["name"], "actual": None, "error": None}
        try:
            if not callable(target):
                raise NameError("function ${fn} is not defined")
            row["actual"] = json.loads(json.dumps(target(*one["args"])))
        except Exception as problem:
            row["error"] = type(problem).__name__ + ": " + str(problem)
        out.append(row)
    with open(sys.argv[2], "w") as handle:
        json.dump(out, handle)

__trialrun_run()
`;

const LANGUAGES: Record<CodeLanguage, { file: string; command: string; harness: (fn: string) => string }> = {
  javascript: { file: 'solution.mjs', command: process.execPath, harness: NODE_HARNESS },
  // Node strips the types itself, so TypeScript needs no compiler here.
  typescript: { file: 'solution.mts', command: process.execPath, harness: NODE_HARNESS },
  python: { file: 'solution.py', command: 'python3', harness: PYTHON_HARNESS },
};

function lastLines(text: string, count: number): string {
  return text.trim().split('\n').slice(-count).join('\n');
}

/**
 * Calls one function from a piece of code with each case's arguments.
 *
 * This is not a sandbox. The code runs as the user, on the user's own machine,
 * in a throwaway folder and with a time limit.
 */
export async function runFunction(
  language: CodeLanguage,
  code: string,
  functionName: string,
  cases: RunCase[],
  timeoutMs = RUN_TIMEOUT_MS,
): Promise<RunOutcome> {
  if (!isIdentifier(functionName)) throw new Error(`"${functionName}" is not a valid function name`);
  const setup = LANGUAGES[language];
  const folder = await mkdtemp(path.join(os.tmpdir(), 'trialrun-run-'));
  const source = path.join(folder, setup.file);
  const casesFile = path.join(folder, 'cases.json');
  const outFile = path.join(folder, 'out.json');
  try {
    await writeFile(source, code + setup.harness(functionName));
    await writeFile(casesFile, JSON.stringify(cases));
    const result = await run(setup.command, [source, casesFile, outFile], {
      cwd: folder,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: '1' },
      timeoutMs,
    });
    const stdout = result.stdout.slice(0, MAX_STDOUT);
    const written = await readFile(outFile, 'utf8').catch(() => null);
    if (written === null) {
      const reason = lastLines(result.stderr, 8).replaceAll(folder + path.sep, '') || `The code exited with code ${result.code}.`;
      return { cases: [], stdout, error: reason };
    }
    return { cases: JSON.parse(written) as CaseOutcome[], stdout, error: null };
  } catch (error) {
    if (error instanceof CommandTimeoutError) {
      return { cases: [], stdout: '', error: `Timed out after ${timeoutMs / 1000} seconds. Check for an infinite loop.` };
    }
    if (error instanceof CommandNotFoundError) {
      return { cases: [], stdout: '', error: `${setup.command} is not installed, so ${language} code cannot run.` };
    }
    throw error;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Equality of JSON data, forgiving the last digits of floating-point results. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && sameValue(left[key], right[key]));
}
