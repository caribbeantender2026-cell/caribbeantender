/**
 * Writes src/lib/database.types.ts from the linked (client) project's schema with
 * `supabase gen types typescript`, so the app is typed against what is really deployed.
 *
 * Usage: pnpm types
 */
import { writeFileSync } from 'node:fs';
import { runSupabase } from './supabase-cli.ts';

const generated = runSupabase(['gen', 'types', 'typescript', '--linked', '--schema', 'public'], { SUPABASE_DB_PASSWORD: 'not-used-by-management-api' });
if (!generated.succeeded || !generated.standardOutput.includes('export type Database')) {
  throw new Error(`Could not generate the types from the linked project. Is the CLI linked (supabase link)?\n${generated.output.slice(-2000)}`);
}
writeFileSync(
  new URL('../src/lib/database.types.ts', import.meta.url),
  `// Generated from the linked Supabase project by scripts/generate-database-types.ts. Do not edit by hand.\n// Regenerate with \`pnpm types\` after applying a migration.\n${generated.standardOutput}`,
);
console.log('Wrote src/lib/database.types.ts');
