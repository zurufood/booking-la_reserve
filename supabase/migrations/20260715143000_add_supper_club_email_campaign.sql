create table if not exists public.reservation_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  audience text not null check (audience in ('paid', 'unpaid')),
  recipient_email text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_key, reservation_id)
);

create index if not exists reservation_email_deliveries_campaign_idx
  on public.reservation_email_deliveries (campaign_key, status);

drop trigger if exists reservation_email_deliveries_set_updated_at
  on public.reservation_email_deliveries;
create trigger reservation_email_deliveries_set_updated_at
before update on public.reservation_email_deliveries
for each row execute function public.set_updated_at();

alter table public.reservation_email_deliveries enable row level security;

drop policy if exists "Admins can read email deliveries"
  on public.reservation_email_deliveries;
create policy "Admins can read email deliveries"
on public.reservation_email_deliveries
for select to authenticated
using (public.is_admin());

revoke all on public.reservation_email_deliveries from anon, authenticated;
grant select on public.reservation_email_deliveries to authenticated;

