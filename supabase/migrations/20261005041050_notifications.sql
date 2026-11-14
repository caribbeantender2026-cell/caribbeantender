-- Email log and notification preferences (PRD P1-13, section 7). The Edge Functions that send the
-- emails come in Stage 2.
--
-- email_log makes each email go out exactly once: the sender claims a row (unique per email type,
-- recipient and entity) before sending, and a second attempt finds it taken. Only the service role
-- reads or writes it (PRD 8.4).

create table public.email_log (
  id bigint generated always as identity primary key,
  type text not null,
  recipient text not null,
  entity_id uuid not null,
  status text not null default 'pending',
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_log_type_check check (type in ('bid_receipt', 'new_tender_alert', 'deadline_reminder', 'bids_opened')),
  constraint email_log_status_check check (status in ('pending', 'sent', 'failed')),
  constraint email_log_recipient_length check (char_length(recipient) between 3 and 320),
  constraint email_log_one_per_type_recipient_entity unique (type, recipient, entity_id)
);

comment on table public.email_log is
  'One row per email the platform sends; the unique key stops any email going out twice. Service role only.';

alter table public.email_log enable row level security;
revoke all on public.email_log from public, anon, authenticated;
grant all on public.email_log to service_role;

-- No row means the defaults: tender alerts on (PRD P1-13).
create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tender_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_updated
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

create policy notification_preferences_read_own on public.notification_preferences
for select to authenticated
using (user_id = (select auth.uid()));

create policy notification_preferences_insert_own on public.notification_preferences
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy notification_preferences_update_own on public.notification_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.notification_preferences from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;
grant insert (user_id, tender_alerts) on public.notification_preferences to authenticated;
grant update (tender_alerts) on public.notification_preferences to authenticated;
