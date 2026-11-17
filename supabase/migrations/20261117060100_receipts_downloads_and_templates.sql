-- Capture the recipient at submission so a delayed worker or an email address
-- change cannot lose or duplicate the receipt. Keep pre-rollout history quiet.
create table private.bid_receipt_queue (
  bid_id uuid primary key references public.bids(id) on delete cascade,
  recipient text not null
);
create function private.queue_bid_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.bid_receipt_queue(bid_id,recipient)
    select new.id, email from auth.users where id=new.supplier_id and email is not null;
  return new;
end;
$$;
create trigger queue_bid_receipt after insert on public.bids
for each row execute function private.queue_bid_receipt();
insert into private.bid_receipt_queue
select bid.id,coalesce(log.recipient,account.email)
from public.bids bid join auth.users account on account.id=bid.supplier_id
left join lateral (
  select recipient,status from public.email_log where type='bid_receipt' and entity_id=bid.id order by created_at limit 1
) log on true
where ((log.status is null and bid.submitted_at > now() - interval '1 hour') or log.status in ('failed','pending'))
  and coalesce(log.recipient,account.email) is not null;

-- Keep the scheduled query proportional to outstanding work. The permanent
-- delivery record stays in email_log even after a queued receipt is retired.
create function private.finish_bid_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.bid_receipt_queue where bid_id=new.entity_id and recipient=new.recipient;
  return new;
end;
$$;
create trigger finish_bid_receipt after insert or update of status on public.email_log
for each row when (new.type='bid_receipt' and new.status in ('sent','suppressed'))
execute function private.finish_bid_receipt();

create or replace function public.due_emails(batch_size integer default 50) returns table (type text, recipient text, entity_id uuid, details jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with active_supplier as (
    select supplier.user_id, supplier.category_id, users.email, coalesce(preference.tender_alerts, true) as wants_tender_emails
    from public.supplier_profiles supplier
    join public.profiles profile on profile.id = supplier.user_id and profile.is_active
    join auth.users users on users.id = supplier.user_id
    left join public.notification_preferences preference on preference.user_id = supplier.user_id
  ),
  -- Tenders the live test suites post: nobody is told about them.
  test_tender as (
    select tender.id
    from public.tenders tender
    join auth.users business_user on business_user.id = tender.business_id
    where lower(business_user.email) like 'rls-test-%@example.com'
  ),
  due as (
    -- Bid receipt, with the exact submission time: until delivered or suppressed.
    select 'bid_receipt' as type, receipt.recipient, bid.id as entity_id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'amount', bid.amount, 'currency', bid.currency, 'submitted_at', bid.submitted_at) as details
    from public.bids bid
    join public.tenders tender on tender.id = bid.tender_id
    join private.bid_receipt_queue receipt on receipt.bid_id = bid.id

    union all
    -- New tender alert: suppliers in the tender's category who keep alerts on, within a day of publishing.
    select 'new_tender_alert', supplier.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closes_at', tender.closes_at)
    from public.tenders tender
    join active_supplier supplier on supplier.category_id = tender.category_id and supplier.wants_tender_emails
    where tender.status = 'open' and tender.published_at > now() - interval '1 day' and tender.closes_at > now()
      and supplier.user_id <> tender.business_id
      and tender.id not in (select test_tender.id from test_tender)

    union all
    -- Deadline reminder: 24 hours before closing, suppliers in the category who haven't bid. Only for
    -- tenders published more than a day before closing, so it never arrives together with the alert.
    -- Suppliers who turned tender alerts off get no reminders either (OPEN_QUESTIONS.md, item 33).
    select 'deadline_reminder', supplier.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closes_at', tender.closes_at)
    from public.tenders tender
    join active_supplier supplier on supplier.category_id = tender.category_id and supplier.wants_tender_emails
    where tender.status = 'open' and tender.closes_at > now() and tender.closes_at <= now() + interval '24 hours'
      and tender.published_at <= tender.closes_at - interval '24 hours'
      and supplier.user_id <> tender.business_id
      and not exists (select 1 from public.bids bid where bid.tender_id = tender.id and bid.supplier_id = supplier.user_id)
      and tender.id not in (select test_tender.id from test_tender)

    union all
    -- Bids opened: the business, within a day of the tender closing, with how many bids came in.
    select 'bids_opened', users.email, tender.id,
      jsonb_build_object('tender_id', tender.id, 'tender_title', tender.title, 'closed_at', tender.closed_at,
        'bid_count', (select count(*) from public.bids bid where bid.tender_id = tender.id))
    from public.tenders tender
    join public.profiles profile on profile.id = tender.business_id and profile.is_active
    join auth.users users on users.id = tender.business_id
    where tender.status in ('closed', 'awarded') and tender.closed_at > now() - interval '1 day'
  )
  select due.type, due.recipient::text, due.entity_id, due.details
  from due
  where due.recipient is not null
    and not exists (
      select 1 from public.email_log log
      where log.type = due.type and log.recipient = due.recipient and log.entity_id = due.entity_id
        and not private.email_retry_is_due(log)
    )
  order by due.type, due.entity_id
  limit least(greatest(batch_size, 1), 500);
$$;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
    'tender_published',
    'tender_edited',
    'tender_closed',
    'tender_awarded',
    'tender_cancelled',
    'bid_submitted',
    'bids_opened',
    'document_download_url_issued', 'document_download_authorized', 'document_download_signing_failed',
    'admin_user_deactivated',
    'admin_user_reactivated',
    'admin_tender_cancelled'
  ));
create or replace function public.request_document_download(document_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_active_user();
  found_bucket text;
  found_path text;
  found_file_name text;
  bid_supplier_id uuid;
  bid_tender_id uuid;
  tender_owner_id uuid;
  tender_status public.tender_status;
  authorization_id bigint;
  allowed boolean := false;
begin
  select 'tender-documents', document.storage_path, document.file_name, tender.business_id, tender.status
  into found_bucket, found_path, found_file_name, tender_owner_id, tender_status
  from public.tender_documents document
  join public.tenders tender on tender.id = document.tender_id
  where document.id = request_document_download.document_id;

  if found then
    allowed := tender_status <> 'draft' or tender_owner_id = caller_id;
  else
    select 'bid-documents', document.storage_path, document.file_name, bid.supplier_id, bid.tender_id, tender.business_id
    into found_bucket, found_path, found_file_name, bid_supplier_id, bid_tender_id, tender_owner_id
    from public.bid_documents document
    join public.bids bid on bid.id = document.bid_id
    join public.tenders tender on tender.id = bid.tender_id
    where document.id = request_document_download.document_id;

    if found then
      if bid_supplier_id = caller_id then
        allowed := true;
      elsif tender_owner_id = caller_id and private.bids_are_open(bid_tender_id) then
        allowed := true;
        -- A business reaching a bid file is an opening, even if it never listed the bids.
        perform private.record_bids_opened(bid_tender_id);
      end if;
    end if;
  end if;

  -- One message for "missing" and "not yours", so ids can't be probed.
  if not allowed then
    raise exception 'Document not found.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, metadata)
  values (caller_id,'document_download_authorized','document',document_id,jsonb_build_object('bucket',found_bucket,'path',found_path))
  returning id into authorization_id;
  return jsonb_build_object('authorization_id',authorization_id,'bucket',found_bucket,'path',found_path,'file_name',found_file_name);
end;
$$;

-- Only the signer can attest to issuance. Copy the original actor and location.
create function public.finish_document_download(authorization_id bigint, succeeded boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(actor_id,action,entity_type,entity_id,metadata)
  select actor_id,case when succeeded then 'document_download_url_issued' else 'document_download_signing_failed' end,
    entity_type,entity_id,metadata || jsonb_build_object('authorization_id',id)
  from public.audit_log where id=authorization_id and action='document_download_authorized';
  if not found then raise exception 'Download authorization missing.'; end if;
end;
$$;
revoke all on function public.finish_document_download(bigint,boolean) from public,anon,authenticated;
grant execute on function public.finish_document_download(bigint,boolean) to service_role;

alter policy audit_log_read_admins on public.audit_log
using (
  (select private.caller_is_admin())
  and (
    not (action = 'bid_submitted' or (action in ('document_download_url_issued','document_download_authorized','document_download_signing_failed') and metadata ->> 'bucket' = 'bid-documents'))
    or exists (
      select 1 from public.tenders tender
      -- Bid file paths are <tender id>/<bid id>/...
      where tender.id = private.try_uuid(case when action = 'bid_submitted' then metadata ->> 'tender_id' else split_part(metadata ->> 'path', '/', 1) end)
        and tender.status <> 'draft'
        and tender.closes_at <= clock_timestamp()
        and (tender.cancelled_at is null or tender.cancelled_at >= tender.closes_at)
    )
  )
);

-- Templates are published by the provisioning script after byte verification.
update public.form_definitions as definition set download_path=null
where download_path is not null and not exists (
  select 1 from storage.objects as stored_file where stored_file.bucket_id='form-templates' and stored_file.name=definition.download_path
);

grant update(download_path) on public.form_definitions to service_role;
