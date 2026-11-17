import { randomBytes } from 'node:crypto';

/** A live test remembers only salted primary-key fingerprints for the lifetime of its process. */
export type IdentitySnapshot = Map<string, Set<string>>;

type ReadRows = <Row>(statement: string) => Row[] | Promise<Row[]>;
type IdentityColumns = { schema_name: string; table_name: string; columns: string[] };

/** Use the same private salt on both reads so file paths and other identifiers never leave the database in clear text. */
export function createSnapshotSalt(): string {
  return randomBytes(32).toString('hex');
}

/** Fingerprint row identities in a single statement across all tracked tables. */
export async function readIdentitySnapshot(read: ReadRows, salt: string): Promise<IdentitySnapshot> {
  if (!/^[0-9a-f]{64}$/.test(salt)) throw new Error('Invalid snapshot salt.');
  const tables = await read<IdentityColumns>(`
    select namespace.nspname as schema_name, relation.relname as table_name,
      case when namespace.nspname = 'storage' then array['bucket_id','name'] else array(
        select attribute.attname::text
        from pg_index as primary_index
        cross join lateral unnest(primary_index.indkey) with ordinality as column_key(number,position)
        join pg_attribute as attribute on attribute.attrelid = relation.oid and attribute.attnum = column_key.number
        where primary_index.indrelid = relation.oid and primary_index.indisprimary
        order by column_key.position
      ) end as columns
    from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where relation.relkind in ('r','p') and (namespace.nspname = 'public'
      or (namespace.nspname, relation.relname) in (('auth','users'),('storage','objects')))
    order by namespace.nspname, relation.relname`);
  if (!tables.length) throw new Error('No tables found for the live test snapshot.');
  const quoteIdentifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const selects = tables.map((table, index) => {
    if (!table.columns.length) throw new Error('Missing primary key for ' + table.table_name);
    const columns = table.columns.map(quoteIdentifier).join(', ');
    const source = [table.schema_name, table.table_name].map(quoteIdentifier).join('.');
    return `select ${index} as table_index, coalesce(array_agg(encode(sha256(convert_to(
      '${salt}' || jsonb_build_array(${columns})::text, 'UTF8')), 'hex')), '{}'::text[]) as fingerprints from ${source}`;
  });
  const rows = await read<{ table_index: number; fingerprints: string[] }>(selects.join('\nunion all\n'));
  const result: IdentitySnapshot = new Map();
  for (const row of rows) {
    const table = tables[row.table_index];
    if (!table || !Array.isArray(row.fingerprints)) throw new Error('Invalid identity snapshot response.');
    result.set(table.schema_name + '.' + table.table_name, new Set(row.fingerprints));
  }
  if (result.size !== tables.length) throw new Error('Incomplete identity snapshot.');
  return result;
}

/** Flag missing pre-existing rows, allow normal additions and report counts only. */
export function compareIdentitySnapshots(before: IdentitySnapshot, after: IdentitySnapshot): { report: string; needsReview: boolean } {
  const lines = ['| Table | Before | After | Removed | Added |', '|---|---:|---:|---:|---:|'];
  let needsReview = false;
  for (const [table, original] of before) {
    const current = after.get(table);
    if (!current) throw new Error('Missing table in post-run snapshot: ' + table);
    const missing = [...original].filter((key) => !current.has(key)).length;
    const added = current.size - original.size + missing;
    if (missing && table !== 'public.draft_file_cleanup') needsReview = true;
    lines.push(`| ${table} | ${original.size} | ${current.size} | ${missing} | ${added} |`);
  }
  return { report: lines.join('\n'), needsReview };
}
