drop trigger if exists reservations_enforce_capacity on public.reservations;

alter table public.reservations
  add column if not exists validation_status text,
  add column if not exists validation_token_hash text,
  add column if not exists validation_sent_at timestamptz,
  add column if not exists validation_expires_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_email_sent_at timestamptz;

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

create index if not exists reservations_validation_status_idx
  on public.reservations (validation_status);

create unique index if not exists reservations_validation_token_hash_idx
  on public.reservations (validation_token_hash)
  where validation_token_hash is not null;

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

grant execute on function public.get_public_availability(date, integer) to anon, authenticated;
grant execute on function public.reservation_holds_seats(text, timestamptz) to anon, authenticated;
