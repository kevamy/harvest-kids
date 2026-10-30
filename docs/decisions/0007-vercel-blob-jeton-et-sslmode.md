# 0007 — Vercel Blob en mode jeton et `sslmode` des chaînes Neon

- Statut : accepté
- Date : 2026-10-29

## Contexte

- Un Blob store Vercel relié au projet n'injecte que `BLOB_STORE_ID` et `BLOB_WEBHOOK_PUBLIC_KEY`. Le SDK `@vercel/blob` 2.8 sait s'authentifier par OIDC (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`), mais ce jeton OIDC n'existe que dans les fonctions Vercel. Le seed de démonstration, lui, écrit dans le store depuis GitHub Actions ou depuis le poste de l'exploitant.
- `pg` 8 avertit que `sslmode=require` sera assoupli en v9 (chiffrement sans vérification du certificat). Le moteur de schéma de Prisma 7 (`prisma migrate`), lui, ne connaît que `disable`, `prefer` et `require`, et retombe sur `prefer` pour toute autre valeur.

## Décision

- Le pilote `vercel-blob` utilise uniquement `BLOB_READ_WRITE_TOKEN`, passé explicitement au SDK à chaque appel ; la variable est ajoutée à la main dans Vercel (Preview) et dans l'environnement GitHub `neon-recette`. Le jeton explicite est prioritaire dans le SDK : l'OIDC n'est jamais tenté.
- `DATABASE_URL` (lue par `pg`) porte `sslmode=verify-full` ; `DATABASE_MIGRATION_URL` (lue par `prisma migrate`) garde `sslmode=require`.

## Conséquences

- Un seul mode d'authentification du stockage, identique sur Vercel, en CI et sur le poste. Le jeton est un secret à faire tourner à la main (procédure dans `docs/exploitation.md`).
- Les deux chaînes Neon n'ont pas le même `sslmode` ; l'écart est documenté dans `.env.example` et `docs/exploitation.md`. À revoir si Prisma accepte `verify-full`.
- La production (VPS, lot 5) n'est pas concernée : pilote `local` et base dans le réseau Docker.
