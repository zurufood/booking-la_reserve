alter table public.reservations
  add column if not exists feedback_email_sent_at timestamptz;

create index if not exists reservations_feedback_email_pending_idx
  on public.reservations (service_date)
  where validation_status = 'confirmed'
    and feedback_email_sent_at is null;
