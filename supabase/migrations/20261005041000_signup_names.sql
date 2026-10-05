-- P2: sign-up must not fail because of the name.
--
-- profiles.full_name must be 2-120 characters, but the signup trigger inserted the raw metadata
-- name, or '' when it was missing. A one-letter name, a name of spaces, or a user created without
-- metadata (for example from the dashboard) made the whole auth.users insert fail.
-- The trigger also never set profiles.account_type; it now does when the value is valid.

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
    when char_length(requested_name) >= 2 then left(requested_name, 120)
    when char_length(email_name) >= 2 then left(email_name, 120)
    else 'New user'
  end;

  insert into public.profiles (id, full_name, email, account_type)
  values (
    new.id,
    display_name,
    new.email,
    case when selected_account_type in ('business', 'supplier') then selected_account_type::public.account_type end
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

-- Never attached to a trigger, and its plain insert would break sign-up if it were (AUDIT.md cleanup).
drop function public.handle_new_user();
