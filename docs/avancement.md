# Avancement

Suivi des lots du plan de livraison (section 15 du cahier des charges). Chaque lot se termine par une démonstration sur l'environnement Vercel et une validation avant le suivant.

| Lot                              | État                                                    | Branche et pull request |
| -------------------------------- | ------------------------------------------------------- | ----------------------- |
| 0. Fondations                    | **validé** sur Vercel le 2026-10-29, fusionné dans main | `lot-0`, PR n°1         |
| 1. Familles et cartes            | en attente des réponses des leaders                     | —                       |
| 2. Sessions, check-in, check-out | à faire                                                 | —                       |
| 3. Infirmerie, appels, urgence   | à faire                                                 | —                       |
| 4. Transition et pilotage        | à faire                                                 | —                       |
| 5. Robustesse et borne           | à faire                                                 | —                       |

## Lot 0 — Fondations

Critères d'acceptation (section 15) :

- [x] Connexion par rôle et choix de l'église.
- [x] Un utilisateur de l'église A ne voit aucune donnée de l'église B, y compris par une requête forcée (tests d'intégration sur PostgreSQL réel, RLS et `getTenantDb()`).
- [x] Page de démonstration des composants (`/design`) fidèle au design system.
- [x] CI verte (lint, types, tests unitaires, d'intégration, e2e, image Docker).
- [x] Build Docker qui démarre en local (vérifié en HTTPS derrière Caddy).

Livré :

1. Squelette Next.js 16 (standalone), TypeScript strict, ESLint, Prettier, Vitest, Playwright.
2. Design system Harvest Kids, composants `hk/`, page `/design`, PWA limitée à la coque.
3. Schéma Prisma, migrations, Row-Level Security sur les tables d'église, index partiels.
4. `getTenantDb()` et tests d'isolation A/B ; règle ESLint contre l'accès brut à la base.
5. Better Auth, rôles par église, verrouillage par PIN, en-têtes de sécurité (CSP avec nonce).
6. Layout tablette, console `/plateforme`, stockage `local` et `vercel-blob`, seed de deux églises fictives.
7. CI GitHub, image Docker et compose de production, migrations Neon par action GitHub, `/api/sante`.

Tests au dernier passage de la CI : 105 unitaires, 61 d'intégration, 58 de bout en bout (build de production, viewports tablette).

Environnement de test : prévisualisation Vercel de `lot-0` (`/api/sante`, connexion, choix d'église, `/design` et `/plateforme` vérifiés par l'exploitant), base Neon, Blob store privé en mode jeton.

Décisions : ADR 0001 à 0007 dans `docs/decisions/`. Exploitation : `docs/exploitation.md`.

Hors lot 0, reporté : Sentry ; écran d'appel et son appareil dédié (lot 3) ; déploiement sur le VPS (lot 5).

## Avant le lot 1

Le lot 1 ne commence pas avant les réponses de l'équipe des leaders aux points de la section 17 du cahier des charges, attendues dans `docs/reponses-leaders.md`. Pour le lot 1, les points qui comptent le plus : tranches d'âge et noms des classes (1), carte par famille ou par enfant (2), impression et plastification des cartes (5), conservation des données (7), paramètres par défaut d'une nouvelle église (9).
