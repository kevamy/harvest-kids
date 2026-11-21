# Avancement

Suivi des lots du plan de livraison (section 15 du cahier des charges). Chaque lot se termine par une démonstration sur l'environnement Vercel et une validation avant le suivant.

| Lot                              | État                                                                                                           | Branche et pull request                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 0. Fondations                    | **terminé** : validé sur Vercel le 2026-10-29, fusionné dans main le 2026-10-30                                | `lot-0`, PR n°1 ; correctif PR n°2      |
| 1. Familles et cartes            | **terminé** : validé sur Vercel le 2026-11-06                                                                  | PR n°4 à n°7 ; `lot-1-matricules-liste` |
| 2. Sessions, check-in, check-out | **en cours** : étapes 1 à 3 fusionnées le 2026-11-14 ; étapes 4 et 5 validées le 2026-11-21 ; étape 6 en cours | PR n°9 et n°10 ; `lot-2-suite`, PR n°11 |
| 3. Infirmerie, appels, urgence   | à faire                                                                                                        | —                                       |
| 4. Transition et pilotage        | à faire                                                                                                        | —                                       |
| 5. Robustesse et borne           | à faire                                                                                                        | —                                       |

## Décisions et questions ouvertes

À relire au début de chaque session. Chaque validation d'étape, décision ou vérification demandée par l'utilisateur y est notée dès qu'elle est donnée, avec sa date.

- **2026-11-21** — Vérification demandée : aucun écart de schéma après la migration `tableaux_non_nuls`. **Faite par l'utilisateur** (`prisma migrate diff`, aucun écart).
- **2026-11-21** — **Étape 5 du lot 2 validée** (check-out à l'accueil, cas exceptionnels, check-out en salle).
- **2026-11-21** — Question ouverte, à traiter en premier dans l'étape 6 : la revue du schéma prévoyait, en plus des 5 codes erronés par tablette, une **limite globale de 20 codes erronés par session de culte**, toutes tablettes et sessions de connexion confondues, avec une alerte au tableau de l'accueil. Elle n'existe pas (l'ADR 0016 dit seulement qu'une reconnexion remet le compteur de la tablette à zéro) : à ajouter, avec un test (5 erreurs, déconnexion, reconnexion, nouvelles erreurs jusqu'à la limite globale et l'alerte), puis corriger l'ADR 0016. **Traitée le 2026-11-21** : limite ajoutée sans changement de schéma (compteur `checkout-code-session:{église}:{session}` dans `AuthRateLimit`, fenêtre de 24 heures, `src/server/plateforme/limitation.ts`), blocage des codes sur toutes les tablettes jusqu'à la fin de la session, scan et retrait sans carte ni code toujours possibles ; alerte « Codes de retrait bloqués » au tableau de l'accueil tant que la session est ouverte ; audit avec les deux compteurs. Tests : `checkout.test.ts` (4 connexions de 5 erreurs, 5ᵉ connexion bloquée, églises A/B, autre session, fenêtre) et e2e `checkout.spec.ts` (vraie déconnexion et reconnexion, alerte, bon code refusé à la 5ᵉ connexion). ADR 0016 corrigé. Vérifications locales : lint, types, 248 unitaires ; intégration complète 314/314 au second passage (143 s) ; le premier passage (725 s, poste à court de mémoire) avait un échec isolé dans `auth.test.ts` (« PIN : 15 moniteurs… »), sans lien avec ce changement, qui passe seul (22/22). L'e2e passe par la CI.
- **2026-11-21** — Seed de démonstration du lot 2, choix de l'utilisateur (églises de démonstration seulement, idempotent) : un culte « Démonstration » chaque jour de 07:00 à 22:00 (heure de l'église) ; 4 comptes moniteurs de plus par église (`moniteur2` à `moniteur5`, mot de passe et PIN de démonstration) ; une session passée (dimanche précédent) clôturée, enfants récupérés, avec un incident « retrait non autorisé » et une photo de silhouette fictive, écrite par les services du lot 2 ; `checkout.lieu` : Cotonou « accueil », Porto-Novo « accueil et classes ».
- **2026-11-21** — ADR 0017 ajouté (sessions du jour, ouverture des classes, check-in : décisions des étapes 1 à 3, qui n'avaient pas d'ADR).
- **2026-11-21** — Règle de suivi : toute validation, décision ou vérification demandée est notée immédiatement dans cette section.
- **2026-11-21** — Étape 6 demandée : pousser `0d21560`, corriger le tableau d'avancement, seed de démonstration du lot 2, ADR manquants, fusion de la PR n°11 une fois la CI verte, vérification de « Migrations Neon », puis liste de démonstration sur https://harvest-kids.vercel.app.

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

## Lot 1 — Familles et cartes

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

Retour de démonstration (2026-11-06) : liste « Familles inscrites » sur `/familles` (par nom, 25 par page, enfants et matricules, contact principal, état de la carte, total en titre), lisible avec `familles.gerer` ou `checkin` ; message de confirmation sur la fiche après une inscription, une finalisation ou une modification (branche `lot-1-familles-inscrites`, PR n°7).

Clôture (branche `lot-1-matricules-liste`) : dans cette liste, matricule en taille de liste (`MatriculeBadge taille="sm"`, Fredoka 20 px, sur la ligne de son prénom) ; le grand style reste au scan, sur la fiche, sur la carte et à l'écran d'appel. Enfants du plus âgé au plus jeune dans la liste et sur la fiche (test d'intégration). Réparation idempotente des numéros de démonstration de Neon par le seed (voir plus bas). PostgreSQL du poste sans synchronisation du disque (`docs/exploitation.md`).

**Lot 1 terminé** : liste des familles vérifiée sur https://harvest-kids.vercel.app le 2026-11-06.

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

**Suite du lot** : l'étape 7 a été fusionnée par la PR n°5 (`lot-1-suite`) ; les étapes 8 et 9 par la PR n°6 (`lot-1-comptes`) ; le retour de démonstration par la PR n°7. La démonstration du lot 1 complet a été validée le 2026-11-06.

**Données de démonstration sur Neon** : la base de recette a été remplie avant la correction des numéros ; ses tuteurs de démonstration avaient des numéros à 9 chiffres. Le seed les répare désormais (ajout du 0 final, idempotent, églises de démonstration seulement) : lancer le workflow « Données de démonstration Neon » depuis `main` (`docs/exploitation.md`). Il ne recrée aucune famille sur une base déjà remplie.

Notes pour les lots suivants :

- **Cartes** : l'inscription ne crée pas de carte ; la première impression (étape 4) crée la carte, directement active (ADR 0008), car le jeton en clair n'existe que dans le PDF.
- **Lot 2** : le check-in et le check-out appellent `activerAuPremierScan` (cartes en attente, y compris celles d'une réémission) ; les heures des présences s'affichent dans le fuseau de l'église avec `@date-fns/tz` (`src/lib/fuseau.ts`, ADR 0012).
- **Comptes et rôles** (étape 8, cahier §7.10, ADR 0014) : tout changement de rôle ou désactivation d'un membre passe par `modifierMembre` (`src/server/plateforme/badges.ts`), qui révoque le badge d'un membre qui n'est plus moniteur actif et applique les garde-fous des ADMIN. **Lot 3** : le compte ECRAN de l'écran d'appel n'est pas attribuable depuis Paramètres › Comptes. **Lot 5** : écran du super-administrateur pour les comptes de plusieurs églises. **Lot 2** : le check-in d'un moniteur par badge utilise `resoudreJeton` (statuts `badge_remplace` et `badge_refuse`).
- **Tests e2e** : un test qui écrit travaille dans une église créée pour lui (`tests/e2e/support/eglise-isolee.ts`) ; la garde `support/garde-demo.ts` fait échouer la suite si les données de démonstration changent.
- **Téléphones** (ADR 0011) : enregistrés au format E.164 (`+2290197451233`), affichés formatés. L'import CSV (étape 7) applique la même normalisation ; `Tuteur.telephone` est facultatif, mais le contact principal d'une famille finalisée a toujours un numéro valide (**lot 3** : le bouton Urgence peut compter dessus) ; les autres tuteurs peuvent ne pas en avoir. **Lot 3** : les liens `tel:` et `https://wa.me/` utilisent ce format (sans le « + » pour wa.me).

Points encore ouverts (section 17) : check-out à la porte des classes (3), horaires des cultes et délai d'alerte (4), lieu de rendez-vous de l'écran d'appel (6), conservation des données (7), domaine et exploitant (8), paramètres par défaut d'une nouvelle église (9).

## Lot 2 — Sessions, check-in, check-out

Plan validé le 2026-11-06. Étapes 1 à 3 validées et fusionnées le 2026-11-14 (PR n°9, `eea9d1f`) ; « Migrations Neon » a appliqué `lot2_sessions`, `/api/sante` répond `{"ok":true}`. Recette de l'utilisateur à venir sur https://harvest-kids.vercel.app : écrans à encoche (`/sessions`, Paramètres, familles) et un check-in réel. Étapes 4 à 6 sur `lot-2-suite` (PR n°10). À relire au début de chaque session : cette section dit où reprendre, y compris les corrections validées qui ne sont pas encore appliquées.

Étapes :

1. [x] Cultes, délais, lieux de rendez-vous et lieu du retrait ; liens `tel:` et WhatsApp (`6a77f23`), puis migration `lot2_sessions` (`cee78d2`).
2. [x] Sessions du jour, ouverture des classes, moniteurs (`80113ab`) ; ouverture forcée avec au moins un moniteur, alerte maximale sans moniteur (`6892a28`).
3. [x] Check-in à l'accueil (`308a25f`). Correctif du 2026-11-14 (e2e rouge en CI sur `checkin.spec.ts`, les deux tablettes) :
   - **Paysage** : la famille ne tenait pas à l'écran, car `NotchCard` réservait la place de l'encoche (environ 70 px) sur tout le contenu enveloppé. Désormais, seul le titre (titre `h1` à `h6` ou `<header>`, jusqu'à deux niveaux sous la carte) laisse cette place ; une carte sans titre la laisse à son premier élément. La règle est reprise parmi les utilitaires : un `m-0` sur le titre l'annulait. En paysage, le scan prend 1/3 de la largeur et la famille 2/3 ; les onglets partagent une ligne avec le bandeau d'alertes.
   - **Portrait** : les décomptes SQL du test ne filtraient pas sur l'église du test. La connexion propriétaire des tests est soumise à la RLS forcée, sauf en lecture sur `CarteFamille` et `BadgeMoniteur` (politique `rg14_lecture_proprietaire`, RG-14) : le décompte des cartes actives voyait toutes les églises. Même correction dans `cartes.spec.ts` ; règle ajoutée à `CLAUDE.md`.
   - CI verte sur `bf65100` (lint, types, unitaires, intégration, e2e, image Docker). Check-in mesuré du scan à la confirmation : 368 ms en paysage, 288 ms en portrait (artefact `captures-e2e`, fichiers `mesure-checkin.txt`).
4. [x] Vue moniteur `/classe/[id]`, confirmation en salle (`cec4ac2`, `8d2daf3`, `a727c08`).
5. [x] Check-out : 5a à l'accueil, 5b cas exceptionnels, 5c en salle (`f48be1e` à `bf5b99a`) ; validée le 2026-11-21.
6. [ ] Finition : seed, ADR, démonstration.

Tests d'intégration (2026-11-14, `59e3812`) : 75 requêtes SQL brutes sur une table d'église reprises : filtrées sur l'église du test, sauf les preuves d'isolation, laissées sans filtre et commentées ; décomptes par `compterDansEglise`, ou `compterToutesEglises` pour les preuves d'isolation. Suite complète pas encore relancée en local (Docker Desktop arrêté) ; la CI de la PR n°10 la fait tourner.

Corrections validées, pas encore appliquées : aucune.

PR n°10 (tests d'intégration) fusionnée le 2026-11-14 (`392d838`). Étapes 4 à 6 sur `lot-2-suite`, PR n°11.

Étape 4 (vue moniteur, confirmation en salle, annulation ; cahier 1.5, ADR 0015) commitée le 2026-11-14 (`cec4ac2`). L'e2e a révélé une liste de classe qui plantait sur un enfant aux `alertes` NULL : corrigé à la cause le 2026-11-15 (`8d2daf3`) par la migration `tableaux_non_nuls` (`Enfant.alertes` et `Membre.roles` NOT NULL DEFAULT '{}', reprise des NULL église par église, garde-fou), le `COALESCE` gardé dans les lectures brutes de tableaux, un test de migration et un test du refus de NULL ; puis le décompte du test e2e corrigé (`a727c08`). CI de la PR n°11 verte sur `a727c08`. Vérifié par l'utilisateur le 2026-11-21 : `prisma migrate diff` ne montre aucun écart après `tableaux_non_nuls`.

Étape 5a commitée le 2026-11-15 (`f48be1e`), avec le correctif de l'ordre des prénoms dans les messages de retrait et d'arrivée (`cc8bc6b`, du plus âgé au plus jeune, validé par l'utilisateur) ; CI de la PR n°11 verte sur `cc8bc6b`. Étape 5b validée par l'utilisateur le 2026-11-15 (second membre, photo caméra seule avec consigne, photo visible dans le seul détail de l'incident pour RESPONSABLE et ADMIN, cahier 1.6). 5b-1 (ni carte ni code, `560284d`) : CI verte, intégration complète passée en local (308 tests). 5b-2 (retrait exceptionnel, incidents, `d5a08d5`) : lint, types, unitaires et intégration complète passés en local (311 tests, relancée après fermeture des navigateurs : un premier passage avait été arrêté par manque de mémoire). CI de la PR n°11 verte sur `d5a08d5`. Étape 5c (check-out en salle) : décisions de l'utilisateur du 2026-11-15 (seuls les enfants de la classe, cas exceptionnels renvoyés à l'accueil, membres affectés avec la même limite de codes) ; commitée (`bf5b99a`), intégration complète passée en local (313 tests), CI de la PR n°11 verte. Étape 5 complète, validée par l'utilisateur le 2026-11-21. Reste l'étape 6 (finition : seed, démonstration).

Étape 5, découpée en trois commits : **5a** check-out à l'accueil (onglet Check-out, scan ou code dans un même champ, enfants avec statut et lieu, photo de la personne qui récupère, codes erronés limités à 5 par tablette et par session, ADR 0016) ; **5b** cas exceptionnels (adulte non reconnu autorisé par le responsable avec son PIN, photo et incident ; ni carte ni code avec un second membre) ; **5c** check-out en salle si `checkout.lieu` le permet.
