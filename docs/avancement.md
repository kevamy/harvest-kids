# Avancement

Suivi des lots du plan de livraison (section 15 du cahier des charges). Chaque lot se termine par une démonstration sur l'environnement Vercel et une validation avant le suivant.

| Lot                              | État                                                                            | Branche et pull request            |
| -------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| 0. Fondations                    | **terminé** : validé sur Vercel le 2026-10-29, fusionné dans main le 2026-10-30 | `lot-0`, PR n°1 ; correctif PR n°2 |
| 1. Familles et cartes            | **en cours** : étapes 1 à 5 faites                                              | `lot-1`, PR `lot-1` → `main`       |
| 2. Sessions, check-in, check-out | à faire                                                                         | —                                  |
| 3. Infirmerie, appels, urgence   | à faire                                                                         | —                                  |
| 4. Transition et pilotage        | à faire                                                                         | —                                  |
| 5. Robustesse et borne           | à faire                                                                         | —                                  |

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

Environnement de recette : https://harvest-kids.vercel.app, déployé depuis `main` (base Neon, Blob store privé en mode jeton). Les migrations y sont appliquées par le workflow « Migrations Neon » après chaque CI verte sur `main`. Le lot 0 a d'abord été validé sur la prévisualisation de `lot-0` (`/api/sante`, connexion, choix d'église, `/design` et `/plateforme`).

Décisions : ADR 0001 à 0007 dans `docs/decisions/`. Exploitation : `docs/exploitation.md`.

Hors lot 0, reporté : Sentry ; écran d'appel et son appareil dédié (lot 3) ; déploiement sur le VPS (lot 5).

## Lot 1 — Familles et cartes (en cours)

Décisions des leaders intégrées au cahier des charges (version 1.2) : mode de carte par église (RG-16), classes et tranches d'âge par église (RG-17), impression des cartes par chaque église dans cinq formats (section 7.10). Points 1, 2 et 5 de la section 17 tranchés.

Étapes (plan validé le 2026-10-30) :

1. [x] Schéma, empreintes des jetons, cycle de vie des cartes (en attente, active, révoquée), fonction RG-14 (ADR 0008).
2. [x] Page Paramètres et profil de l'église ; barrière applicative récursive et tests d'isolation générés depuis le DMMF.
3. [x] Familles, brouillons et tâche quotidienne ; téléphones au format E.164.
4. [x] Cartes PDF (cinq formats, CR80 et planche A4), aperçus, PDF d'essai, remise et vérification par scan (ADR 0009).
5. [x] Mode de carte et réémission groupée ; textes de carte par église, contrôlés dans les cinq formats (ADR 0012).
6. [ ] Badges moniteurs.
7. [ ] Import CSV.
8. [ ] Finition, fusion et démonstration.

**Démonstration** : sur https://harvest-kids.vercel.app, **après la fusion** de la PR du lot 1. La prévisualisation `lot-1` utilise la base Neon partagée, qui n'est migrée par « Migrations Neon » qu'après la fusion : les fonctions du lot 1 n'y sont pas utilisables avant. Les corrections éventuelles issues de la démonstration passeront par une petite PR.

Notes pour les lots suivants :

- **Cartes** : l'inscription ne crée pas de carte ; la première impression (étape 4) crée la carte, directement active (ADR 0008), car le jeton en clair n'existe que dans le PDF.
- **Lot 2** : le check-in et le check-out appellent `activerAuPremierScan` (cartes en attente, y compris celles d'une réémission) ; les heures des présences pourront passer par `@date-fns/tz` à la place de `src/lib/fuseau.ts` (ADR 0012).
- **Téléphones** (ADR 0011) : enregistrés au format E.164 (`+2290197451233`), affichés formatés. L'import CSV (étape 7) applique la même normalisation. **Lot 3** : les liens `tel:` et `https://wa.me/` utilisent ce format (sans le « + » pour wa.me).

Points encore ouverts (section 17) : check-out à la porte des classes (3), horaires des cultes et délai d'alerte (4), lieu de rendez-vous de l'écran d'appel (6), conservation des données (7), domaine et exploitant (8), paramètres par défaut d'une nouvelle église (9).
