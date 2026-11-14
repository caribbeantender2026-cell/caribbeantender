-- Tender lifecycle: draft -> open -> closed -> awarded, or cancelled from open or closed (PRD P1-06,
-- P1-07; AUDIT.md M2).
--
-- Businesses create and edit drafts directly. Every status change goes through a security-definer
-- function (PRD 8.4): publish_tender and extend_tender_closing_time here; cancel_tender and
-- award_tender with the bid rules, because they set each bid's outcome. A pg_cron job closes open
-- tenders within a minute of closes_at. A trigger enforces the transitions whoever makes the change,
-- and another writes every change to the audit log.
--
-- After publishing, the only change allowed is extending the closing time (PRD P1-06).

alter table public.tenders
  add column published_at timestamptz,
  add column closed_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_reason text,
  add column awarded_at timestamptz,
  add column awarded_bid_id uuid;

-- Existing tenders: every one was published when created. A cancelled tender's last update is the
-- best record of when it was cancelled, so updated_at is left untouched. Open tenders whose closing
-- time has passed are closed, as the scheduled job would have done.
alter table public.tenders disable trigger tenders_updated;
update public.tenders
set
  published_at = created_at,
  cancelled_at = case when status = 'cancelled' then updated_at end,
  cancelled_reason = case when status = 'cancelled' then 'Cancelled on the previous version of CaribbeanTender, which did not record reasons.' end,
  closed_at = case
    when status = 'closed' then closes_at
    when status = 'open' and closes_at <= now() then closes_at
  end,
  status = case when status = 'open' and closes_at <= now() then 'closed'::public.tender_status else status end;
alter table public.tenders enable trigger tenders_updated;

alter table public.tenders alter column status set default 'draft';

alter table public.tenders
  add constraint tenders_award_matches_status check ((status = 'awarded') = (awarded_bid_id is not null)),
  add constraint tenders_cancellation_has_reason check (
    status <> 'cancelled' or char_length(btrim(coalesce(cancelled_reason, ''))) between 1 and 1000
  ),
  -- Not validated against existing rows, so an unusually long legacy description can't stop the cutover.
  add constraint tenders_description_length check (char_length(btrim(description)) between 1 and 20000) not valid;

-- An award must name a bid on the same tender; the composite key makes that declarative.
alter table public.bids add constraint bids_id_tender_id_key unique (id, tender_id);
alter table public.tenders
  add constraint tenders_awarded_bid_fkey foreign key (awarded_bid_id, id) references public.bids (id, tender_id);

-- Deleting a tender must never delete the bids submitted to it (AUDIT.md M2).
alter table public.bids
  drop constraint bids_tender_id_fkey,
  add constraint bids_tender_id_fkey foreign key (tender_id) references public.tenders (id) on delete restrict;

-- Enforces the rules on every insert and update, whoever makes them.
create function private.enforce_tender_lifecycle() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A new tender is saved as a draft, then published.' using errcode = 'check_violation';
    end if;
    new.published_at := null;
    new.closed_at := null;
    new.cancelled_at := null;
    new.cancelled_reason := null;
    new.awarded_at := null;
    new.awarded_bid_id := null;
    return new;
  end if;

  -- These record transitions, so nobody sets them directly.
  new.created_at := old.created_at;
  new.published_at := old.published_at;
  new.closed_at := old.closed_at;
  new.cancelled_at := old.cancelled_at;
  new.awarded_at := old.awarded_at;

  if old.status <> 'draft' then
    if new.business_id is distinct from old.business_id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.category_id is distinct from old.category_id then
      raise exception 'A published tender''s terms cannot be changed. Only its closing time can be extended.'
        using errcode = 'check_violation';
    end if;
    if new.closes_at is distinct from old.closes_at
       and not (old.status = 'open' and new.status = 'open'
                and old.closes_at > clock_timestamp() and new.closes_at > old.closes_at) then
      raise exception 'The closing time can only be extended, and only while the tender is still open.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status is distinct from old.status then
    case
      when old.status = 'draft' and new.status = 'open' then
        if new.closes_at <= clock_timestamp() then
          raise exception 'The closing time must be in the future.' using errcode = 'check_violation';
        end if;
        if new.category_id is null then
          raise exception 'Choose a category before publishing.' using errcode = 'check_violation';
        end if;
        new.published_at := now();
      when old.status = 'open' and new.status = 'closed' then
        if new.closes_at > clock_timestamp() then
          raise exception 'This tender closes automatically at its closing time.' using errcode = 'check_violation';
        end if;
        new.closed_at := now();
      when old.status = 'closed' and new.status = 'awarded' then
        new.awarded_at := now();
      when old.status in ('open', 'closed') and new.status = 'cancelled' then
        new.cancelled_at := now();
      when old.status = 'draft' and new.status = 'cancelled' then
        raise exception 'A draft is deleted, not cancelled.' using errcode = 'check_violation';
      else
        raise exception 'A tender cannot move from % to %.', old.status, new.status using errcode = 'check_violation';
    end case;
  end if;

  if new.status <> 'awarded' and new.awarded_bid_id is distinct from old.awarded_bid_id then
    raise exception 'The awarded bid is set only when awarding the tender.' using errcode = 'check_violation';
  end if;
  if new.status <> 'cancelled' and new.cancelled_reason is distinct from old.cancelled_reason then
    raise exception 'The cancellation reason is set only when cancelling the tender.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_tender_lifecycle
before insert or update on public.tenders
for each row execute function private.enforce_tender_lifecycle();

-- Every status change and every edit goes into the audit log (PRD P1-06, P1-14).
create function private.log_tender_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_fields text[] := '{}';
  edit_details jsonb;
begin
  if new.status is distinct from old.status then
    perform private.write_audit_log(
      case new.status
        when 'open' then 'tender_published'
        when 'closed' then 'tender_closed'
        when 'awarded' then 'tender_awarded'
        when 'cancelled' then 'tender_cancelled'
      end,
      'tender',
      new.id,
      jsonb_strip_nulls(jsonb_build_object(
        'previous_status', old.status,
        'closes_at', new.closes_at,
        'awarded_bid_id', new.awarded_bid_id,
        'cancelled_reason', case when new.status = 'cancelled' then new.cancelled_reason end
      ))
    );
  end if;

  if new.title is distinct from old.title then changed_fields := changed_fields || 'title'::text; end if;
  if new.description is distinct from old.description then changed_fields := changed_fields || 'description'::text; end if;
  if new.category_id is distinct from old.category_id then changed_fields := changed_fields || 'category_id'::text; end if;
  if new.closes_at is distinct from old.closes_at then changed_fields := changed_fields || 'closes_at'::text; end if;

  if cardinality(changed_fields) > 0 then
    edit_details := jsonb_build_object('changed_fields', to_jsonb(changed_fields), 'status', new.status);
    if new.closes_at is distinct from old.closes_at then
      edit_details := edit_details || jsonb_build_object('previous_closes_at', old.closes_at, 'closes_at', new.closes_at);
    end if;
    perform private.write_audit_log('tender_edited', 'tender', new.id, edit_details);
  end if;
  return null;
end;
$$;

create trigger log_tender_change
after update on public.tenders
for each row execute function private.log_tender_change();

-- Every tender page needs an account (PRD section 3): signed-in users see published tenders, and
-- businesses see their own drafts. Businesses write only their own drafts; status never directly.
drop policy tenders_public_read on public.tenders;
drop policy business_insert_tenders on public.tenders;
drop policy business_update_own_tenders on public.tenders;
drop policy business_delete_own_tenders on public.tenders;

create policy tenders_read_published on public.tenders
for select to authenticated
using (status <> 'draft');

create policy tenders_read_own on public.tenders
for select to authenticated
using (business_id = (select auth.uid()));

create policy tenders_insert_own_draft on public.tenders
for insert to authenticated
with check (
  business_id = (select auth.uid())
  and status = 'draft'
  and (select private.caller_is_active())
  and exists (select 1 from public.business_profiles business where business.user_id = (select auth.uid()))
);

create policy tenders_update_own_draft on public.tenders
for update to authenticated
using (business_id = (select auth.uid()) and status = 'draft')
with check (business_id = (select auth.uid()) and status = 'draft' and (select private.caller_is_active()));

create policy tenders_delete_own_draft on public.tenders
for delete to authenticated
using (business_id = (select auth.uid()) and status = 'draft');

-- Publishes a draft. Files the business uploaded into the draft's folder become its documents
-- (requirements-form/ holds an uploaded requirements form). The requirements form must be attached,
-- either filled in online or uploaded (PRD P1-06).
create function public.publish_tender(tender_id uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
  draft public.tenders%rowtype;
  folder_prefix text := publish_tender.tender_id::text || '/';
  requirements_prefix text := publish_tender.tender_id::text || '/requirements-form/';
  stored_file record;
  has_requirements_file boolean := false;
  requirements_schema jsonb;
  requirements_data jsonb;
  problems text[];
  published_moment timestamptz;
begin
  select * into draft from public.tenders tender where tender.id = publish_tender.tender_id for update;
  if not found or draft.business_id <> caller_id then
    raise exception 'Tender not found.' using errcode = 'no_data_found';
  end if;
  if draft.status <> 'draft' then
    raise exception 'Only a draft can be published.' using errcode = 'check_violation';
  end if;

  for stored_file in
    select stored_object.name, stored_object.owner_id, stored_object.metadata, stored_object.created_at
    from storage.objects stored_object
    where stored_object.bucket_id = 'tender-documents' and starts_with(stored_object.name, folder_prefix)
    order by stored_object.name
  loop
    if stored_file.owner_id is distinct from caller_id::text then
      raise exception 'A file in this tender''s folder was not uploaded by you (%). Remove it before publishing.', stored_file.name
        using errcode = 'insufficient_privilege';
    end if;
    insert into public.tender_documents (tender_id, storage_path, file_name, mime_type, size_bytes, document_role, uploaded_at)
    values (
      draft.id,
      stored_file.name,
      left(regexp_replace(stored_file.name, '^.*/', ''), 255),
      coalesce(stored_file.metadata ->> 'mimetype', 'application/octet-stream'),
      coalesce((stored_file.metadata ->> 'size')::bigint, 0),
      case when starts_with(stored_file.name, requirements_prefix) then 'requirements_form' else 'supporting' end::public.document_role,
      stored_file.created_at
    );
    has_requirements_file := has_requirements_file or starts_with(stored_file.name, requirements_prefix);
  end loop;

  select definition.schema, submission.data into requirements_schema, requirements_data
  from public.form_submissions submission
  join public.form_definitions definition
    on definition.key = submission.form_key and definition.version = submission.form_version
  where submission.attached_to_type = 'tender' and submission.attached_to_id = draft.id;

  if found then
    problems := private.form_data_problems(requirements_schema, requirements_data, true);
    if cardinality(problems) > 0 then
      raise exception 'The requirements form is not complete. %', array_to_string(problems, ' ') using errcode = 'check_violation';
    end if;
  elsif not has_requirements_file then
    raise exception 'Fill in the requirements form online, or upload it, before publishing.' using errcode = 'check_violation';
  end if;

  update public.tenders tender set status = 'open'
  where tender.id = draft.id
  returning tender.published_at into published_moment;
  return published_moment;
end;
$$;

-- The only change allowed after publishing (PRD P1-06). The trigger checks it is a later time and
-- that the tender hasn't closed; the audit trigger records the old and new times.
create function public.extend_tender_closing_time(tender_id uuid, new_closes_at timestamptz) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
  tender_owner_id uuid;
  tender_status public.tender_status;
begin
  select tender.business_id, tender.status into tender_owner_id, tender_status
  from public.tenders tender where tender.id = extend_tender_closing_time.tender_id for update;
  if not found or tender_owner_id <> caller_id then
    raise exception 'Tender not found.' using errcode = 'no_data_found';
  end if;
  if tender_status <> 'open' then
    raise exception 'Only an open tender''s closing time can be extended.' using errcode = 'check_violation';
  end if;
  update public.tenders tender set closes_at = new_closes_at where tender.id = extend_tender_closing_time.tender_id;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;

-- Run by pg_cron as the database owner, so the audit log records no actor (the system closed it).
create function private.close_expired_tenders() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed_count integer;
begin
  update public.tenders tender set status = 'closed'
  where tender.status = 'open' and tender.closes_at <= now();
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

select cron.schedule('close-expired-tenders', '* * * * *', 'select private.close_expired_tenders()');

revoke all on function private.enforce_tender_lifecycle() from public, anon, authenticated;
revoke all on function private.log_tender_change() from public, anon, authenticated;
revoke all on function private.close_expired_tenders() from public, anon, authenticated;
revoke all on function public.publish_tender(uuid) from public, anon, authenticated;
revoke all on function public.extend_tender_closing_time(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_tender(uuid) to authenticated;
grant execute on function public.extend_tender_closing_time(uuid, timestamptz) to authenticated;
