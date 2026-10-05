// Confirms staging matches production where it matters for the tests: Postgres version, database
// timezone and auth settings. Production is only read: GET requests, plus one SELECT through the
// Management API's query endpoint. Settings that hold secrets are compared by name only, never printed.
// Usage: node --env-file=.env.staging.local scripts/compare-staging-production.ts
const productionProjectRef = 'ijlcjthgwppllhlqocep';
const managementApi = 'https://api.supabase.com/v1';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const stagingProjectRef = process.env.STAGING_PROJECT_REF;
if (!accessToken || !stagingProjectRef) {
  throw new Error('Set SUPABASE_ACCESS_TOKEN and STAGING_PROJECT_REF in .env.staging.local.');
}
if (stagingProjectRef === productionProjectRef) {
  throw new Error('STAGING_PROJECT_REF is the production project.');
}

type JsonObject = Record<string, unknown>;

async function managementRequest(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  const response = await fetch(`${managementApi}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function describeProject(projectRef: string): Promise<{ postgresVersion: string; timezone: string; authSettings: JsonObject }> {
  const project = (await managementRequest(`/projects/${projectRef}`)) as { database?: { version?: string } };
  const timezoneRows = (await managementRequest(`/projects/${projectRef}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: `select current_setting('TimeZone') as timezone` }),
  })) as Array<{ timezone: string }>;
  const authSettings = (await managementRequest(`/projects/${projectRef}/config/auth`)) as JsonObject;
  return {
    postgresVersion: project.database?.version ?? 'unknown',
    timezone: timezoneRows[0]?.timezone ?? 'unknown',
    authSettings,
  };
}

// URLs and addresses are expected to differ between projects; secrets must never be printed.
const expectedToDiffer = /site_url|uri_allow_list|smtp_host|smtp_admin_email|smtp_sender_name|redirect/i;
const holdsSecret = /secret|password|pass|token|key|credential|private/i;

const [production, staging] = await Promise.all([describeProject(productionProjectRef), describeProject(stagingProjectRef)]);

console.log(`Postgres version   production ${production.postgresVersion} | staging ${staging.postgresVersion}`);
console.log(`Database timezone  production ${production.timezone} | staging ${staging.timezone}`);

const settingNames = [...new Set([...Object.keys(production.authSettings), ...Object.keys(staging.authSettings)])].sort();
const differences: string[] = [];
for (const settingName of settingNames) {
  const productionValue = JSON.stringify(production.authSettings[settingName] ?? null);
  const stagingValue = JSON.stringify(staging.authSettings[settingName] ?? null);
  if (productionValue === stagingValue) {
    continue;
  }
  if (holdsSecret.test(settingName)) {
    differences.push(`  ${settingName}: differs (secret, values not shown)`);
  } else {
    const note = expectedToDiffer.test(settingName) ? ' (expected to differ)' : '';
    differences.push(`  ${settingName}: production ${productionValue} | staging ${stagingValue}${note}`);
  }
}
console.log(differences.length === 0 ? 'Auth settings: identical' : `Auth settings that differ (${differences.length}):\n${differences.join('\n')}`);
