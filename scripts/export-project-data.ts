/**
 * Exports the linked project's data as JSON, read-only: every public table, the auth users (id, email,
 * created_at, metadata) and the list of stored files. Prints counts only, never the data, because the
 * export holds personal data. The output folder is gitignored.
 *
 * Usage: node scripts/export-project-data.ts backups/2026-11-13
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryLinked } from './supabase-cli.ts';

const outputFolder: string = process.argv[2] ?? '';
if (!outputFolder || !outputFolder.startsWith('backups/')) {
  throw new Error('Give an output folder under backups/ (gitignored), for example backups/2026-11-13.');
}
mkdirSync(outputFolder, { recursive: true });

function save(name: string, rows: unknown[]): number {
  writeFileSync(join(outputFolder, `${name}.json`), JSON.stringify(rows, null, 2));
  return rows.length;
}

const counts: Record<string, number> = {};
const tables = queryLinked<{ table_name: string }>(
  `select relation.relname as table_name from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relkind in ('r', 'p') order by 1`,
);
for (const { table_name: tableName } of tables) {
  const rows = queryLinked<{ rows: unknown[] | null }>(`select coalesce(json_agg(row_data), '[]'::json) as rows from public.${tableName} row_data`)[0]?.rows ?? [];
  counts[`public.${tableName}`] = save(`public.${tableName}`, rows);
}

const users = queryLinked<{ rows: unknown[] | null }>(
  `select coalesce(json_agg(json_build_object('id', id, 'email', email, 'created_at', created_at, 'email_confirmed_at', email_confirmed_at, 'raw_user_meta_data', raw_user_meta_data) order by created_at), '[]'::json) as rows from auth.users`,
)[0]?.rows ?? [];
counts['auth.users'] = save('auth.users', users);

const files = queryLinked<{ rows: unknown[] | null }>(
  `select coalesce(json_agg(json_build_object('bucket', bucket_id, 'path', name, 'owner', owner_id, 'size_bytes', (metadata ->> 'size')::bigint, 'created_at', created_at) order by bucket_id, name), '[]'::json) as rows from storage.objects`,
)[0]?.rows ?? [];
counts['storage.objects'] = save('storage.objects', files);

const filesPerBucket = queryLinked<{ bucket_id: string; file_count: number; total_bytes: number }>(
  `select bucket_id, count(*)::integer as file_count, coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint as total_bytes from storage.objects group by 1 order by 1`,
);
writeFileSync(join(outputFolder, 'counts.json'), JSON.stringify({ exportedAt: new Date().toISOString(), counts, filesPerBucket }, null, 2));
console.log(JSON.stringify({ counts, filesPerBucket }, null, 2));
