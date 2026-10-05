// Generates src/lib/database.types.ts from the migrations, in the same shape as
// `supabase gen types typescript`, so the app is typed against the schema before staging exists.
// ponytail: covers the column types this schema uses and leaves Relationships empty (no page embeds
// related tables); once staging exists, replace the output with
// `supabase gen types typescript --project-id <staging-ref>`, which is the authority.
import { writeFileSync } from 'node:fs';
import { createDatabase } from '../tests/database/harness.ts';

type ColumnRow = {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
  data_type: string;
  udt_name: string;
  column_default: string | null;
  is_identity: 'YES' | 'NO';
  is_generated: 'ALWAYS' | 'NEVER';
};
type RelationRow = { table_name: string; table_type: 'BASE TABLE' | 'VIEW' };
type EnumRow = { enum_name: string; enum_values: string[] };
type FunctionRow = { function_name: string; argument_names: string[] | null; argument_types: string[]; return_type: string };

const outputPath = new URL('../src/lib/database.types.ts', import.meta.url);

const stringTypes = new Set(['uuid', 'text', 'varchar', 'bpchar', 'date', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval', 'inet']);
const numberTypes = new Set(['int2', 'int4', 'int8', 'float4', 'float8', 'numeric']);

/** Maps a Postgres type name to the TypeScript type PostgREST returns for it. */
function typeScriptType(postgresType: string, enumNames: Set<string>): string {
  if (postgresType.startsWith('_')) {
    return `${typeScriptType(postgresType.slice(1), enumNames)}[]`;
  }
  if (enumNames.has(postgresType)) {
    return `Database['public']['Enums']['${postgresType}']`;
  }
  if (stringTypes.has(postgresType)) return 'string';
  if (numberTypes.has(postgresType)) return 'number';
  if (postgresType === 'bool') return 'boolean';
  if (postgresType === 'json' || postgresType === 'jsonb') return 'Json';
  throw new Error(`No TypeScript mapping for Postgres type "${postgresType}"; add it to generate-database-types.ts.`);
}

const database = await createDatabase();

const relations = (await database.query<RelationRow>(
  `select table_name, table_type from information_schema.tables where table_schema = 'public' order by table_name`,
)).rows;
const columns = (await database.query<ColumnRow>(
  `select table_name, column_name, is_nullable, data_type, udt_name, column_default, is_identity, is_generated
   from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
)).rows;
const enums = (await database.query<EnumRow>(
  `select type_row.typname as enum_name, array_agg(enum_value.enumlabel order by enum_value.enumsortorder) as enum_values
   from pg_type type_row
   join pg_namespace namespace on namespace.oid = type_row.typnamespace
   join pg_enum enum_value on enum_value.enumtypid = type_row.oid
   where namespace.nspname = 'public'
   group by type_row.typname order by type_row.typname`,
)).rows;
// Only functions the app may call: not trigger functions, and executable by signed-in users.
const functions = (await database.query<FunctionRow>(
  `select function_row.proname as function_name, function_row.proargnames as argument_names,
          array(select format_type(argument_type, null) from unnest(function_row.proargtypes) as argument_type) as argument_types,
          format_type(function_row.prorettype, null) as return_type
   from pg_proc function_row
   join pg_namespace namespace on namespace.oid = function_row.pronamespace
   where namespace.nspname = 'public'
     and function_row.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
   order by function_row.proname`,
)).rows;
await database.close();

const enumNames = new Set(enums.map((enumRow) => enumRow.enum_name));
const formatTypeToUdt: Record<string, string> = { uuid: 'uuid', text: 'text', boolean: 'bool', integer: 'int4', bigint: 'int8', numeric: 'numeric' };

function columnsOf(tableName: string): ColumnRow[] {
  return columns.filter((column) => column.table_name === tableName);
}

function rowType(tableName: string, everyColumnNullable: boolean): string {
  return columnsOf(tableName)
    .map((column) => {
      const baseType = typeScriptType(column.udt_name, enumNames);
      const nullable = everyColumnNullable || column.is_nullable === 'YES';
      return `          ${column.column_name}: ${baseType}${nullable ? ' | null' : ''}`;
    })
    .join('\n');
}

function insertType(tableName: string, everyColumnOptional: boolean): string {
  return columnsOf(tableName)
    .map((column) => {
      const baseType = typeScriptType(column.udt_name, enumNames);
      const nullable = column.is_nullable === 'YES';
      if (column.is_generated === 'ALWAYS') {
        return `          ${column.column_name}?: never`;
      }
      const optional = everyColumnOptional || nullable || column.column_default !== null || column.is_identity === 'YES';
      return `          ${column.column_name}${optional ? '?' : ''}: ${baseType}${nullable ? ' | null' : ''}`;
    })
    .join('\n');
}

const tableBlocks = relations
  .filter((relation) => relation.table_type === 'BASE TABLE')
  .map(
    (relation) => `      ${relation.table_name}: {
        Row: {
${rowType(relation.table_name, false)}
        }
        Insert: {
${insertType(relation.table_name, false)}
        }
        Update: {
${insertType(relation.table_name, true)}
        }
        Relationships: []
      }`,
  );

const viewBlocks = relations
  .filter((relation) => relation.table_type === 'VIEW')
  .map(
    (relation) => `      ${relation.table_name}: {
        Row: {
${rowType(relation.table_name, true)}
        }
        Relationships: []
      }`,
  );

const functionBlocks = functions.map((functionRow) => {
  const argumentLines = functionRow.argument_types.map((argumentType, index) => {
    const argumentName = functionRow.argument_names?.[index] ?? `argument_${index + 1}`;
    return `          ${argumentName}: ${typeScriptType(formatTypeToUdt[argumentType] ?? argumentType, enumNames)}`;
  });
  return `      ${functionRow.function_name}: {
        Args: {
${argumentLines.join('\n')}
        }
        Returns: ${typeScriptType(formatTypeToUdt[functionRow.return_type] ?? functionRow.return_type, enumNames)}
      }`;
});

const enumBlocks = enums.map((enumRow) => `      ${enumRow.enum_name}: ${enumRow.enum_values.map((value) => `'${value}'`).join(' | ')}`);

const output = `// Generated by scripts/generate-database-types.ts from supabase/migrations. Do not edit by hand.
// Regenerate with \`pnpm types:local\` (or from staging with \`supabase gen types typescript\`).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
${tableBlocks.join('\n')}
    }
    Views: {
${viewBlocks.join('\n')}
    }
    Functions: {
${functionBlocks.join('\n')}
    }
    Enums: {
${enumBlocks.join('\n')}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database['public']

/** A table's row type, for example Tables<'tenders'>. */
export type Tables<TableName extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][TableName]['Row']

/** An enum's union type, for example Enums<'tender_status'>. */
export type Enums<EnumName extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][EnumName]
`;

writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath.pathname}: ${tableBlocks.length} tables, ${viewBlocks.length} views, ${functionBlocks.length} functions, ${enumBlocks.length} enums.`);
