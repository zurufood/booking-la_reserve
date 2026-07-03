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
    and id <> new.id
    and deposit_status = 'paye';

  if new.deposit_status = 'paye' and booked_seats + new.seats > 24 then
    raise exception 'Il ne reste pas assez de places pour ce jeudi.';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_enforce_capacity on public.reservations;
create trigger reservations_enforce_capacity
before insert or update of service_date, seats, deposit_status on public.reservations
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
    where reservations.deposit_status = 'paye'
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
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_seats integer,
  p_deposit_per_seat integer default 30
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
  normalized_first_name text := trim(p_first_name);
  normalized_last_name text := trim(p_last_name);
  normalized_email text := lower(trim(p_email));
  normalized_phone text := trim(p_phone);
begin
  if extract(dow from p_service_date)::integer <> 4 then
    raise exception 'Choisis un jeudi.';
  end if;

  if normalized_first_name = '' then
    raise exception 'Prenom requis.';
  end if;

  if normalized_last_name = '' then
    raise exception 'Nom requis.';
  end if;

  if normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email invalide.';
  end if;

  if normalized_phone = '' then
    raise exception 'Telephone requis.';
  end if;

  if p_seats is null or p_seats < 1 or p_seats > 24 then
    raise exception 'Nombre de places invalide.';
  end if;

  if p_deposit_per_seat is null or p_deposit_per_seat < 0 then
    raise exception 'Montant de paiement invalide.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_service_date::text));

  select coalesce(sum(public.reservations.seats), 0)
  into booked_seats
  from public.reservations
  where public.reservations.service_date = p_service_date
    and public.reservations.deposit_status = 'paye';

  if booked_seats + p_seats > 24 then
    raise exception 'Il ne reste pas assez de places pour ce jeudi.';
  end if;

  insert into public.reservations (
    service_date,
    first_name,
    last_name,
    email,
    phone,
    seats,
    deposit_per_seat,
    deposit_status
  )
  values (
    p_service_date,
    normalized_first_name,
    normalized_last_name,
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
    24 - booked_seats;
end;
$$;
