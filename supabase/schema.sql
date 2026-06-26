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
  email text not null,
  phone text not null,
  seats integer not null check (seats between 1 and 24),
  deposit_per_seat integer not null default 10 check (deposit_per_seat >= 0),
  deposit_status text not null default 'a-payer' check (deposit_status in ('a-payer', 'paye'))
);

create index if not exists reservations_service_date_idx
  on public.reservations (service_date);

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

  perform pg_advisory_xact_lock(hashtext(new.service_date::text));

  select coalesce(sum(seats), 0)
  into booked_seats
  from public.reservations
  where service_date = new.service_date
    and id <> new.id;

  if booked_seats + new.seats > 24 then
    raise exception 'Il ne reste pas assez de places pour ce jeudi.';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_enforce_capacity on public.reservations;
create trigger reservations_enforce_capacity
before insert or update of service_date, seats on public.reservations
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

create or replace function public.create_public_reservation(
  p_service_date date,
  p_email text,
  p_phone text,
  p_seats integer,
  p_deposit_per_seat integer default 10
)
returns table (
  id uuid,
  service_date date,
  seats integer,
  deposit_per_seat integer,
  deposit_total integer,
  deposit_status text,
  remaining_seats integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  booked_seats integer;
  new_id uuid;
  normalized_email text := lower(trim(p_email));
  normalized_phone text := trim(p_phone);
begin
  if extract(dow from p_service_date)::integer <> 4 then
    raise exception 'Choisis un jeudi.';
  end if;

  if normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email invalide.';
  end if;

  if normalized_phone = '' then
    raise exception 'Téléphone requis.';
  end if;

  if p_seats is null or p_seats < 1 or p_seats > 24 then
    raise exception 'Nombre de places invalide.';
  end if;

  if p_deposit_per_seat is null or p_deposit_per_seat < 0 then
    raise exception 'Montant d''acompte invalide.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_service_date::text));

  select coalesce(sum(public.reservations.seats), 0)
  into booked_seats
  from public.reservations
  where public.reservations.service_date = p_service_date;

  if booked_seats + p_seats > 24 then
    raise exception 'Il ne reste pas assez de places pour ce jeudi.';
  end if;

  insert into public.reservations (
    service_date,
    email,
    phone,
    seats,
    deposit_per_seat,
    deposit_status
  )
  values (
    p_service_date,
    normalized_email,
    normalized_phone,
    p_seats,
    p_deposit_per_seat,
    'a-payer'
  )
  returning reservations.id into new_id;

  return query
  select
    new_id,
    p_service_date,
    p_seats,
    p_deposit_per_seat,
    p_seats * p_deposit_per_seat,
    'a-payer'::text,
    24 - (booked_seats + p_seats);
end;
$$;

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
grant execute on function public.create_public_reservation(date, text, text, integer, integer) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant select, insert, update, delete on public.reservations to authenticated;

-- After creating your admin user in Supabase Auth, add it here:
-- insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-000000000000');
