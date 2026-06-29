alter table public.reservations
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '';

drop function if exists public.create_public_reservation(date, text, text, integer, integer);

create or replace function public.create_public_reservation(
  p_service_date date,
  p_first_name text,
  p_last_name text,
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
    24 - (booked_seats + p_seats);
end;
$$;

revoke execute on function public.create_public_reservation(date, text, text, text, text, integer, integer) from public;
revoke execute on function public.create_public_reservation(date, text, text, text, text, integer, integer) from anon, authenticated;
grant execute on function public.create_public_reservation(date, text, text, text, text, integer, integer) to service_role;
