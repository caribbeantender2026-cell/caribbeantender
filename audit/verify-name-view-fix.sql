-- Checks for supabase/migrations/20261005031017_revoke_writes_on_public_name_views.sql.
-- Run each check on its own in the SQL Editor (select it, then Run).


-- Check 1 (read-only): privileges on both views, straight from the catalog.
-- Expected after the fix: 4 rows, can_select = true, can_insert/can_update/can_delete = false.
select
  view_name,
  role_name,
  has_table_privilege(role_name::name, format('public.%I', view_name), 'SELECT') as can_select,
  has_table_privilege(role_name::name, format('public.%I', view_name), 'INSERT') as can_insert,
  has_table_privilege(role_name::name, format('public.%I', view_name), 'UPDATE') as can_update,
  has_table_privilege(role_name::name, format('public.%I', view_name), 'DELETE') as can_delete
from unnest(array['supplier_names_public', 'business_names_public']) as view_name
cross join unnest(array['anon', 'authenticated']) as role_name
order by view_name, role_name;


-- Check 2: actually attempt a read and each write as anon and as authenticated.
-- It cannot change data: every statement matches no rows (where false / limit 0), and the
-- block always ends by raising an error, which rolls back everything it did.
-- The result is that error's message, one line per attempt.
-- Expected after the fix: select "allowed"; update, delete and insert "refused".
do $$
declare
  role_name text;
  view_name text;
  attempt text;
  outcomes text[] := '{}';
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach view_name in array array['supplier_names_public', 'business_names_public'] loop
      foreach attempt in array array[
        format('select user_id from public.%I limit 0', view_name),
        format('update public.%I set company_name = company_name where false', view_name),
        format('delete from public.%I where false', view_name),
        format('insert into public.%1$I (user_id, company_name) select user_id, company_name from public.%1$I where false', view_name)
      ] loop
        begin
          execute format('set local role %I', role_name);
          execute attempt;
          outcomes := outcomes || format('allowed | %s | %s', role_name, attempt);
        exception when insufficient_privilege then
          outcomes := outcomes || format('refused | %s | %s', role_name, attempt);
        end;
        reset role;
      end loop;
    end loop;
  end loop;
  raise exception E'Name view check finished, nothing kept:\n%', array_to_string(outcomes, E'\n');
end
$$;
