# Booking La Reserve

Application React/Vite pour gerer les inscriptions du Zuru Zuru's Supper Club :

- `/inscription` : page publique avec formulaire de reservation.
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

## Developpement

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run build
```
