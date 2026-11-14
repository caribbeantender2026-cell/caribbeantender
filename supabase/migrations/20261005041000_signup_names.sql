-- A7: sign-up must not fail because of a short or missing name (AUDIT.md cleanup; PRD P1-01).
--
-- Names are 1 to 120 characters, enforced here by a constraint; the form shows the same limit.
-- Nothing is shortened silently: a name over 120 characters is refused (OPEN_QUESTIONS.md, item 23).
-- A missing or blank name (for example a user created from the dashboard) falls back to the part
-- of the email address before the @, which is never longer than 64 characters.
--
-- The trigger also records the Terms acceptance (PRD P1-01) and the account type, which it never set.

alter table public.profiles drop constraint profiles_full_name_check;
alter table public.profiles add constraint profiles_full_name_check check (char_length(btrim(full_name)) between 1 and 120);

create or replace function public.handle_new_caribbeantender_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_account_type text := lower(coalesce(new.raw_user_meta_data ->> 'account_type', ''));
  requested_name text := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  email_name text := btrim(split_part(coalesce(new.email, ''), '@', 1));
  display_name text;
begin
  display_name := case
    when requested_name <> '' then requested_name
    when email_name <> '' then email_name
    else 'New user'
  end;

  insert into public.profiles (id, full_name, email, account_type, accepted_terms_at)
  values (
    new.id,
    display_name,
    new.email,
    case when selected_account_type in ('business', 'supplier') then selected_account_type::public.account_type end,
    -- The browser only says whether the box was ticked; the time is the database's.
    case when new.raw_user_meta_data ->> 'accepted_terms' = 'true' then now() end
  )
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

  if selected_account_type = 'business' then
    insert into public.business_profiles (user_id, contact_email)
    values (new.id, new.email)
    on conflict (user_id) do nothing;
  elsif selected_account_type = 'supplier' then
    insert into public.supplier_profiles (user_id, contact_email)
    values (new.id, new.email)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Never attached to a trigger, and its plain insert would break sign-up if it were (AUDIT.md cleanup, M7).
drop function public.handle_new_user();

revoke all on function public.handle_new_caribbeantender_user() from public, anon, authenticated;
