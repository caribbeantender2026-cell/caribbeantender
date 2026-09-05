-- Run only if your public.profiles table is missing or does not have these fields.
-- Review first if you already have production data.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company_name text,
  company_address text,
  phone text,
  email text,
  description text,
  industry_category text,
  account_type text check (account_type in ('business','supplier')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

grant select, insert, update on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, account_type)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, lower(coalesce(new.raw_user_meta_data->>'account_type','')))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
