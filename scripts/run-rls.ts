/**
 * Runs the real-stack RLS proof (PRD section 11) against the local Supabase stack or the client's
 * project (staging was dropped by decision D1):
 *   1. local only: reset the database to the production baseline and run
 *      tests/rls/baseline.test.ts (every audit item must reproduce), then apply the remaining migrations;
 *   2. run tests/rls/rls.test.ts (every item must be refused);
 *   3. live only: remove every rls-test-<run id> account, row and file, then check row counts and
 *      compare their identities with a fresh pre-run snapshot;
 *   4. record the service versions, timezone, Security Advisor results and storage grants, next to
 *      the production values recorded in AUDIT.md (OPEN_QUESTIONS.md, item 3), in tests/rls/runs/.
 *
 * Usage:
 *   node scripts/run-rls.ts local
 *   node --env-file=.env.production.local scripts/run-rls.ts live --after-state-only
 *
 * The live run never resets or migrates: the client project already has every migration
 * (OPEN_QUESTIONS.md, decision D1). Its test accounts are created confirmed, so no email goes out.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { compareIdentitySnapshots, createSnapshotSalt, readIdentitySnapshot } from './rls-snapshot.ts';
import { queryLinked, runSupabase } from './supabase-cli.ts';

const productionProjectRef = 'ijlcjthgwppllhlqocep';
const baselineVersion = '20261005025300';
// From AUDIT.md (read on 2026-10-05).
const productionVersions: Record<string, string> = {
  postgres: '17.6.1.155',
  auth: 'v2.197.0',
  postgrest: 'v14.5',
  storage: 'v1.77.5',
  timezone: 'UTC',
};

type Target = 'local' | 'live';

function fail(message: string): never {
  throw new Error(message);
}

const requestedTarget = process.argv[2];
if (requestedTarget !== 'local' && requestedTarget !== 'live') {
  fail('Say which stack to run against: "local" or "live".');
}
const target: Target = requestedTarget;
if (target === 'live' && process.argv[3] !== '--after-state-only') {
  fail('Live tests require --after-state-only.');
}
const runIdentifier = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

/** Runs the Supabase CLI. Live calls carry a placeholder password (they only use the Management API), so the CLI never creates a login role. */
function supabase(cliArguments: string[], options: { allowFailure?: boolean } = {}): string {
  const passwords: Record<Target, Record<string, string>> = {
    local: {},
    live: { SUPABASE_DB_PASSWORD: 'not-used-by-management-api' },
  };
  const result = runSupabase(cliArguments, passwords[target]);
  if (!result.succeeded && !options.allowFailure) {
    fail(`supabase ${cliArguments.join(' ')} failed:\n${result.output}`);
  }
  // Standard output only: the CLI's upgrade notice goes to standard error and isn't a result.
  return result.standardOutput;
}

/** Reads one of the files `supabase link` keeps in supabase/.temp (the linked ref, service versions). */
function readLinkFile(name: string): string | null {
  const path = `supabase/.temp/${name}`;
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

type Connection = { url: string; publishableKey: string; secretKey: string; locationFlag: '--local' | '--linked' };

function connectToLocal(): Connection {
  let status = supabase(['status', '-o', 'env'], { allowFailure: true });
  if (!/API_URL=/.test(status)) {
    console.log('Starting the local Supabase stack (the first start downloads its images)...');
    supabase(['start']);
    status = supabase(['status', '-o', 'env']);
  }
  const value = (name: string): string => new RegExp(`^${name}="?([^"\\r\\n]+)"?`, 'm').exec(status)?.[1] ?? '';
  return {
    url: value('API_URL'),
    publishableKey: value('PUBLISHABLE_KEY') || value('ANON_KEY'),
    secretKey: value('SECRET_KEY') || value('SERVICE_ROLE_KEY'),
    locationFlag: '--local',
  };
}

function connectToLive(): Connection {
  const url = process.env.PRODUCTION_SUPABASE_URL ?? '';
  if (process.env.PRODUCTION_PROJECT_REF !== productionProjectRef || !url.includes(productionProjectRef)) {
    fail('Load the client project settings: node --env-file=.env.production.local scripts/run-rls.ts live ...');
  }
  // The cleanup and count queries go through the link, so it must be the same project the suite tests.
  if (readLinkFile('project-ref') !== productionProjectRef) fail('Link the CLI to the client project first: supabase link --project-ref <ref>.');
  return {
    url,
    publishableKey: process.env.PRODUCTION_SUPABASE_PUBLISHABLE_KEY ?? '',
    secretKey: process.env.PRODUCTION_SUPABASE_SECRET_KEY ?? '',
    locationFlag: '--linked',
  };
}

/** Runs one Node script or test file, echoing its output, and returns whether it succeeded with its output. */
function runNode(nodeArguments: string[], environment: Record<string, string> = {}): { passed: boolean; output: string } {
  const result = spawnSync(process.execPath, nodeArguments, { encoding: 'utf8', env: { ...process.env, ...environment } });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { passed: result.status === 0, output };
}

function runSuite(file: string, connection: Connection): { passed: boolean; summary: string } {
  const result = runNode(['--test', '--test-concurrency=1', file], {
    RLS_TARGET: target,
    RLS_SUPABASE_URL: connection.url,
    RLS_PUBLISHABLE_KEY: connection.publishableKey,
    RLS_SECRET_KEY: connection.secretKey,
    RLS_RUN_ID: runIdentifier,
    RLS_LIVE_PROJECT: target === 'live' ? 'after-state-only' : '',
  });
  const summary = result.output
    .split(/\r?\n/)
    .filter((line) => /^\s*(✔|✖|ℹ (tests|pass|fail))/.test(line))
    .join('\n');
  return { passed: result.passed, summary };
}

function query(connection: Connection, sql: string): string {
  return supabase(['db', 'query', connection.locationFlag, '--output', 'csv', sql], { allowFailure: true }).trim();
}

const connectors: Record<Target, () => Connection> = { local: connectToLocal, live: connectToLive };
const connection = connectors[target]();
if (!connection.url || !connection.publishableKey || !connection.secretKey) {
  fail('Could not find the API URL and keys for this stack.');
}

const snapshotSalt = createSnapshotSalt();
const beforeSnapshot = target === 'live' ? await readIdentitySnapshot(queryLinked, snapshotSalt) : null;

let baselineRun: { passed: boolean; summary: string } | null = null;
if (target !== 'live') {
  console.log(`\nResetting ${target} to the production baseline (${baselineVersion})...`);
  supabase(['db', 'reset', connection.locationFlag, '--version', baselineVersion, '--no-seed', '--yes']);
  baselineRun = runSuite('tests/rls/baseline.test.ts', connection);

  console.log(`\nApplying every later migration to ${target}...`);
  supabase(['migration', 'up', '--local']);
}

console.log(`\nRunning the after-state suite on ${target} (run ${runIdentifier})...`);
const fullRun = runSuite('tests/rls/rls.test.ts', connection);

let cleanupSection = '';
if (target === 'live') {
  // Before cleanup removes them: every email the run caused, by status. Until go-live each must be
  // suppressed (OPEN_QUESTIONS.md, D3), including alerts to real suppliers about test tenders.
  let emailSection = '';
  try {
    const runAccounts = `select id from auth.users where email like 'rls-test-${runIdentifier}-%'`;
    // Not query(): if this check can't run, the run must fail rather than report "none sent".
    const emailsByStatus = supabase([
      'db',
      'query',
      connection.locationFlag,
      '--output',
      'csv',
      `select log.type, log.status, count(*) as emails from public.email_log log
       where log.recipient like 'rls-test-${runIdentifier}-%'
          or log.entity_id in (select tender.id from public.tenders tender where tender.business_id in (${runAccounts}))
          or log.entity_id in (select bid.id from public.bids bid where bid.supplier_id in (${runAccounts}))
       group by 1, 2 order by 1, 2`,
    ]).trim();
    const senderCalls = query(connection, `select status_code, count(*) as calls from net._http_response where created > now() - interval '10 minutes' group by 1 order by 1`);
    // A pending email may already be with Resend, so it counts as sent here.
    const anyEmailSent = /,(sent|pending),/.test(emailsByStatus);
    if (anyEmailSent) process.exitCode = 1;
    const fence = '```';
    emailSection = `
## Emails the run caused, before cleanup: **${anyEmailSent ? 'SOME WERE SENT' : 'none sent'}**
${fence}
${emailsByStatus || '(none)'}
${fence}

send-notifications calls by pg_cron in the last 10 minutes, by HTTP status:
${fence}
${senderCalls || '(none)'}
${fence}
`;
  } catch (error) {
    process.exitCode = 1;
    console.error('Could not verify the run email log:', error);
    emailSection = 'Email verification failed.';
  }

  // Runs whether or not the suite passed: a failed run still leaves test data behind.
  console.log(`\nRemoving the test data of run ${runIdentifier}...`);
  const cleanup = runNode(['scripts/cleanup-rls-test-data.ts', runIdentifier]);
  let comparison = { needsReview: true, report: 'The post-run identity check failed.' };
  try {
    const afterSnapshot = await readIdentitySnapshot(queryLinked, snapshotSalt);
    if (!beforeSnapshot) throw new Error('Missing pre-run identity snapshot.');
    comparison = compareIdentitySnapshots(beforeSnapshot, afterSnapshot);
  } catch (error) {
    console.error('Could not verify the post-run row identities:', error);
  }
  cleanupSection = `${emailSection}
## Cleanup of run ${runIdentifier}: **${cleanup.passed ? 'complete' : 'INCOMPLETE'}**
\`\`\`
${cleanup.output.trim()}
\`\`\`

## Row counts against the start of this run
${comparison.report}
`;
  if (!cleanup.passed || comparison.needsReview) process.exitCode = 1;
}

console.log('\nRecording versions, Security Advisor results and storage grants...');
const versions =
  target === 'local'
    ? { stack: supabase(['--version']).trim() }
    : {
        postgres: readLinkFile('postgres-version') ?? 'unknown',
        auth: readLinkFile('gotrue-version') ?? 'unknown',
        postgrest: readLinkFile('rest-version') ?? 'unknown',
        storage: readLinkFile('storage-version') ?? 'unknown',
      };
const databaseFacts = query(connection, `select version() as postgres, current_setting('TimeZone') as timezone`);
const storageGrants = query(
  connection,
  `select role_name, relation.relname as table_name, privilege
   from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
   cross join unnest(array['anon', 'authenticated']) as role_name
   cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privilege
   where namespace.nspname = 'storage' and relation.relkind = 'r' and has_table_privilege(role_name, relation.oid, privilege)
   order by 1, 2, 3`,
);
const advisors = target === 'local' ? 'Not available on the local stack.' : supabase(['db', 'advisors', '--linked', '--type', 'security', '--level', 'info'], { allowFailure: true }).trim();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const comparison =
  target === 'local'
    ? ''
    : Object.entries(productionVersions)
        .map(([service, productionValue]) => `| ${service} | ${productionValue} | ${service === 'timezone' ? databaseFacts.split(',').at(-1) : (versions as Record<string, string>)[service] ?? 'unknown'} |`)
        .join('\n');
const baselineLine = baselineRun
  ? `**${baselineRun.passed ? 'passed' : 'FAILED'}**`
  : 'not run (the client project already has every migration; OPEN_QUESTIONS.md, D1)';
const record = `# RLS run: ${target}, ${new Date().toISOString()} (run ${runIdentifier})

- Baseline suite (every audit item must reproduce): ${baselineLine}
- Full suite (every audit item refused, PRD rules hold): **${fullRun.passed ? 'passed' : 'FAILED'}**

## Versions
${target === 'local' ? `\`${JSON.stringify(versions)}\`` : `| Service | Production (AUDIT.md) | This run |\n|---|---|---|\n${comparison}`}

Database: \`${databaseFacts.replace(/\r?\n/g, ' | ')}\`

## Storage grants left to anon and authenticated (PRD 8.2; OPEN_QUESTIONS.md, item 10)
\`\`\`
${storageGrants || '(none)'}
\`\`\`

## Security Advisor
\`\`\`
${advisors}
\`\`\`
${baselineRun ? `\n## Baseline suite\n\`\`\`\n${baselineRun.summary}\n\`\`\`\n` : ''}
## Full suite
\`\`\`
${fullRun.summary}
\`\`\`
${cleanupSection}`;
mkdirSync('tests/rls/runs', { recursive: true });
const recordPath = `tests/rls/runs/${stamp}-${target}.md`;
writeFileSync(recordPath, record);
console.log(`\nRecorded in ${recordPath}`);
if ((baselineRun && !baselineRun.passed) || !fullRun.passed) process.exitCode = 1;
