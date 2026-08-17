alter table public.reservations
  add column if not exists payment_status text not null default 'manual',
  add column if not exists payment_amount_cents integer,
  add column if not exists helloasso_order_id bigint,
  add column if not exists helloasso_payment_id bigint,
  add column if not exists payment_return_token_hash text,
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
  on public.reservations (payment_return_token_hash)
  where payment_return_token_hash is not null;

create index if not exists reservations_payment_status_idx
  on public.reservations (payment_status);

create table if not exists public.reservation_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  checkout_intent_id bigint unique,
  checkout_url text,
  status text not null default 'pending' check (
    status in ('pending', 'authorized', 'failed', 'expired')
  ),
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
create trigger reservation_payment_attempts_set_updated_at
before update on public.reservation_payment_attempts
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
create policy "Admins can read payment attempts"
on public.reservation_payment_attempts for select to authenticated
using (public.is_admin());

revoke all on public.reservation_payment_attempts from anon, authenticated;
grant select on public.reservation_payment_attempts to authenticated;
revoke all on public.helloasso_oauth_tokens from anon, authenticated;

create or replace function public.reservation_cancellation_deadline(p_service_date date)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((p_service_date + time '20:30') at time zone 'Europe/Paris') - interval '48 hours';
$$;

create or replace function public.protect_paid_reservation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.payment_status in ('paid', 'refund_pending', 'refunded', 'conflict') then
    raise exception 'Une réservation liée à un paiement ne peut pas être supprimée.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status in ('paid', 'refund_pending', 'refunded', 'conflict')
    and (new.service_date is distinct from old.service_date or new.seats is distinct from old.seats)
  then
    raise exception 'La date et le nombre de places d’une réservation payée sont verrouillés.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists reservations_protect_paid on public.reservations;
create trigger reservations_protect_paid
before update or delete on public.reservations
for each row execute function public.protect_paid_reservation();

grant execute on function public.reservation_cancellation_deadline(date) to anon, authenticated;
