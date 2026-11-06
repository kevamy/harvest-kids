# Avancement

Suivi des lots du plan de livraison (section 15 du cahier des charges). Chaque lot se termine par une démonstration sur l'environnement Vercel et une validation avant le suivant.

| Lot                              | État                                                                            | Branche et pull request                 |
| -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| 0. Fondations                    | **terminé** : validé sur Vercel le 2026-10-29, fusionné dans main le 2026-10-30 | `lot-0`, PR n°1 ; correctif PR n°2      |
| 1. Familles et cartes            | **en cours** : étapes 1 à 7 fusionnées dans main le 2026-11-05                  | PR n°4, n°5 ; suite sur `lot-1-comptes` |
| 2. Sessions, check-in, check-out | à faire                                                                         | —                                       |
| 3. Infirmerie, appels, urgence   | à faire                                                                         | —                                       |
| 4. Transition et pilotage        | à faire                                                                         | —                                       |
| 5. Robustesse et borne           | à faire                                                                         | —                                       |

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

Décisions des leaders intégrées au cahier des charges (version 1.2) : mode de carte par église (RG-16), classes et tranches d'âge par église (RG-17), impression des cartes par chaque église dans cinq formats (section 7.10). Points 1, 2 et 5 de la section 17 tranchés. Version 1.3 : la gestion des comptes, indispensable avant un pilote, rejoint le lot 1 (étape 8).

Étapes (plan validé le 2026-10-30) :

1. [x] Schéma, empreintes des jetons, cycle de vie des cartes (en attente, active, révoquée), fonction RG-14 (ADR 0008).
2. [x] Page Paramètres et profil de l'église ; barrière applicative récursive et tests d'isolation générés depuis le DMMF.
3. [x] Familles, brouillons et tâche quotidienne ; téléphones au format E.164.
4. [x] Cartes PDF (cinq formats, CR80 et planche A4), aperçus, PDF d'essai, remise et vérification par scan (ADR 0009).
5. [x] Mode de carte et réémission groupée ; textes de carte par église, contrôlés dans les cinq formats (ADR 0012).
6. [x] Badges moniteurs (table `BadgeMoniteur` sous RLS, révocation au remplacement, à la désactivation ou à la perte du rôle MONITEUR, ADR 0008) ; tests e2e d'écriture sur des églises créées pour le test, garde des données de démonstration.
7. [x] Import CSV (branche `lot-1-suite`, PR n°5, ADR 0013) : une ligne par enfant, regroupement par nom de famille et téléphone du tuteur 1 (ou prénom et nom du tuteur 1), prévisualisation, numéros à confirmer, doublons possibles, brouillons créés en une transaction ; droit `familles.importer` (ADMIN, RESPONSABLE).
8. [x] Comptes et rôles (branche `lot-1-comptes`, ADR 0014), ajoutée le 2026-11-04, cahier version 1.3 : Paramètres › Comptes (ADMIN) ; création d'un compte avec un lien d'activation à usage unique (7 jours), rattachement direct d'un compte existant, changement de rôles, désactivation et réactivation de l'appartenance ; réinitialisation à effet immédiat (lien de 24 heures, sessions fermées) ; seule l'empreinte SHA-256 du jeton est stockée (table de plateforme `JetonCompte`) ; liens réservés au super-administrateur pour un compte de plusieurs églises ; au moins un ADMIN actif (sous verrou) et pas de désactivation de son propre compte ; premier ADMIN d'une nouvelle église par lien aussi.
9. [x] Finition et fusion (PR n°6) : test de concurrence du dernier ADMIN rendu déterministe (point d'arrêt injectable ; sans le verrou, 5 échecs sur 5) ; limites comptées par personne d'abord, garde-fou de 300 essais par 15 minutes et par IP, route HTTP de connexion de Better Auth fermée (ADR 0003) ; connexion par téléphone avec la même normalisation (ancien numéro à 8 chiffres essayé avec 01) ; seed avec trois brouillons par église et des numéros de démonstration à 10 chiffres. Démonstration sur https://harvest-kids.vercel.app après la fusion.

Critères d'acceptation (section 15) et où ils sont vérifiés :

- [x] Une famille de 3 enfants s'inscrit en moins de 5 minutes (e2e `familles.spec.ts`, recette du 2026-11-05).
- [x] La carte imprimée porte le logo de l'église et se scanne (e2e `cartes.spec.ts`, recette avec une vraie carte).
- [x] Une carte révoquée est refusée ; une carte de l'église A est refusée dans l'église B (RG-14, `cartes-cycle.test.ts`, `rg14-fonction.test.ts`, e2e `cartes.spec.ts`).
- [x] En mode « une carte par enfant », une famille de 3 enfants reçoit 3 cartes ; après un changement de mode, les cartes existantes restent valides et la réémission émet les cartes du nouveau mode (`reemission.test.ts`, e2e `cartes.spec.ts`).
- [x] Le premier scan d'une nouvelle carte révoque les anciennes, avec audit, et la date limite révoque les anciennes non remplacées (`reemission.test.ts`, `taches.test.ts`).
- [x] Chaque PDF a les dimensions exactes de son format ; la page Paramètres affiche les cinq aperçus à la même échelle ; le PDF d'essai se télécharge (`impression.test.ts`, e2e `cartes.spec.ts`).
- [x] La base refuse une deuxième carte active pour une famille ou pour un enfant (index partiels, `cartes-cycle.test.ts`).
- [x] Seul un ADMIN change le mode de carte ; un ADMIN ou un RESPONSABLE modifie les classes, chevauchements et trous signalés sans blocage (`parametres.test.ts`, e2e `parametres.spec.ts`).
- [x] Le paramétrage d'une église est sans effet sur une autre (tests d'isolation A/B de chaque service).
- [x] Comptes : activation par lien de 7 jours (empreinte seule), lien expiré ou déjà utilisé refusé, réinitialisation de 24 heures qui ferme les sessions, compte désactivé sans accès et badge révoqué, au moins un ADMIN actif même en concurrence, pas de désactivation de son propre compte (`comptes.test.ts`, e2e `comptes.spec.ts`).

**Recette des étapes 1 à 6** : la PR n°4 (`lot-1`) est fusionnée dans `main` avant l'import CSV, pour tester ces étapes sur https://harvest-kids.vercel.app. « Migrations Neon » applique les migrations du lot 1 à la base partagée après la CI verte sur `main` ; avant cela, les prévisualisations ne peuvent pas utiliser les fonctions du lot 1.

**Suite du lot** : l'étape 7 a été fusionnée par la PR n°5 (`lot-1-suite`) ; les étapes 8 et 9 par la PR n°6 (`lot-1-comptes`). La démonstration du lot 1 complet a lieu sur https://harvest-kids.vercel.app après cette fusion ; le lot est terminé une fois la démonstration validée.

**Données de démonstration sur Neon** : la base de recette a été remplie avant la correction des numéros. Ses tuteurs de démonstration ont des numéros à 9 chiffres : en modifiant une de ces familles, le formulaire demande un numéro valide. Le seed n'est pas rejoué sur une base déjà remplie.

Notes pour les lots suivants :

- **Cartes** : l'inscription ne crée pas de carte ; la première impression (étape 4) crée la carte, directement active (ADR 0008), car le jeton en clair n'existe que dans le PDF.
- **Lot 2** : le check-in et le check-out appellent `activerAuPremierScan` (cartes en attente, y compris celles d'une réémission) ; les heures des présences s'affichent dans le fuseau de l'église avec `@date-fns/tz` (`src/lib/fuseau.ts`, ADR 0012).
- **Comptes et rôles** (étape 8, cahier §7.10, ADR 0014) : tout changement de rôle ou désactivation d'un membre passe par `modifierMembre` (`src/server/plateforme/badges.ts`), qui révoque le badge d'un membre qui n'est plus moniteur actif et applique les garde-fous des ADMIN. **Lot 3** : le compte ECRAN de l'écran d'appel n'est pas attribuable depuis Paramètres › Comptes. **Lot 5** : écran du super-administrateur pour les comptes de plusieurs églises. **Lot 2** : le check-in d'un moniteur par badge utilise `resoudreJeton` (statuts `badge_remplace` et `badge_refuse`).
- **Tests e2e** : un test qui écrit travaille dans une église créée pour lui (`tests/e2e/support/eglise-isolee.ts`) ; la garde `support/garde-demo.ts` fait échouer la suite si les données de démonstration changent.
- **Téléphones** (ADR 0011) : enregistrés au format E.164 (`+2290197451233`), affichés formatés. L'import CSV (étape 7) applique la même normalisation ; `Tuteur.telephone` est facultatif, mais le contact principal d'une famille finalisée a toujours un numéro valide (**lot 3** : le bouton Urgence peut compter dessus) ; les autres tuteurs peuvent ne pas en avoir. **Lot 3** : les liens `tel:` et `https://wa.me/` utilisent ce format (sans le « + » pour wa.me).

Points encore ouverts (section 17) : check-out à la porte des classes (3), horaires des cultes et délai d'alerte (4), lieu de rendez-vous de l'écran d'appel (6), conservation des données (7), domaine et exploitant (8), paramètres par défaut d'une nouvelle église (9).
