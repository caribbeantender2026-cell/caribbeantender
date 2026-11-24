-- Every business completes the Business Registration Form before it can post tenders (Rockell's review,
-- 22 Nov 2026). The app sends an unregistered business to the form; the database refuses its tenders too,
-- so the rule holds for anyone calling the API directly.

-- Her wording for the form's introduction; its fields and layout stay as they are.
update public.form_definitions
set schema = jsonb_set(schema, '{description}', to_jsonb('Provide your company details to register as a buyer on Caribbean Tender. Documents such as your Business Registration Certificate and Business TRN are required for account verification.'::text))
where key = 'business-registration';

-- Registered means a saved Business Registration Form with every required answer filled in, checked
-- against the version it was saved under. A partly saved form doesn't count.
create function private.business_is_registered(business_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.form_submissions submission
    join public.form_definitions definition on definition.key = submission.form_key and definition.version = submission.form_version
    where submission.owner_id = business_is_registered.business_id
      and submission.form_key = 'business-registration'
      and cardinality(private.form_data_problems(definition.schema, submission.data, true)) = 0
  );
$$;
revoke all on function private.business_is_registered(uuid) from public, anon, authenticated;

-- For the app: whether the signed-in person's business is registered.
create function public.business_registration_complete() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.business_is_registered((select auth.uid()));
$$;
revoke all on function public.business_registration_complete() from public, anon, authenticated;
grant execute on function public.business_registration_complete() to authenticated;

-- Creating a tender and publishing a draft both need the form. Only signed-in people are held to it:
-- the service role (and test fixtures) has no auth.uid(), and visitors can't write tenders at all.
create function private.require_business_registration() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' or (old.status = 'draft' and new.status <> 'draft'))
     and not private.business_is_registered(new.business_id) then
    raise exception 'Complete your Business Registration Form (on the Forms page) before posting tenders.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.require_business_registration() from public, anon, authenticated;

create trigger require_business_registration
before insert or update of status on public.tenders
for each row execute function private.require_business_registration();
