-- Standard forms as data (PRD P1-11).
--
-- A form is a form_definitions row: key, version, audience and a field schema. Adding a row makes a
-- new form appear and become fillable with no code change. A filled-in form is a form_submissions
-- row holding the data. PDFs are generated from that data at download time and never stored, so a
-- download always matches the record (OPEN_QUESTIONS.md, item 14).
--
-- Once a submission is attached to a published tender or a submitted bid, it cannot change.
-- Attaching to a bid happens only inside submit_bid.
--
-- Field schema: {"fields": [{"name", "label", "type", "required", ...}]}, where type is one of
-- text, textarea, email, date, number or table. A table field lists its "columns" (text or number).
-- Optional rendering hints such as lineTotal and grandTotal are ignored by the database.

create table public.form_definitions (
  key text not null,
  version integer not null,
  title text not null,
  audience public.account_type not null,
  schema jsonb not null,
  download_path text,
  is_active boolean not null default true,
  is_draft boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (key, version),
  constraint form_definitions_key_format check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint form_definitions_version_positive check (version >= 1),
  constraint form_definitions_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint form_definitions_schema_shape check (jsonb_typeof(schema) = 'object' and jsonb_typeof(schema -> 'fields') = 'array')
);

comment on table public.form_definitions is
  'Standard forms. A new row appears on the Forms page and becomes fillable with no code change. download_path is an optional printable file in the form-templates bucket.';

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_key text not null,
  form_version integer not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  data jsonb not null default '{}'::jsonb,
  attached_to_type text,
  attached_to_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (form_key, form_version) references public.form_definitions (key, version),
  constraint form_submissions_attached_to_type_check check (attached_to_type in ('tender', 'bid')),
  constraint form_submissions_attachment_complete check ((attached_to_type is null) = (attached_to_id is null)),
  constraint form_submissions_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint form_submissions_data_size check (octet_length(data::text) <= 200000)
);

-- One requirements form per tender, one proposal form per bid.
create unique index form_submissions_one_per_attachment
  on public.form_submissions (attached_to_type, attached_to_id)
  where attached_to_type is not null;
create index form_submissions_owner_idx on public.form_submissions (owner_id);

create trigger form_submissions_updated
before update on public.form_submissions
for each row execute function public.set_updated_at();

-- A date must be a real calendar date, not just the right shape.
create function private.is_iso_date(candidate text) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return candidate ~ '^\d{4}-\d{2}-\d{2}$' and candidate::date is not null;
exception
  when others then
    return false;
end;
$$;

-- Checks one value against one field or column definition. Returns a problem, or null.
create function private.form_value_problem(field_definition jsonb, field_value jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  field_label text := coalesce(field_definition ->> 'label', field_definition ->> 'name');
  field_type text := field_definition ->> 'type';
  maximum_length integer;
begin
  case field_type
    when 'text', 'textarea', 'email', 'date' then
      if jsonb_typeof(field_value) <> 'string' then
        return format('%s must be text.', field_label);
      end if;
      maximum_length := coalesce((field_definition ->> 'maxLength')::integer, case field_type when 'textarea' then 10000 else 500 end);
      if char_length(field_value #>> '{}') > maximum_length then
        return format('%s must be at most %s characters.', field_label, maximum_length);
      end if;
      if field_type = 'email' and (field_value #>> '{}') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        return format('%s must be an email address.', field_label);
      end if;
      if field_type = 'date' and not private.is_iso_date(field_value #>> '{}') then
        return format('%s must be a date like 2026-11-30.', field_label);
      end if;
    when 'number' then
      if jsonb_typeof(field_value) <> 'number' then
        return format('%s must be a number.', field_label);
      end if;
      if field_definition ? 'minimum' and (field_value #>> '{}')::numeric < (field_definition ->> 'minimum')::numeric then
        return format('%s must be at least %s.', field_label, field_definition ->> 'minimum');
      end if;
    else
      return format('%s has a type the platform does not support (%s).', field_label, coalesce(field_type, 'none'));
  end case;
  return null;
end;
$$;

-- An empty value counts as not filled in.
create function private.form_value_is_empty(field_value jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select field_value is null
    or field_value = 'null'::jsonb
    or (jsonb_typeof(field_value) = 'string' and btrim(field_value #>> '{}') = '')
    or (jsonb_typeof(field_value) = 'array' and jsonb_array_length(field_value) = 0);
$$;

-- Every problem with a submission's data, in plain English. With require_complete, required fields
-- must be filled in too (used when a form is attached to a published tender or a submitted bid).
create function private.form_data_problems(form_schema jsonb, form_data jsonb, require_complete boolean)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  maximum_table_rows constant integer := 200;
  problems text[] := '{}';
  field_definition jsonb;
  column_definition jsonb;
  field_value jsonb;
  table_row jsonb;
  row_number integer;
  known_field_names text[] := '{}';
  known_column_names text[];
  data_key text;
  problem text;
  field_label text;
begin
  if jsonb_typeof(form_data) <> 'object' then
    return array['The form data is not in the expected format.'];
  end if;

  for field_definition in select element from jsonb_array_elements(form_schema -> 'fields') as element loop
    known_field_names := known_field_names || (field_definition ->> 'name');
    field_label := coalesce(field_definition ->> 'label', field_definition ->> 'name');
    field_value := form_data -> (field_definition ->> 'name');

    if private.form_value_is_empty(field_value) then
      if require_complete and coalesce((field_definition ->> 'required')::boolean, false) then
        problems := problems || format('%s is required.', field_label);
      end if;
      continue;
    end if;

    if field_definition ->> 'type' <> 'table' then
      problem := private.form_value_problem(field_definition, field_value);
      if problem is not null then
        problems := problems || problem;
      end if;
      continue;
    end if;

    if jsonb_typeof(field_value) <> 'array' then
      problems := problems || format('%s must be a list of rows.', field_label);
      continue;
    end if;
    if jsonb_array_length(field_value) > maximum_table_rows then
      problems := problems || format('%s can have at most %s rows.', field_label, maximum_table_rows);
      continue;
    end if;

    known_column_names := array(select column_element ->> 'name' from jsonb_array_elements(field_definition -> 'columns') as column_element);
    row_number := 0;
    for table_row in select element from jsonb_array_elements(field_value) as element loop
      row_number := row_number + 1;
      if jsonb_typeof(table_row) <> 'object' then
        problems := problems || format('Row %s of %s is not in the expected format.', row_number, field_label);
        continue;
      end if;
      for column_definition in select element from jsonb_array_elements(field_definition -> 'columns') as element loop
        if private.form_value_is_empty(table_row -> (column_definition ->> 'name')) then
          if require_complete and coalesce((column_definition ->> 'required')::boolean, false) then
            problems := problems || format('Row %s of %s: %s is required.', row_number, field_label,
              coalesce(column_definition ->> 'label', column_definition ->> 'name'));
          end if;
          continue;
        end if;
        problem := private.form_value_problem(column_definition, table_row -> (column_definition ->> 'name'));
        if problem is not null then
          problems := problems || format('Row %s of %s: %s', row_number, field_label, problem);
        end if;
      end loop;
      for data_key in select key from jsonb_object_keys(table_row) as key loop
        if not data_key = any (known_column_names) then
          problems := problems || format('Row %s of %s has an unknown column "%s".', row_number, field_label, data_key);
        end if;
      end loop;
    end loop;
  end loop;

  for data_key in select key from jsonb_object_keys(form_data) as key loop
    if not data_key = any (known_field_names) then
      problems := problems || format('The form has no field called "%s".', data_key);
    end if;
  end loop;

  return problems;
end;
$$;

-- Keeps submissions valid as they are saved, and frozen once attached to a published tender or a
-- submitted bid. Drafts may be incomplete; completeness is checked when the form is attached.
create function private.guard_form_submission() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_schema jsonb;
  problems text[];
  frozen_by text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.attached_to_type = 'bid' then
      frozen_by := 'a submitted bid';
    elsif old.attached_to_type = 'tender' and exists (
      select 1 from public.tenders tender where tender.id = old.attached_to_id and tender.status <> 'draft'
    ) then
      frozen_by := 'a published tender';
    end if;
    -- submit_bid attaches an unattached proposal; that one change is allowed.
    if frozen_by is null and tg_op = 'UPDATE' and new.attached_to_type is distinct from old.attached_to_type
       and not (old.attached_to_type is null and new.attached_to_type = 'bid') then
      frozen_by := 'its attachment';
    end if;
    if frozen_by is not null then
      raise exception 'This form is attached to % and cannot be changed.', frozen_by using errcode = 'check_violation';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    if (new.owner_id, new.form_key, new.form_version) is distinct from (old.owner_id, old.form_key, old.form_version) then
      raise exception 'A form''s owner and definition cannot be changed.' using errcode = 'check_violation';
    end if;
  end if;

  select definition.schema into form_schema
  from public.form_definitions definition
  where definition.key = new.form_key and definition.version = new.form_version;

  problems := private.form_data_problems(form_schema, new.data, false);
  if cardinality(problems) > 0 then
    raise exception '%', array_to_string(problems, ' ') using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger guard_form_submission
before insert or update or delete on public.form_submissions
for each row execute function private.guard_form_submission();

alter table public.form_definitions enable row level security;
alter table public.form_submissions enable row level security;

create policy form_definitions_read_active on public.form_definitions
for select to authenticated
using (is_active);

create policy form_submissions_read_own on public.form_submissions
for select to authenticated
using (owner_id = (select auth.uid()));

-- A published tender's requirements form is readable by everyone who can see the tender.
create policy form_submissions_read_tender_forms on public.form_submissions
for select to authenticated
using (
  attached_to_type = 'tender'
  and exists (select 1 from public.tenders tender where tender.id = form_submissions.attached_to_id)
);

-- A user fills in a form for an account type they have. A business may attach its requirements
-- form to one of its own drafts; nobody attaches to a bid directly.
create policy form_submissions_insert_own on public.form_submissions
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (select private.caller_is_active())
  and exists (
    select 1 from public.form_definitions definition
    where definition.key = form_submissions.form_key
      and definition.version = form_submissions.form_version
      and definition.is_active
      and (
        (definition.audience = 'business' and exists (select 1 from public.business_profiles business where business.user_id = (select auth.uid())))
        or (definition.audience = 'supplier' and exists (select 1 from public.supplier_profiles supplier where supplier.user_id = (select auth.uid())))
      )
      and (
        form_submissions.attached_to_type is null
        or (
          form_submissions.attached_to_type = 'tender'
          and definition.audience = 'business'
          and exists (
            select 1 from public.tenders tender
            where tender.id = form_submissions.attached_to_id
              and tender.business_id = (select auth.uid())
              and tender.status = 'draft'
          )
        )
      )
  )
);

create policy form_submissions_update_own_unfrozen on public.form_submissions
for update to authenticated
using (owner_id = (select auth.uid()) and (attached_to_type is null or attached_to_type = 'tender'))
with check (owner_id = (select auth.uid()) and (select private.caller_is_active()));

create policy form_submissions_delete_own_unfrozen on public.form_submissions
for delete to authenticated
using (owner_id = (select auth.uid()) and (attached_to_type is null or attached_to_type = 'tender'));

-- The two DRAFT definitions from PRD P1-11, to be replaced when the client sends the real forms
-- (PRD section 13, item 1). A replacement is a new version row; old submissions keep their version.
insert into public.form_definitions (key, version, title, audience, is_draft, schema) values
(
  'business-requirements', 1, 'Business Requirements Form (draft)', 'business', true,
  '{
    "description": "DRAFT. To be replaced by the client''s Business Requirements Form.",
    "fields": [
      {"name": "need_summary", "label": "Summary of what you need", "type": "textarea", "required": true, "maxLength": 2000},
      {"name": "scope_of_work", "label": "Scope of work", "type": "textarea", "required": true, "maxLength": 10000},
      {"name": "quantities_or_specifications", "label": "Quantities or specifications", "type": "textarea", "required": true, "maxLength": 10000},
      {"name": "delivery_location", "label": "Delivery location", "type": "text", "required": true, "maxLength": 300},
      {"name": "required_timeline", "label": "Required timeline", "type": "text", "required": true, "maxLength": 300},
      {"name": "contact_person", "label": "Contact person", "type": "text", "required": true, "maxLength": 200}
    ]
  }'::jsonb
),
(
  'supplier-proposal', 1, 'Supplier Proposal Form (draft)', 'supplier', true,
  '{
    "description": "DRAFT. To be replaced by the client''s Supplier Proposal Form.",
    "fields": [
      {"name": "deliverables", "label": "What will be delivered", "type": "textarea", "required": true, "maxLength": 10000},
      {"name": "delivery_timeline", "label": "Delivery timeline", "type": "text", "required": true, "maxLength": 300},
      {
        "name": "cost_breakdown", "label": "Cost breakdown", "type": "table", "required": true,
        "columns": [
          {"name": "item", "label": "Item", "type": "text", "required": true, "maxLength": 300},
          {"name": "quantity", "label": "Quantity", "type": "number", "required": true, "minimum": 0},
          {"name": "unit_cost", "label": "Unit cost (JMD)", "type": "number", "required": true, "minimum": 0},
          {"name": "labour", "label": "Labour (JMD)", "type": "number", "minimum": 0}
        ],
        "lineTotal": {"label": "Line total (JMD)", "multiply": ["quantity", "unit_cost"], "add": ["labour"]},
        "grandTotal": {"label": "Grand total (JMD)"}
      },
      {"name": "offer_validity_period", "label": "Validity period of the offer (for example, 60 days)", "type": "text", "required": true, "maxLength": 200},
      {"name": "terms", "label": "Terms", "type": "textarea", "maxLength": 10000}
    ]
  }'::jsonb
);

revoke all on function private.is_iso_date(text) from public, anon, authenticated;
revoke all on function private.form_value_problem(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.form_value_is_empty(jsonb) from public, anon, authenticated;
revoke all on function private.form_data_problems(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.guard_form_submission() from public, anon, authenticated;

revoke all on public.form_definitions, public.form_submissions from public, anon, authenticated;
grant select on public.form_definitions to authenticated;
grant select, delete on public.form_submissions to authenticated;
grant insert (form_key, form_version, owner_id, data, attached_to_type, attached_to_id) on public.form_submissions to authenticated;
grant update (data) on public.form_submissions to authenticated;
