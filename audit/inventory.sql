-- CaribbeanTender audit: read-only schema and security inventory.
--
-- Run in Supabase Dashboard > SQL Editor for project ijlcjthgwppllhlqocep.
-- This is a single SELECT over system catalogs. It does not change anything.
--
-- It returns one row per section: section_number, section, data (JSON).
-- Export the result (Results > Export > Download JSON, or Copy as JSON) and save it as
-- audit/inventory-results.json. That file is gitignored because function bodies and
-- cron job commands can contain secrets.

with
system_schemas(schema_name) as (
  values
    ('pg_catalog'), ('information_schema'), ('auth'), ('storage'), ('extensions'),
    ('graphql'), ('graphql_public'), ('realtime'), ('_realtime'), ('supabase_functions'),
    ('supabase_migrations'), ('vault'), ('pgsodium'), ('pgsodium_masks'), ('net'),
    ('cron'), ('pgbouncer'), ('_analytics'), ('pgtle'), ('topology'), ('tiger'), ('tiger_data')
),
api_roles(role_name) as (
  values ('anon'::name), ('authenticated'::name)
)

-- 1. Every table in public: RLS flags, columns, constraints, indexes, explicit grants.
select 1 as section_number, 'tables_and_columns' as section, (
  select jsonb_agg(jsonb_build_object(
      'table', table_class.relname,
      'rls_enabled', table_class.relrowsecurity,
      'rls_forced', table_class.relforcerowsecurity,
      'owner', pg_get_userbyid(table_class.relowner),
      'estimated_rows', table_class.reltuples,
      'table_grants', table_class.relacl::text[],
      'columns', (
        select jsonb_agg(jsonb_build_object(
            'column', column_attribute.attname,
            'type', format_type(column_attribute.atttypid, column_attribute.atttypmod),
            'not_null', column_attribute.attnotnull,
            'default', pg_get_expr(column_default.adbin, column_default.adrelid),
            'generated', nullif(column_attribute.attgenerated::text, ''),
            'column_grants', column_attribute.attacl::text[]
          ) order by column_attribute.attnum)
        from pg_attribute column_attribute
        left join pg_attrdef column_default
          on column_default.adrelid = column_attribute.attrelid
         and column_default.adnum = column_attribute.attnum
        where column_attribute.attrelid = table_class.oid
          and column_attribute.attnum > 0
          and not column_attribute.attisdropped
      ),
      'constraints', (
        select jsonb_agg(jsonb_build_object(
            'constraint', table_constraint.conname,
            'definition', pg_get_constraintdef(table_constraint.oid)
          ) order by table_constraint.conname)
        from pg_constraint table_constraint
        where table_constraint.conrelid = table_class.oid
      ),
      'indexes', (
        select jsonb_agg(pg_get_indexdef(table_index.indexrelid))
        from pg_index table_index
        where table_index.indrelid = table_class.oid
      )
    ) order by table_class.relname)
  from pg_class table_class
  join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
  where table_namespace.nspname = 'public'
    and table_class.relkind in ('r', 'p')
) as data

-- 2. Effective privileges of anon and authenticated on every public table and view,
--    including which columns each role can select, insert and update.
union all
select 2, 'api_role_privileges', (
  select jsonb_agg(jsonb_build_object(
      'object', table_class.relname,
      'kind', case table_class.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end,
      'role', api_role.role_name,
      'table_select', has_table_privilege(api_role.role_name, table_class.oid, 'SELECT'),
      'table_insert', has_table_privilege(api_role.role_name, table_class.oid, 'INSERT'),
      'table_update', has_table_privilege(api_role.role_name, table_class.oid, 'UPDATE'),
      'table_delete', has_table_privilege(api_role.role_name, table_class.oid, 'DELETE'),
      'table_truncate', has_table_privilege(api_role.role_name, table_class.oid, 'TRUNCATE'),
      'columns_select', (
        select jsonb_agg(column_attribute.attname order by column_attribute.attnum)
        from pg_attribute column_attribute
        where column_attribute.attrelid = table_class.oid
          and column_attribute.attnum > 0
          and not column_attribute.attisdropped
          and has_column_privilege(api_role.role_name, table_class.oid, column_attribute.attnum, 'SELECT')
      ),
      'columns_insert', (
        select jsonb_agg(column_attribute.attname order by column_attribute.attnum)
        from pg_attribute column_attribute
        where column_attribute.attrelid = table_class.oid
          and column_attribute.attnum > 0
          and not column_attribute.attisdropped
          and has_column_privilege(api_role.role_name, table_class.oid, column_attribute.attnum, 'INSERT')
      ),
      'columns_update', (
        select jsonb_agg(column_attribute.attname order by column_attribute.attnum)
        from pg_attribute column_attribute
        where column_attribute.attrelid = table_class.oid
          and column_attribute.attnum > 0
          and not column_attribute.attisdropped
          and has_column_privilege(api_role.role_name, table_class.oid, column_attribute.attnum, 'UPDATE')
      )
    ) order by table_class.relname, api_role.role_name)
  from pg_class table_class
  join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
  cross join api_roles api_role
  where table_namespace.nspname = 'public'
    and table_class.relkind in ('r', 'p', 'v', 'm')
)

-- 3. Every RLS policy on public tables and on storage tables, with a full CREATE POLICY statement.
union all
select 3, 'policies', (
  select jsonb_agg(jsonb_build_object(
      'schema', policy_row.schemaname,
      'table', policy_row.tablename,
      'policy', policy_row.policyname,
      'permissive', policy_row.permissive,
      'roles', policy_row.roles,
      'command', policy_row.cmd,
      'using', policy_row.qual,
      'with_check', policy_row.with_check,
      'statement', format(
        'create policy %I on %I.%I as %s for %s to %s%s%s;',
        policy_row.policyname, policy_row.schemaname, policy_row.tablename,
        policy_row.permissive, policy_row.cmd, array_to_string(policy_row.roles, ', '),
        coalesce(' using (' || policy_row.qual || ')', ''),
        coalesce(' with check (' || policy_row.with_check || ')', '')
      )
    ) order by policy_row.schemaname, policy_row.tablename, policy_row.policyname)
  from pg_policies policy_row
  where policy_row.schemaname in ('public', 'storage')
)

-- 4. User-defined functions (not from extensions or Supabase-managed schemas),
--    with SECURITY DEFINER flag, search_path setting, EXECUTE rights and full definition.
union all
select 4, 'functions', (
  select jsonb_agg(jsonb_build_object(
      'schema', function_namespace.nspname,
      'function', function_row.proname,
      'arguments', pg_get_function_identity_arguments(function_row.oid),
      'returns', pg_get_function_result(function_row.oid),
      'security_definer', function_row.prosecdef,
      'volatility', function_row.provolatile::text,
      'settings', function_row.proconfig,
      'owner', pg_get_userbyid(function_row.proowner),
      'grants', function_row.proacl::text[],
      'anon_can_execute', has_function_privilege('anon', function_row.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', function_row.oid, 'EXECUTE'),
      'definition', case when function_row.prokind in ('f', 'p') then pg_get_functiondef(function_row.oid) end
    ) order by function_namespace.nspname, function_row.proname)
  from pg_proc function_row
  join pg_namespace function_namespace on function_namespace.oid = function_row.pronamespace
  where function_namespace.nspname not in (select schema_name from system_schemas)
    and function_namespace.nspname not like 'pg\_%'
    and not exists (
      select 1
      from pg_depend extension_dependency
      where extension_dependency.objid = function_row.oid
        and extension_dependency.deptype = 'e'
    )
)

-- 5. Triggers on public tables, on auth.users, and any trigger that calls a user-defined function.
union all
select 5, 'triggers', (
  select jsonb_agg(jsonb_build_object(
      'schema', table_namespace.nspname,
      'table', table_class.relname,
      'trigger', trigger_row.tgname,
      'enabled', trigger_row.tgenabled::text,
      'function', trigger_row.tgfoid::regprocedure::text,
      'definition', pg_get_triggerdef(trigger_row.oid)
    ) order by table_namespace.nspname, table_class.relname, trigger_row.tgname)
  from pg_trigger trigger_row
  join pg_class table_class on table_class.oid = trigger_row.tgrelid
  join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
  join pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
  join pg_namespace function_namespace on function_namespace.oid = trigger_function.pronamespace
  where not trigger_row.tgisinternal
    and (
      table_namespace.nspname = 'public'
      or (table_namespace.nspname = 'auth' and table_class.relname = 'users')
      or function_namespace.nspname not in (select schema_name from system_schemas)
    )
)

-- 6. Views in public, including supplier_names_public and business_names_public.
--    A view without security_invoker=true runs as its owner; owner_bypasses_rls shows if RLS is skipped.
union all
select 6, 'views', (
  select jsonb_agg(jsonb_build_object(
      'view', view_class.relname,
      'kind', case view_class.relkind when 'm' then 'materialized view' else 'view' end,
      'owner', pg_get_userbyid(view_class.relowner),
      'owner_bypasses_rls', (
        select owner_role.rolsuper or owner_role.rolbypassrls
        from pg_roles owner_role
        where owner_role.oid = view_class.relowner
      ),
      'options', view_class.reloptions,
      'grants', view_class.relacl::text[],
      'definition', pg_get_viewdef(view_class.oid, true)
    ) order by view_class.relname)
  from pg_class view_class
  join pg_namespace view_namespace on view_namespace.oid = view_class.relnamespace
  where view_namespace.nspname = 'public'
    and view_class.relkind in ('v', 'm')
)

-- 7. Storage buckets: public flag, size limit, allowed MIME types (all columns).
union all
select 7, 'storage_buckets', (
  select jsonb_agg(to_jsonb(bucket) order by bucket.id)
  from storage.buckets bucket
)

-- 8. RLS status and grants on the storage tables the policies above apply to.
union all
select 8, 'storage_tables', (
  select jsonb_agg(jsonb_build_object(
      'table', storage_class.relname,
      'rls_enabled', storage_class.relrowsecurity,
      'rls_forced', storage_class.relforcerowsecurity,
      'table_grants', storage_class.relacl::text[]
    ) order by storage_class.relname)
  from pg_class storage_class
  join pg_namespace storage_namespace on storage_namespace.oid = storage_class.relnamespace
  where storage_namespace.nspname = 'storage'
    and storage_class.relname in ('objects', 'buckets')
)

-- 9. Enum types in public (for example, a subscription_status enum).
union all
select 9, 'enum_types', (
  select jsonb_agg(jsonb_build_object(
      'type', enum_type.typname,
      'values', (
        select jsonb_agg(enum_value.enumlabel order by enum_value.enumsortorder)
        from pg_enum enum_value
        where enum_value.enumtypid = enum_type.oid
      )
    ) order by enum_type.typname)
  from pg_type enum_type
  join pg_namespace type_namespace on type_namespace.oid = enum_type.typnamespace
  where type_namespace.nspname = 'public'
    and enum_type.typtype = 'e'
)

-- 10. Schemas that are not Supabase-managed (anything besides public needs a follow-up).
union all
select 10, 'custom_schemas', (
  select jsonb_agg(schema_row.nspname order by schema_row.nspname)
  from pg_namespace schema_row
  where schema_row.nspname not in (select schema_name from system_schemas)
    and schema_row.nspname not like 'pg\_%'
)

-- 11. Installed extensions.
union all
select 11, 'extensions', (
  select jsonb_agg(jsonb_build_object(
      'extension', installed_extension.extname,
      'version', installed_extension.extversion,
      'schema', extension_namespace.nspname
    ) order by installed_extension.extname)
  from pg_extension installed_extension
  join pg_namespace extension_namespace on extension_namespace.oid = installed_extension.extnamespace
)

-- 12. Default privileges: what new tables and functions automatically grant to anon and authenticated.
union all
select 12, 'default_privileges', (
  select jsonb_agg(jsonb_build_object(
      'granting_role', pg_get_userbyid(default_privilege.defaclrole),
      'schema', default_namespace.nspname,
      'object_type', default_privilege.defaclobjtype::text,
      'grants', default_privilege.defaclacl::text[]
    ))
  from pg_default_acl default_privilege
  left join pg_namespace default_namespace on default_namespace.oid = default_privilege.defaclnamespace
  where default_namespace.nspname is null or default_namespace.nspname = 'public'
)

-- 13. Public tables broadcast through Supabase Realtime.
union all
select 13, 'realtime_tables', (
  select jsonb_agg(jsonb_build_object(
      'publication', publication_table.pubname,
      'table', publication_table.tablename
    ) order by publication_table.pubname, publication_table.tablename)
  from pg_publication_tables publication_table
  where publication_table.schemaname = 'public'
)

-- 14. pg_cron jobs, only if pg_cron is installed (returned as XML text).
union all
select 14, 'cron_jobs', (
  case
    when to_regclass('cron.job') is null then to_jsonb('pg_cron is not installed'::text)
    else to_jsonb(query_to_xml(
      'select jobid, jobname, schedule, command, active from cron.job order by jobid',
      false, false, ''
    )::text)
  end
)

order by section_number;
