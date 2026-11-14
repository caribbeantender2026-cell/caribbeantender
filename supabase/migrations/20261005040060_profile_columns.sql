-- Profile columns the PRD adds (section 7), and the caller checks every write function shares.
--
-- is_active: an admin can deactivate a user. Every write function calls private.require_active_user,
-- so a deactivated user cannot act even while an access token issued before deactivation is valid.

alter table public.profiles
  add column accepted_terms_at timestamptz,
  add column is_active boolean not null default true,
  add column onboarding_completed jsonb not null default '{}'::jsonb,
  add constraint profiles_onboarding_completed_is_object check (jsonb_typeof(onboarding_completed) = 'object');

comment on column public.profiles.accepted_terms_at is
  'When the user ticked "I agree to the Terms of Service and Privacy Policy" at sign-up. Empty for users created before this column existed.';
comment on column public.profiles.onboarding_completed is
  'Per account type, when the onboarding tour was completed or skipped, for example {"supplier": "2026-11-20T15:00:00Z"}.';

-- Whether the signed-in caller has an active profile. Used inside row-level security policies.
create function private.caller_is_active() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.is_active
  );
$$;

-- The same rule for write functions: returns the caller, or stops with a reason a person can act on.
create function private.require_active_user() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do this.' using errcode = 'insufficient_privilege';
  end if;
  if not private.caller_is_active() then
    raise exception 'This account has been deactivated. Contact CaribbeanTender for help.' using errcode = 'insufficient_privilege';
  end if;
  return auth.uid();
end;
$$;

-- Storage folder names are text; a folder that isn't a UUID must simply match nothing, not error.
create function private.try_uuid(candidate text) returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return candidate::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

-- Records that the signed-in user finished or skipped the onboarding tour for one account type (P1-02).
create function public.record_onboarding_completed(completed_account_type public.account_type) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
begin
  update public.profiles profile
  set onboarding_completed = profile.onboarding_completed || jsonb_build_object(completed_account_type::text, now())
  where profile.id = caller_id;
end;
$$;

revoke all on function private.require_active_user() from public, anon, authenticated;
revoke all on function private.caller_is_active() from public, anon, authenticated;
revoke all on function private.try_uuid(text) from public, anon, authenticated;
revoke all on function public.record_onboarding_completed(public.account_type) from public, anon, authenticated;
-- Row-level security policies call caller_is_active as the querying role, so it needs the grant.
grant execute on function private.caller_is_active() to authenticated;
grant execute on function public.record_onboarding_completed(public.account_type) to authenticated;
