alter table public.reservations
  add column if not exists cancellation_token_hash text;

create unique index if not exists reservations_cancellation_token_hash_idx
  on public.reservations (cancellation_token_hash)
  where cancellation_token_hash is not null;
