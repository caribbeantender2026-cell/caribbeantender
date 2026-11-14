/**
 * Runs the real-stack RLS proof (PRD section 11) against the local Supabase stack or staging:
 *   1. reset the database to the production baseline and run tests/rls/baseline.test.ts
 *      (every audit item must reproduce);
 *   2. apply the remaining migrations and run tests/rls/rls.test.ts (every item must be refused);
 *   3. record the service versions, timezone, Security Advisor results and storage grants, next to
 *      the production values recorded in AUDIT.md (OPEN_QUESTIONS.md, item 3), in tests/rls/runs/.
 *
 * Usage:
 *   node scripts/run-rls.ts local
 *   node --env-file=.env.staging.local scripts/run-rls.ts staging --reset-staging
 *
 * It never touches production: it stops if any setting or the CLI link points at production.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const productionProjectRef = 'ijlcjthgwppllhlqocep';
const baselineVersion = '20261005025300';
// From AUDIT.md (read on 2026-10-05, the last time production was read).
const productionVersions: Record<string, string> = {
  postgres: '17.6.1.155',
  auth: 'v2.197.0',
  postgrest: 'v14.5',
  storage: 'v1.77.5',
  timezone: 'UTC',
};

type Target = 'local' | 'staging';

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

const target = process.argv[2] as Target | undefined;
if (target !== 'local' && target !== 'staging') {
  fail('Say which stack to run against: "local" or "staging".');
}
if (target === 'staging' && !process.argv.includes('--reset-staging')) {
  fail('The staging run resets the staging database to the baseline and back, deleting its data. Add --reset-staging to confirm.');
}

/** Runs the Supabase CLI. Staging calls carry the staging database password so the CLI never creates a login role. */
function supabase(arguments_: string[], options: { allowFailure?: boolean } = {}): string {
  const environment = { ...process.env };
  if (target === 'staging') {
    environment.SUPABASE_DB_PASSWORD = process.env.STAGING_DB_PASSWORD ?? '';
  }
  const result = spawnSync('supabase', arguments_, { encoding: 'utf8', env: environment, shell: process.platform === 'win32' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 && !options.allowFailure) {
    fail(`supabase ${arguments_.join(' ')} failed:\n${output}`);
  }
  return output;
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

function connectToStaging(): Connection {
  const projectRef = process.env.STAGING_PROJECT_REF ?? '';
  const url = process.env.STAGING_SUPABASE_URL ?? '';
  if (!/^[a-z]{20}$/.test(projectRef)) fail('STAGING_PROJECT_REF is missing or not a project ref. Fill in .env.staging.local.');
  if (projectRef === productionProjectRef || url.includes(productionProjectRef)) fail('Refusing to run: the staging settings point at production.');
  if (!url.includes(projectRef)) fail('STAGING_SUPABASE_URL does not match STAGING_PROJECT_REF.');
  if (!process.env.STAGING_DB_PASSWORD) fail('STAGING_DB_PASSWORD is empty; the CLI needs it to reset and migrate staging.');

  if (readLinkFile('project-ref') !== projectRef) {
    supabase(['link', '--project-ref', projectRef]);
  }
  const linked = readLinkFile('project-ref');
  if (linked !== projectRef || linked === productionProjectRef) fail(`The CLI is linked to "${linked}", not staging. Stopping.`);
  return {
    url,
    publishableKey: process.env.STAGING_SUPABASE_PUBLISHABLE_KEY ?? '',
    secretKey: process.env.STAGING_SUPABASE_SECRET_KEY ?? '',
    locationFlag: '--linked',
  };
}

function runSuite(file: string, connection: Connection): { passed: boolean; summary: string } {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RLS_TARGET: target,
      RLS_SUPABASE_URL: connection.url,
      RLS_PUBLISHABLE_KEY: connection.publishableKey,
      RLS_SECRET_KEY: connection.secretKey,
    },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  const summary = output
    .split(/\r?\n/)
    .filter((line) => /^\s*(✔|✖|ℹ (tests|pass|fail))/.test(line))
    .join('\n');
  return { passed: result.status === 0, summary };
}

function query(connection: Connection, sql: string): string {
  return supabase(['db', 'query', connection.locationFlag, '--output', 'csv', sql], { allowFailure: true }).trim();
}

const connection = target === 'local' ? connectToLocal() : connectToStaging();
if (!connection.url || !connection.publishableKey || !connection.secretKey) {
  fail('Could not find the API URL and keys for this stack.');
}

console.log(`\n1/3  Resetting ${target} to the production baseline (${baselineVersion})...`);
supabase(['db', 'reset', connection.locationFlag, '--version', baselineVersion, '--no-seed', '--yes']);
const baselineRun = runSuite('tests/rls/baseline.test.ts', connection);

console.log(`\n2/3  Applying every later migration to ${target}...`);
if (target === 'local') {
  supabase(['migration', 'up', '--local']);
} else {
  supabase(['db', 'push', '--linked', '--include-all', '--yes']);
}
const fullRun = runSuite('tests/rls/rls.test.ts', connection);

console.log('\n3/3  Recording versions, Security Advisor results and storage grants...');
const versions =
  target === 'staging'
    ? {
        postgres: readLinkFile('postgres-version') ?? 'unknown',
        auth: readLinkFile('gotrue-version') ?? 'unknown',
        postgrest: readLinkFile('rest-version') ?? 'unknown',
        storage: readLinkFile('storage-version') ?? 'unknown',
      }
    : { stack: supabase(['--version']).trim() };
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
const advisors = target === 'staging' ? supabase(['db', 'advisors', '--linked', '--type', 'security', '--level', 'info'], { allowFailure: true }).trim() : 'Not available on the local stack.';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const comparison =
  target === 'staging'
    ? Object.entries(productionVersions)
        .map(([service, productionValue]) => `| ${service} | ${productionValue} | ${service === 'timezone' ? databaseFacts : (versions as Record<string, string>)[service] ?? 'unknown'} |`)
        .join('\n')
    : '';
const record = `# RLS run: ${target}, ${new Date().toISOString()}

- Baseline suite (every audit item must reproduce): **${baselineRun.passed ? 'passed' : 'FAILED'}**
- Full suite (every audit item refused, PRD rules hold): **${fullRun.passed ? 'passed' : 'FAILED'}**

## Versions
${target === 'staging' ? `| Service | Production (AUDIT.md) | Staging |\n|---|---|---|\n${comparison}` : `\`${JSON.stringify(versions)}\``}

Database: \`${databaseFacts.replace(/\r?\n/g, ' | ')}\`

## Storage grants left to anon and authenticated (PRD 8.2; OPEN_QUESTIONS.md, item 10)
\`\`\`
${storageGrants || '(none)'}
\`\`\`

## Security Advisor
\`\`\`
${advisors}
\`\`\`

## Baseline suite
\`\`\`
${baselineRun.summary}
\`\`\`

## Full suite
\`\`\`
${fullRun.summary}
\`\`\`
`;
mkdirSync('tests/rls/runs', { recursive: true });
const recordPath = `tests/rls/runs/${stamp}-${target}.md`;
writeFileSync(recordPath, record);
console.log(`\nRecorded in ${recordPath}`);
process.exitCode = baselineRun.passed && fullRun.passed ? 0 : 1;
