# Booking La Reserve

Application React/Vite pour gerer les inscriptions du Zuru Zuru's Supper Club :

- `/inscription` : page publique avec formulaire de reservation et validation par email.
- `/validation` : validation d'une inscription depuis le lien recu par email.
- `/annulation` : confirmation d'annulation depuis le lien recu par email.
- `/admin` : dashboard Supabase Auth pour suivre les inscriptions.

## Variables frontend

Creer un fichier `.env` local avec :

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

## Supabase

1. Executer `supabase/schema.sql` dans le SQL Editor Supabase, ou appliquer les migrations.
2. Creer l'utilisateur admin dans Supabase Auth.
3. Ajouter son `user_id` dans `public.admin_users`.

## Emails de validation

Les emails sont envoyes par Supabase Edge Functions via Resend. Ajouter les secrets :

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
supabase secrets set RESERVATION_EMAIL_FROM="Zuru Zuru <reservation@votre-domaine.fr>"
supabase secrets set RESERVATION_EMAIL_REPLY_TO=contact@votre-domaine.fr
supabase secrets set PUBLIC_SITE_URL=https://votre-site.example
supabase secrets set VALIDATION_TOKEN_TTL_MINUTES=120
supabase secrets set GOOGLE_REVIEW_URL=https://votre-lien-avis-google
supabase secrets set FEEDBACK_EMAIL_CRON_SECRET=une-valeur-longue-et-aleatoire
```

Deployer les fonctions :

```bash
supabase functions deploy create-reservation-request --no-verify-jwt
supabase functions deploy confirm-reservation --no-verify-jwt
supabase functions deploy cancel-reservation --no-verify-jwt
supabase functions deploy resend-reservation-summary --no-verify-jwt
supabase functions deploy send-feedback-emails --no-verify-jwt
```

## Email post-evenement

La fonction `send-feedback-emails` envoie un email aux inscriptions confirmees d'une date donnee,
puis renseigne `feedback_email_sent_at` pour eviter les doublons.

Pour le repas du 16.07.2026, planifier un POST le 17.07.2026, par exemple a 10:00 Europe/Paris :

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-feedback-emails" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $FEEDBACK_EMAIL_CRON_SECRET" \
  -d '{"serviceDate":"2026-07-16"}'
```

Pour tester sans envoyer :

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-feedback-emails" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $FEEDBACK_EMAIL_CRON_SECRET" \
  -d '{"serviceDate":"2026-07-16","dryRun":true,"force":true}'
```

## Developpement

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
```
