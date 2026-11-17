/**
 * Runs the Supabase CLI from scripts without a shell, so SQL and paths with spaces or quotes reach it
 * unchanged. On Windows the npm install is a .cmd shim around a JavaScript entry point; that entry
 * point is run with Node directly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function cliEntryPoint(): string[] {
  const npmGlobalFolder = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '';
  const javascriptEntryPoint = join(npmGlobalFolder, 'node_modules', 'supabase', 'dist', 'supabase.js');
  return process.platform === 'win32' && existsSync(javascriptEntryPoint) ? [process.execPath, javascriptEntryPoint] : ['supabase'];
}

export type CliResult = { succeeded: boolean; output: string; standardOutput: string };

/** Runs one CLI command and returns its combined output. */
export function runSupabase(cliArguments: string[], extraEnvironment: Record<string, string> = {}): CliResult {
  const [program = 'supabase', ...prefix] = cliEntryPoint();
  const result = spawnSync(program, [...prefix, ...cliArguments], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnvironment },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { succeeded: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, standardOutput: result.stdout ?? '' };
}

/**
 * Runs read-only or migration SQL through the Management API (`db query --linked`). The placeholder
 * password stops the CLI creating a temporary login role, which this route doesn't need.
 */
export function queryLinked<Row = Record<string, unknown>>(sql: string): Row[] {
  const result = runSupabase(['db', 'query', '--linked', '--output', 'json', sql], { SUPABASE_DB_PASSWORD: 'not-used-by-management-api' });
  if (!result.succeeded) {
    throw new Error(`Query failed: ${result.output.slice(-2000)}`);
  }
  // Upgrade notices go to stderr; the JSON is the whole of stdout.
  const parsed = JSON.parse(result.standardOutput) as { rows?: Row[] };
  // A changed answer shape must fail loudly: reading it as "no rows" would make the cleanup skip everything.
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`The Supabase CLI answered without a list of rows; check its version. Answer: ${result.standardOutput.slice(0, 500)}`);
  }
  return parsed.rows;
}
