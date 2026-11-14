/** Removes every account, row and file the end-to-end run created, even when a test failed. */
import { spawnSync } from 'node:child_process';

export default function teardown(): void {
  const cleanup = spawnSync(process.execPath, ['scripts/cleanup-rls-test-data.ts', process.env.RLS_RUN_ID ?? ''], { encoding: 'utf8', env: process.env });
  process.stdout.write(`\nCleanup of run ${process.env.RLS_RUN_ID}:\n${cleanup.stdout}${cleanup.stderr}`);
  if (cleanup.status !== 0) {
    throw new Error('The cleanup did not finish; run scripts/cleanup-rls-test-data.ts with this run id again.');
  }
}
