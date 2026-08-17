# Booking La Reserve

Application React/Vite pour gérer les inscriptions et paiements HelloAsso du Zuru Zuru's Supper Club :

- `/inscription` : page publique avec formulaire de reservation et validation par email.
- `/validation` : validation d'une inscription depuis le lien recu par email.
- `/annulation` : confirmation d'annulation depuis le lien recu par email.
- `/paiement` : vérification serveur du retour de paiement HelloAsso.
- `/reglement?token=...` : page nominative de règlement pour une réservation déjà existante.
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

Les anciens liens de validation restent pris en charge. Les nouvelles inscriptions sont confirmées
par le paiement HelloAsso et ne reçoivent plus d'email de validation préalable.

## Paiements HelloAsso

Créer d'abord une organisation et des clés API dans le sandbox HelloAsso. Ajouter ensuite les secrets
aux fonctions Supabase (ne jamais utiliser de variable `VITE_` pour ces valeurs) :

```bash
supabase secrets set HELLOASSO_CLIENT_ID=...
supabase secrets set HELLOASSO_CLIENT_SECRET=...
supabase secrets set HELLOASSO_ORGANIZATION_SLUG=...
supabase secrets set HELLOASSO_ENVIRONMENT=sandbox
supabase secrets set HELLOASSO_RETURN_SITE_URL=https://votre-preview.vercel.app
```

Déployer les fonctions de paiement :

```bash
supabase functions deploy create-helloasso-checkout --no-verify-jwt
supabase functions deploy reconcile-helloasso-payment --no-verify-jwt
supabase functions deploy helloasso-webhook --no-verify-jwt
supabase functions deploy manage-reservation-payment-link --no-verify-jwt
supabase functions deploy reservation-payment-link --no-verify-jwt
supabase functions deploy send-supper-club-campaign --no-verify-jwt
```

Pour les réservations créées avant l’intégration HelloAsso, le dashboard admin propose
« Créer le lien de paiement ». Le lien contient un jeton aléatoire dont seule l’empreinte est
stockée en base. La page affiche le nom, la date, le nombre de places et le montant calculé côté
serveur. Après règlement, le rapprochement HelloAsso existant marque automatiquement la réservation
comme payée dans le dashboard.

## Campagne email du 16 juillet

Le dashboard admin contient une campagne ponctuelle pour les réservations confirmées du
16 juillet 2026. Elle sépare les invités payés des invités non payés, génère un lien individuel
pour ces derniers et conserve un suivi anti-doublon dans `reservation_email_deliveries`.
L’envoi réel reste désactivé dans l’interface tant que les deux versions de test n’ont pas été
envoyées à l’adresse de l’admin connecté.

Dans **HelloAsso > Mon compte > Intégrations et API**, configurer l'URL de notification :

```text
https://YOUR_PROJECT.supabase.co/functions/v1/helloasso-webhook
```

Le webhook n'accorde jamais une réservation sur la seule base de son contenu : la fonction relit
l'intention de paiement auprès de l'API HelloAsso. Le montant est fixé côté serveur à 2 800 centimes
par place. Tester le parcours avec les cartes virtuelles du sandbox avant de passer explicitement à :

```bash
supabase secrets set HELLOASSO_ENVIRONMENT=production
supabase secrets set HELLOASSO_RETURN_SITE_URL=https://votre-domaine-public.fr
```

Les annulations sont acceptées jusqu'à 48 heures avant le dîner de 20h30, heure de Paris. La place
est libérée immédiatement et le dashboard passe le paiement à « Remboursement à effectuer » ; le
remboursement reste manuel dans l'interface HelloAsso.

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
