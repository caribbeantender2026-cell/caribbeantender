-- Read-only: exact row count of every table in the public schema.
-- Used before and after applying the name-view fix (audit/row-counts-before.txt, audit/row-counts-after.txt).
-- query_to_xml runs one "select count(*)" per table, so tables added later are included automatically.
select
  table_class.relname as table_name,
  (xpath(
    '/row/row_count/text()',
    query_to_xml(format('select count(*) as row_count from public.%I', table_class.relname), false, true, '')
  ))[1]::text::bigint as row_count
from pg_class table_class
join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
where table_namespace.nspname = 'public'
  and table_class.relkind in ('r', 'p')
order by table_class.relname;
