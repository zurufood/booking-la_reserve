# Booking La Reserve

Application React/Vite pour gerer les inscriptions d'un restaurant ephemere :

- `/inscription` : page publique avec reservation et paiement d'acompte Mollie.
- `/admin` : dashboard Supabase Auth pour suivre les inscriptions et acomptes.

## Variables frontend

Creer un fichier `.env` local avec :

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_DEPOSIT_PER_SEAT=10
```

## Supabase

1. Executer `supabase/schema.sql` dans le SQL Editor Supabase.
2. Creer l'utilisateur admin dans Supabase Auth.
3. Ajouter son `user_id` dans `public.admin_users`.

## Mollie

Les cles Mollie ne doivent jamais etre dans React ou Git. Les ajouter comme secrets Supabase Edge Functions :

```bash
supabase secrets set MOLLIE_API_KEY=your_mollie_api_key
supabase secrets set PUBLIC_SITE_URL=https://votre-site.example
supabase secrets set MOLLIE_WEBHOOK_URL=https://PROJECT_REF.functions.supabase.co/mollie-webhook
supabase secrets set DEPOSIT_PER_SEAT=10
```

## Emails de confirmation

Les emails de confirmation sont envoyes par le webhook Mollie apres paiement confirme. Ajouter les secrets Supabase :

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
supabase secrets set RESERVATION_EMAIL_FROM="La Reserve - Darwin <reservation@votre-domaine.fr>"
supabase secrets set RESERVATION_EMAIL_REPLY_TO=contact@votre-domaine.fr
```

Deployer les fonctions :

```bash
supabase functions deploy create-reservation-payment
supabase functions deploy mollie-webhook --no-verify-jwt
```

## Developpement

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
```
