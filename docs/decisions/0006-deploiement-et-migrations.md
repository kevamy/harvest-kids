# 0006 — Déploiement, migrations et données de démonstration

- Statut : accepté
- Date : 2026-10-18

## Contexte

L'environnement de test tourne sur Vercel (fonctions en fra1) avec une base Neon (Frankfurt) ; la production tournera dans Docker sur un VPS (lot 5). Il faut appliquer les migrations avec le rôle propriétaire sans que l'application ni le code d'une branche non fusionnée y aient accès, et charger des données fictives en test sans jamais pouvoir le faire en production. Le dépôt est public.

## Décision

- **Migrations sur Neon par une action GitHub** (`migrations-neon.yml`), après une CI verte sur `main` ou à la main, avec le secret du rôle propriétaire dans l'environnement GitHub `neon-test` seulement. Pas de migration au build Vercel : chaque prévisualisation appliquerait ses migrations, même non fusionnées, à la base partagée, et le code de chaque build verrait la chaîne du propriétaire.
- **Migrations sur le VPS** par le service `migrate` de `docker/docker-compose.yml`, qui s'exécute avant l'application et s'arrête.
- **Seed** : action manuelle avec confirmation (`seed-demo-neon.yml`) ; garde dans `prisma/seed-garde.ts` (base locale libre ; base distante seulement avec `HK_SEED_DEMO=autorise` et un mot de passe choisi) ; l'image de production ne contient pas le seed.
- **Contrôle de santé** `/api/sante` : 503 si `DATABASE_URL` désigne un rôle qui contourne ou peut désactiver la RLS, ou si les migrations manquent.
- **Protection de `main`** par un ruleset : pull request et quatre jobs de CI verts obligatoires.

## Conséquences

- Déploiement et migration ne sont pas atomiques en test : une fenêtre courte où `/api/sante` répond `migrations_absentes` est acceptée.
- GitHub ne déclenche `workflow_dispatch` et `workflow_run` que pour un fichier présent sur `main` : avant la première fusion, la mise en place de Neon se fait depuis le poste de l'exploitant (`docs/exploitation.md`).
- Si le dépôt passe en privé sur une offre GitHub gratuite, les rulesets et les environnements ne sont plus disponibles : il faudra GitHub Pro ou Team, ou déplacer les secrets Neon dans les secrets du dépôt et renoncer à la protection de `main`.
