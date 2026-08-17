alter table public.reservations
  add column if not exists payment_link_token_hash text,
  add column if not exists payment_link_created_at timestamptz;

create unique index if not exists reservations_payment_link_token_hash_idx
  on public.reservations (payment_link_token_hash)
  where payment_link_token_hash is not null;

