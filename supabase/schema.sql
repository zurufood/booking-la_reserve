create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  service_date date not null,
  first_name text not null default '',
  last_name text not null default '',
  email text not null,
  phone text not null,
  seats integer not null check (seats between 1 and 24),
  validation_status text not null default 'confirmed' check (
    validation_status in ('pending', 'confirmed', 'expired', 'cancelled')
  ),
  validation_token_hash text,
  cancellation_token_hash text,
  validation_sent_at timestamptz,
  validation_expires_at timestamptz,
  confirmed_at timestamptz default now(),
  confirmation_email_sent_at timestamptz,
  feedback_email_sent_at timestamptz
);

drop index if exists public.reservations_mollie_payment_id_idx;
drop trigger if exists reservations_enforce_capacity on public.reservations;

alter table public.reservations
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists validation_status text not null default 'confirmed',
  add column if not exists validation_token_hash text,
  add column if not exists cancellation_token_hash text,
  add column if not exists validation_sent_at timestamptz,
  add column if not exists validation_expires_at timestamptz,
  add column if not exists confirmed_at timestamptz default now(),
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists feedback_email_sent_at timestamptz,
  drop column if exists deposit_per_seat,
  drop column if exists deposit_status,
  drop column if exists mollie_payment_id,
  drop column if exists mollie_checkout_url,
  drop column if exists payment_status,
  drop column if exists payment_amount_cents,
  drop column if exists payment_created_at,
  drop column if exists payment_paid_at;

update public.reservations
set
  validation_status = coalesce(validation_status, 'confirmed'),
  confirmed_at = coalesce(confirmed_at, created_at, now())
where validation_status is null
   or (validation_status = 'confirmed' and confirmed_at is null);

alter table public.reservations
  alter column validation_status set default 'confirmed',
  alter column validation_status set not null,
  alter column confirmed_at set default now();

alter table public.reservations
  drop constraint if exists reservations_validation_status_check,
  add constraint reservations_validation_status_check
    check (validation_status in ('pending', 'confirmed', 'expired', 'cancelled'));

create index if not exists reservations_service_date_idx
  on public.reservations (service_date);

create index if not exists reservations_validation_status_idx
  on public.reservations (validation_status);

create index if not exists reservations_feedback_email_pending_idx
  on public.reservations (service_date)
  where validation_status = 'confirmed'
    and feedback_email_sent_at is null;

create unique index if not exists reservations_validation_token_hash_idx
  on public.reservations (validation_token_hash)
  where validation_token_hash is not null;

create unique index if not exists reservations_cancellation_token_hash_idx
  on public.reservations (cancellation_token_hash)
  where cancellation_token_hash is not null;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at
before update on public.reservations
for each row
execute function public.set_updated_at();

create or replace function public.reservation_holds_seats(
  p_status text,
  p_expires_at timestamptz
)
returns boolean
language sql
stable
as $$
  select p_status = 'confirmed'
    or (p_status = 'pending' and p_expires_at > now());
$$;

create or replace function public.enforce_reservation_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  booked_seats integer;
begin
  if extract(dow from new.service_date)::integer <> 4 then
    raise exception 'Les inscriptions sont uniquement ouvertes le jeudi.';
  end if;

  if new.validation_status = 'pending' and new.validation_expires_at is null then
    raise exception 'Une inscription en attente doit avoir une date d''expiration.';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.service_date::text));

  select coalesce(sum(seats), 0)
  into booked_seats
  from public.reservations
  where service_date = new.service_date
    and id <> new.id
    and public.reservation_holds_seats(validation_status, validation_expires_at);

  if public.reservation_holds_seats(new.validation_status, new.validation_expires_at)
    and booked_seats + new.seats > 24 then
    raise exception 'Il ne reste pas assez de places pour ce jeudi.';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_enforce_capacity on public.reservations;
create trigger reservations_enforce_capacity
before insert or update of service_date, seats, validation_status, validation_expires_at on public.reservations
for each row
execute function public.enforce_reservation_capacity();

create or replace function public.get_public_availability(
  p_start_date date default current_date,
  p_weeks integer default 16
)
returns table (
  service_date date,
  booked_seats integer,
  remaining_seats integer
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select (p_start_date + ((4 - extract(dow from p_start_date)::integer + 7) % 7))::date as first_thursday
  ),
  dates as (
    select (first_thursday + (week_index * 7))::date as service_date
    from base, generate_series(0, least(greatest(p_weeks, 1), 52) - 1) as week_index
  ),
  booked as (
    select reservations.service_date, coalesce(sum(reservations.seats), 0)::integer as booked_seats
    from public.reservations
    where public.reservation_holds_seats(reservations.validation_status, reservations.validation_expires_at)
    group by reservations.service_date
  )
  select
    dates.service_date,
    coalesce(booked.booked_seats, 0)::integer as booked_seats,
    greatest(24 - coalesce(booked.booked_seats, 0), 0)::integer as remaining_seats
  from dates
  left join booked on booked.service_date = dates.service_date
  order by dates.service_date;
$$;

drop function if exists public.create_public_reservation(date, text, text, integer, integer);
drop function if exists public.create_public_reservation(date, text, text, text, text, integer, integer);
drop function if exists public.create_public_reservation(date, text, text, text, text, integer);

alter table public.admin_users enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "Admins can read reservations" on public.reservations;
create policy "Admins can read reservations"
on public.reservations
for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can insert reservations" on public.reservations;
create policy "Admins can insert reservations"
on public.reservations
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update reservations" on public.reservations;
create policy "Admins can update reservations"
on public.reservations
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can delete reservations" on public.reservations;
create policy "Admins can delete reservations"
on public.reservations
for delete
to authenticated
using (public.is_admin());

grant usage on schema public to anon, authenticated;
grant execute on function public.get_public_availability(date, integer) to anon, authenticated;
grant execute on function public.reservation_holds_seats(text, timestamptz) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant select, insert, update, delete on public.reservations to authenticated;

alter table public.reservations
  add column if not exists payment_status text not null default 'manual',
  add column if not exists payment_amount_cents integer,
  add column if not exists helloasso_order_id bigint,
  add column if not exists helloasso_payment_id bigint,
  add column if not exists payment_return_token_hash text,
  add column if not exists payment_link_token_hash text,
  add column if not exists payment_link_created_at timestamptz,
  add column if not exists payment_created_at timestamptz,
  add column if not exists payment_paid_at timestamptz,
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists payment_conflict_reason text;

alter table public.reservations
  drop constraint if exists reservations_payment_status_check,
  add constraint reservations_payment_status_check check (
    payment_status in ('pending', 'paid', 'failed', 'refund_pending', 'refunded', 'manual', 'conflict')
  ),
  drop constraint if exists reservations_payment_amount_cents_check,
  add constraint reservations_payment_amount_cents_check check (
    payment_amount_cents is null or payment_amount_cents >= 0
  );

create unique index if not exists reservations_payment_return_token_hash_idx
  on public.reservations (payment_return_token_hash) where payment_return_token_hash is not null;
create unique index if not exists reservations_payment_link_token_hash_idx
  on public.reservations (payment_link_token_hash) where payment_link_token_hash is not null;
create index if not exists reservations_payment_status_idx on public.reservations (payment_status);

create table if not exists public.reservation_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  checkout_intent_id bigint unique,
  checkout_url text,
  status text not null default 'pending' check (status in ('pending', 'authorized', 'failed', 'expired')),
  order_id bigint,
  payment_id bigint,
  amount_cents integer not null check (amount_cents >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reservation_payment_attempts_reservation_idx
  on public.reservation_payment_attempts (reservation_id, created_at desc);
drop trigger if exists reservation_payment_attempts_set_updated_at on public.reservation_payment_attempts;
create trigger reservation_payment_attempts_set_updated_at before update on public.reservation_payment_attempts
for each row execute function public.set_updated_at();

create table if not exists public.helloasso_oauth_tokens (
  singleton boolean primary key default true check (singleton),
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.reservation_payment_attempts enable row level security;
alter table public.helloasso_oauth_tokens enable row level security;
drop policy if exists "Admins can read payment attempts" on public.reservation_payment_attempts;
create policy "Admins can read payment attempts" on public.reservation_payment_attempts
for select to authenticated using (public.is_admin());
revoke all on public.reservation_payment_attempts from anon, authenticated;
grant select on public.reservation_payment_attempts to authenticated;
revoke all on public.helloasso_oauth_tokens from anon, authenticated;

create or replace function public.reservation_cancellation_deadline(p_service_date date)
returns timestamptz language sql stable set search_path = public as $$
  select ((p_service_date + time '20:30') at time zone 'Europe/Paris') - interval '48 hours';
$$;

create or replace function public.protect_paid_reservation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.payment_status in ('paid', 'refund_pending', 'refunded', 'conflict') then
    raise exception 'Une réservation liée à un paiement ne peut pas être supprimée.';
  end if;
  if tg_op = 'UPDATE'
    and old.payment_status in ('paid', 'refund_pending', 'refunded', 'conflict')
    and (new.service_date is distinct from old.service_date or new.seats is distinct from old.seats) then
    raise exception 'La date et le nombre de places d’une réservation payée sont verrouillés.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists reservations_protect_paid on public.reservations;
create trigger reservations_protect_paid before update or delete on public.reservations
for each row execute function public.protect_paid_reservation();
grant execute on function public.reservation_cancellation_deadline(date) to anon, authenticated;

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
drop trigger if exists reservation_email_deliveries_set_updated_at on public.reservation_email_deliveries;
create trigger reservation_email_deliveries_set_updated_at before update on public.reservation_email_deliveries
for each row execute function public.set_updated_at();
alter table public.reservation_email_deliveries enable row level security;
drop policy if exists "Admins can read email deliveries" on public.reservation_email_deliveries;
create policy "Admins can read email deliveries" on public.reservation_email_deliveries
for select to authenticated using (public.is_admin());
revoke all on public.reservation_email_deliveries from anon, authenticated;
grant select on public.reservation_email_deliveries to authenticated;

-- After creating your admin user in Supabase Auth, add it here:
-- insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-000000000000');
