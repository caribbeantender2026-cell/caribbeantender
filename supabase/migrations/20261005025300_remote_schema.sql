-- CaribbeanTender remote schema, reconstructed 2026-10-05 from project ijlcjthgwppllhlqocep.
--
-- Source: read-only catalog queries (audit/inventory.sql), not pg_dump. Docker was not used.
-- The remote migration history table was NOT updated, so the live project does not know this
-- migration exists. Do not run "supabase db push" against the live project: it would try to
-- apply this file there. Use it to build local and staging databases.
--
-- Not included: table data (except storage bucket settings), Supabase-managed schemas,
-- default privileges, Auth settings, and the payment-webhook Edge Function (see supabase/functions).

set search_path to public, extensions;

-- Schemas
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Enum types
create type public.account_type as enum ('business', 'supplier');
create type public.tender_status as enum ('open', 'closed', 'cancelled');

-- Tables
create table public.bids (
  id uuid default gen_random_uuid() not null,
  tender_id uuid not null,
  supplier_id uuid not null,
  amount numeric(14,2) not null,
  document_path text not null,
  document_name text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.business_profiles (
  user_id uuid not null,
  company_name text,
  address text,
  phone text,
  contact_email text,
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_address text
);
create table public.profiles (
  id uuid not null,
  full_name text not null,
  account_type account_type,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_address text,
  phone text,
  email text,
  description text,
  industry_category text,
  company_name text
);
create table public.subscription_events (
  id uuid default gen_random_uuid() not null,
  supplier_id uuid not null,
  provider text default 'system'::text not null,
  provider_event_id text,
  event_type text not null,
  subscription_plan text,
  amount numeric(12,2),
  currency text,
  status text not null,
  occurred_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  metadata jsonb
);
create table public.subscription_plans (
  id uuid default gen_random_uuid() not null,
  plan_code text not null,
  plan_name text not null,
  description text,
  price numeric(12,2) not null,
  currency text default 'USD'::text not null,
  billing_interval text not null,
  interval_count integer default 1 not null,
  is_active boolean default true not null,
  provider_product_id text,
  provider_price_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.supplier_profiles (
  user_id uuid not null,
  company_name text,
  address text,
  industry_category text,
  phone text,
  contact_email text,
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_address text,
  trial_started_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  subscription_status text,
  subscription_plan text,
  subscription_started_at timestamp with time zone,
  subscription_ends_at timestamp with time zone,
  payment_customer_id text,
  payment_subscription_id text
);
create table public.tenders (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  title text not null,
  description text not null,
  closing_date date not null,
  status tender_status default 'open'::tender_status not null,
  document_path text,
  document_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Primary keys, unique and check constraints
alter table public.bids add constraint bids_amount_check CHECK ((amount > (0)::numeric));
alter table public.bids add constraint bids_pkey PRIMARY KEY (id);
alter table public.bids add constraint bids_tender_id_supplier_id_key UNIQUE (tender_id, supplier_id);
alter table public.business_profiles add constraint business_profiles_company_name_check CHECK (((length(company_name) >= 2) AND (length(company_name) <= 160)));
alter table public.business_profiles add constraint business_profiles_pkey PRIMARY KEY (user_id);
alter table public.profiles add constraint profiles_full_name_check CHECK (((length(full_name) >= 2) AND (length(full_name) <= 120)));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.subscription_events add constraint subscription_events_pkey PRIMARY KEY (id);
alter table public.subscription_plans add constraint subscription_plans_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['month'::text, 'year'::text])));
alter table public.subscription_plans add constraint subscription_plans_interval_count_check CHECK ((interval_count > 0));
alter table public.subscription_plans add constraint subscription_plans_pkey PRIMARY KEY (id);
alter table public.subscription_plans add constraint subscription_plans_plan_code_key UNIQUE (plan_code);
alter table public.subscription_plans add constraint subscription_plans_price_check CHECK ((price >= (0)::numeric));
alter table public.supplier_profiles add constraint supplier_profiles_company_name_check CHECK (((length(company_name) >= 2) AND (length(company_name) <= 160)));
alter table public.supplier_profiles add constraint supplier_profiles_pkey PRIMARY KEY (user_id);
alter table public.tenders add constraint tenders_closing_date_check CHECK ((closing_date >= CURRENT_DATE));
alter table public.tenders add constraint tenders_pkey PRIMARY KEY (id);
alter table public.tenders add constraint tenders_title_check CHECK (((length(title) >= 3) AND (length(title) <= 200)));

-- Foreign keys
alter table public.bids add constraint bids_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier_profiles(user_id) ON DELETE CASCADE;
alter table public.bids add constraint bids_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE CASCADE;
alter table public.business_profiles add constraint business_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.subscription_events add constraint subscription_events_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES supplier_profiles(user_id) ON DELETE CASCADE;
alter table public.supplier_profiles add constraint supplier_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.tenders add constraint tenders_business_id_fkey FOREIGN KEY (business_id) REFERENCES business_profiles(user_id) ON DELETE CASCADE;

-- Indexes not created by constraints
CREATE INDEX bids_tender_id_idx ON public.bids USING btree (tender_id);
CREATE INDEX bids_supplier_id_idx ON public.bids USING btree (supplier_id);
CREATE UNIQUE INDEX bids_one_per_supplier_per_tender ON public.bids USING btree (tender_id, supplier_id);
CREATE UNIQUE INDEX business_profiles_one_per_user ON public.business_profiles USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE UNIQUE INDEX subscription_events_provider_event_unique ON public.subscription_events USING btree (provider, provider_event_id) WHERE (provider_event_id IS NOT NULL);
CREATE INDEX subscription_events_supplier_id_idx ON public.subscription_events USING btree (supplier_id);
CREATE INDEX subscription_events_occurred_at_idx ON public.subscription_events USING btree (occurred_at DESC);
CREATE INDEX subscription_events_event_type_idx ON public.subscription_events USING btree (event_type);
CREATE UNIQUE INDEX supplier_profiles_one_per_user ON public.supplier_profiles USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX tenders_business_id_idx ON public.tenders USING btree (business_id);
CREATE INDEX tenders_open_idx ON public.tenders USING btree (status, closing_date);

-- Functions
CREATE OR REPLACE FUNCTION private.process_subscription_payment(p_supplier_id uuid, p_provider text, p_provider_event_id text, p_plan_code text, p_paid_amount numeric, p_paid_currency text, p_payment_customer_id text DEFAULT NULL::text, p_payment_subscription_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_now timestamptz := now();

    v_current_status text;
    v_current_end timestamptz;

    v_plan_name text;
    v_expected_price numeric;
    v_expected_currency text;
    v_billing_interval text;
    v_interval_count integer;

    v_new_end timestamptz;
    v_event_id uuid;
begin

    /* ========================================================
       1. Validate basic inputs
       ======================================================== */

    if p_supplier_id is null then
        raise exception 'Supplier ID is required';
    end if;

    if p_provider is null or btrim(p_provider) = '' then
        raise exception 'Payment provider is required';
    end if;

    if p_provider_event_id is null
       or btrim(p_provider_event_id) = '' then
        raise exception 'Provider event ID is required';
    end if;

    if p_plan_code is null
       or btrim(p_plan_code) = '' then
        raise exception 'Plan code is required';
    end if;

    if p_paid_amount is null or p_paid_amount < 0 then
        raise exception 'Invalid payment amount';
    end if;

    if p_paid_currency is null
       or btrim(p_paid_currency) = '' then
        raise exception 'Payment currency is required';
    end if;


    /* ========================================================
       2. Find the plan in CaribbeanTender's database

       IMPORTANT:
       We deliberately do not require is_active = true here yet.

       Activation of plans will happen only when the actual
       payment integration is ready.
       ======================================================== */

    select
        sp.plan_name,
        sp.price,
        sp.currency,
        sp.billing_interval,
        sp.interval_count
    into
        v_plan_name,
        v_expected_price,
        v_expected_currency,
        v_billing_interval,
        v_interval_count
    from public.subscription_plans sp
    where sp.plan_code = p_plan_code;

    if not found then
        raise exception 'Unknown subscription plan';
    end if;


    /* ========================================================
       3. Validate currency
       ======================================================== */

    if upper(btrim(p_paid_currency))
       <> upper(btrim(v_expected_currency)) then

        raise exception
            'Payment currency does not match subscription plan';

    end if;


    /* ========================================================
       4. Validate amount

       The payment must exactly match the configured backend
       price.
       ======================================================== */

    if p_paid_amount <> v_expected_price then

        raise exception
            'Payment amount does not match subscription plan';

    end if;


    /* ========================================================
       5. Find Supplier and lock the row
       ======================================================== */

    select
        sp.subscription_status,
        sp.subscription_ends_at
    into
        v_current_status,
        v_current_end
    from public.supplier_profiles sp
    where sp.user_id = p_supplier_id
    for update;

    if not found then
        raise exception 'Supplier profile not found';
    end if;


    /* ========================================================
       6. Duplicate provider-event protection
       ======================================================== */

    if exists (
        select 1
        from public.subscription_events se
        where se.provider = p_provider
          and se.provider_event_id = p_provider_event_id
    ) then

        return jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message', 'Event already processed'
        );

    end if;


    /* ========================================================
       7. Calculate subscription period from DATABASE plan

       The caller does NOT determine the duration.
       ======================================================== */

    if v_current_status = 'active'
       and v_current_end is not null
       and v_current_end > v_now then

        if v_billing_interval = 'month' then

            v_new_end :=
                v_current_end
                + make_interval(
                    months => v_interval_count
                );

        elsif v_billing_interval = 'year' then

            v_new_end :=
                v_current_end
                + make_interval(
                    years => v_interval_count
                );

        else
            raise exception
                'Unsupported subscription billing interval';
        end if;

    else

        if v_billing_interval = 'month' then

            v_new_end :=
                v_now
                + make_interval(
                    months => v_interval_count
                );

        elsif v_billing_interval = 'year' then

            v_new_end :=
                v_now
                + make_interval(
                    years => v_interval_count
                );

        else
            raise exception
                'Unsupported subscription billing interval';
        end if;

    end if;


    /* ========================================================
       8. Record verified event
       ======================================================== */

    insert into public.subscription_events (
        supplier_id,
        provider,
        provider_event_id,
        event_type,
        subscription_plan,
        amount,
        currency,
        status,
        occurred_at,
        metadata
    )
    values (
        p_supplier_id,
        p_provider,
        p_provider_event_id,
        'payment_succeeded',
        p_plan_code,
        v_expected_price,
        upper(v_expected_currency),
        'processed',
        v_now,
        jsonb_build_object(
            'plan_name', v_plan_name,
            'previous_status', v_current_status,
            'previous_subscription_end', v_current_end,
            'new_subscription_end', v_new_end
        )
    )
    returning id into v_event_id;


    /* ========================================================
       9. Activate/update Supplier
       ======================================================== */

    update public.supplier_profiles
    set
        subscription_status = 'active',

        subscription_plan = p_plan_code,

        subscription_started_at =
            case
                when subscription_status = 'active'
                     and subscription_started_at is not null
                then subscription_started_at
                else v_now
            end,

        subscription_ends_at = v_new_end,

        payment_customer_id =
            coalesce(
                p_payment_customer_id,
                payment_customer_id
            ),

        payment_subscription_id =
            coalesce(
                p_payment_subscription_id,
                payment_subscription_id
            )

    where user_id = p_supplier_id;


    /* ========================================================
       10. Return trusted result
       ======================================================== */

    return jsonb_build_object(
        'success', true,
        'duplicate', false,
        'event_id', v_event_id,
        'supplier_id', p_supplier_id,
        'plan_code', p_plan_code,
        'plan_name', v_plan_name,
        'amount', v_expected_price,
        'currency', upper(v_expected_currency),
        'subscription_status', 'active',
        'subscription_ends_at', v_new_end
    );

end;
$function$;

CREATE OR REPLACE FUNCTION private.supplier_has_access(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select exists (
        select 1
        from public.supplier_profiles sp
        where sp.user_id = p_user_id
        and (
            (
                sp.subscription_status = 'trial'
                and sp.trial_ends_at > now()
            )
            or
            (
                sp.subscription_status = 'active'
                and (
                    sp.subscription_ends_at is null
                    or sp.subscription_ends_at > now()
                )
            )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_caribbeantender_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare selected_type text;
begin
  selected_type := lower(coalesce(new.raw_user_meta_data ->> 'account_type',''));

  insert into public.profiles(id,full_name,email)
  values(
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name',''),
    new.email
  )
  on conflict(id) do update set
    full_name=excluded.full_name,
    email=excluded.email;

  if selected_type='business' then
    insert into public.business_profiles(user_id,contact_email)
    values(new.id,new.email)
    on conflict(user_id) do nothing;
  elsif selected_type='supplier' then
    insert into public.supplier_profiles(user_id,contact_email)
    values(new.id,new.email)
    on conflict(user_id) do nothing;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles(id,full_name,account_type) values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'New user'),(new.raw_user_meta_data->>'account_type')::public.account_type);
  return new;
exception when others then raise log 'profile creation failed for user %: %',new.id,sqlerrm; raise;
end $function$;

CREATE OR REPLACE FUNCTION public.set_supplier_trial()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin

    -- Every newly created Supplier starts a new 14-day trial.
    -- Values supplied by the browser for these fields are ignored.

    new.trial_started_at := now();

    new.trial_ends_at :=
        now() + interval '14 days';

    new.subscription_status := 'trial';

    -- A new Supplier cannot create itself with a paid plan.
    new.subscription_plan := null;

    new.subscription_started_at := null;

    new.subscription_ends_at := null;

    -- Payment identifiers must only come from
    -- trusted payment/backend processes.
    new.payment_customer_id := null;

    new.payment_subscription_id := null;

    return new;

end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;

-- Function execute rights
revoke all on function private.process_subscription_payment(p_supplier_id uuid, p_provider text, p_provider_event_id text, p_plan_code text, p_paid_amount numeric, p_paid_currency text, p_payment_customer_id text, p_payment_subscription_id text) from public, anon, authenticated, service_role;
revoke all on function private.supplier_has_access(p_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function private.supplier_has_access(p_user_id uuid) to authenticated;
revoke all on function public.handle_new_caribbeantender_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_caribbeantender_user() to public;
grant execute on function public.handle_new_caribbeantender_user() to anon;
grant execute on function public.handle_new_caribbeantender_user() to authenticated;
grant execute on function public.handle_new_caribbeantender_user() to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to public;
grant execute on function public.handle_new_user() to anon;
grant execute on function public.handle_new_user() to authenticated;
grant execute on function public.handle_new_user() to service_role;
revoke all on function public.set_supplier_trial() from public, anon, authenticated, service_role;
grant execute on function public.set_supplier_trial() to public;
grant execute on function public.set_supplier_trial() to anon;
grant execute on function public.set_supplier_trial() to authenticated;
grant execute on function public.set_supplier_trial() to service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to public;
grant execute on function public.set_updated_at() to anon;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.set_updated_at() to service_role;

-- Views (these run as their owner, postgres; see AUDIT.md finding C1)
create view public.business_names_public as
SELECT user_id,
    company_name
   FROM business_profiles;
create view public.supplier_names_public as
SELECT user_id,
    company_name
   FROM supplier_profiles;

-- Triggers
CREATE TRIGGER on_caribbeantender_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_caribbeantender_user();
CREATE TRIGGER bids_updated BEFORE UPDATE ON public.bids FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER business_profiles_updated BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_subscription_plans_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_supplier_profiles_updated_at BEFORE UPDATE ON public.supplier_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_supplier_trial_on_insert BEFORE INSERT ON public.supplier_profiles FOR EACH ROW EXECUTE FUNCTION set_supplier_trial();
CREATE TRIGGER tenders_updated BEFORE UPDATE ON public.tenders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row-level security
alter table public.bids enable row level security;
alter table public.business_profiles enable row level security;
alter table public.profiles enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.supplier_profiles enable row level security;
alter table public.tenders enable row level security;

-- Policies on public tables and storage.objects
create policy business_read_tender_bids on public.bids as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM tenders t
  WHERE ((t.id = bids.tender_id) AND (t.business_id = ( SELECT auth.uid() AS uid))))));
create policy supplier_insert_bid on public.bids as PERMISSIVE for INSERT to authenticated with check (((supplier_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.supplier_has_access(( SELECT auth.uid() AS uid)) AS supplier_has_access)));
create policy supplier_read_own_bids on public.bids as PERMISSIVE for SELECT to authenticated using ((supplier_id = ( SELECT auth.uid() AS uid)));
create policy business_profile_insert_own on public.business_profiles as PERMISSIVE for INSERT to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));
create policy business_profile_select_own on public.business_profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy business_profile_update_own on public.business_profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy profiles_select_own on public.profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = id));
create policy profiles_update_own on public.profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = id)) with check ((( SELECT auth.uid() AS uid) = id));
create policy supplier_read_own_subscription_events on public.subscription_events as PERMISSIVE for SELECT to authenticated using ((supplier_id = ( SELECT auth.uid() AS uid)));
create policy read_active_subscription_plans on public.subscription_plans as PERMISSIVE for SELECT to anon, authenticated using ((is_active = true));
create policy supplier_profile_insert_own on public.supplier_profiles as PERMISSIVE for INSERT to authenticated with check ((( SELECT auth.uid() AS uid) = user_id));
create policy supplier_profile_select_own on public.supplier_profiles as PERMISSIVE for SELECT to authenticated using ((( SELECT auth.uid() AS uid) = user_id));
create policy supplier_profile_update_own on public.supplier_profiles as PERMISSIVE for UPDATE to authenticated using ((( SELECT auth.uid() AS uid) = user_id)) with check ((( SELECT auth.uid() AS uid) = user_id));
create policy business_delete_own_tenders on public.tenders as PERMISSIVE for DELETE to authenticated using ((business_id = ( SELECT auth.uid() AS uid)));
create policy business_insert_tenders on public.tenders as PERMISSIVE for INSERT to authenticated with check (((business_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM business_profiles bp
  WHERE (bp.user_id = ( SELECT auth.uid() AS uid))))));
create policy business_update_own_tenders on public.tenders as PERMISSIVE for UPDATE to authenticated using ((business_id = ( SELECT auth.uid() AS uid))) with check (((business_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM business_profiles bp
  WHERE (bp.user_id = ( SELECT auth.uid() AS uid))))));
create policy tenders_public_read on public.tenders as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "authenticated users read tender files" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'tender-documents'::text));
create policy "bid parties read bid files" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bid-documents'::text) AND (EXISTS ( SELECT 1
   FROM (bids b
     JOIN tenders t ON ((t.id = b.tender_id)))
  WHERE ((b.document_path = objects.name) AND ((b.supplier_id = ( SELECT auth.uid() AS uid)) OR (t.business_id = ( SELECT auth.uid() AS uid))))))));
create policy "business manages own tender files" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'tender-documents'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid))));
create policy "business uploads own tender files" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'tender-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.account_type = 'business'::account_type))))));
create policy ct_bid_docs_business_read on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bid-documents'::text) AND (EXISTS ( SELECT 1
   FROM (bids b
     JOIN tenders t ON ((t.id = b.tender_id)))
  WHERE ((b.document_path = objects.name) AND (t.business_id = ( SELECT auth.uid() AS uid)))))));
create policy ct_bid_docs_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM supplier_profiles sp
  WHERE (sp.user_id = ( SELECT auth.uid() AS uid))))));
create policy ct_bid_docs_supplier_read on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));
create policy ct_tender_docs_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'tender-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM business_profiles bp
  WHERE (bp.user_id = ( SELECT auth.uid() AS uid))))));
create policy ct_tender_docs_read on storage.objects as PERMISSIVE for SELECT to anon, authenticated using ((bucket_id = 'tender-documents'::text));
create policy "supplier manages own bid files" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'bid-documents'::text) AND (owner_id = ( SELECT (auth.uid())::text AS uid))));
create policy "supplier uploads own bid files" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'bid-documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.account_type = 'supplier'::account_type))))));

-- Table, view and column privileges
revoke all on table public.bids from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.bids to anon;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.bids to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.bids to service_role;
revoke all on table public.business_profiles from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.business_profiles to anon;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.business_profiles to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.business_profiles to service_role;
revoke all on table public.profiles from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.profiles to anon;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.profiles to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.profiles to service_role;
revoke all on table public.subscription_events from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.subscription_events to service_role;
grant select on table public.subscription_events to authenticated;
revoke all on table public.subscription_plans from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.subscription_plans to service_role;
grant select on table public.subscription_plans to anon;
grant select on table public.subscription_plans to authenticated;
revoke all on table public.supplier_profiles from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.supplier_profiles to anon;
grant insert, select, delete, truncate, references, trigger, maintain on table public.supplier_profiles to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.supplier_profiles to service_role;
grant update (company_name, address, industry_category, phone, contact_email, description, company_address) on table public.supplier_profiles to authenticated;
revoke all on table public.tenders from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.tenders to anon;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.tenders to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.tenders to service_role;
revoke all on table public.business_names_public from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.business_names_public to anon;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.business_names_public to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.business_names_public to service_role;
revoke all on table public.supplier_names_public from anon, authenticated, service_role;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.supplier_names_public to anon;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.supplier_names_public to authenticated;
grant insert, select, update, delete, truncate, references, trigger, maintain on table public.supplier_names_public to service_role;

-- Storage buckets (settings only, no files)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bid-documents', 'bid-documents', false, 10485760, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tender-documents', 'tender-documents', false, 10485760, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
