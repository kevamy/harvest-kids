# 0002 — Isolation multi-églises : RLS, clés composites et index partiels

- Statut : accepté (étape 3 : base ; étape 4 : client scopé)
- Date : 2026-10-18

## Contexte

Une seule base sert toutes les églises (cahier §3 bis, RG-13). Une requête oubliée, un `where` manquant ou un identifiant d'une autre église passé dans un formulaire ne doivent jamais exposer ni modifier les données d'une autre église. Ce sont des données de mineurs.

## Décision

**Deux rôles PostgreSQL.** Le propriétaire des tables exécute les migrations (`DATABASE_MIGRATION_URL`). L'application se connecte avec `hk_app` (`DATABASE_URL`) : `NOBYPASSRLS`, jamais propriétaire, sans accès à `_prisma_migrations`. La migration crée `hk_app` en `NOLOGIN` s'il n'existe pas ; le mot de passe est posé hors migration.

**Row-Level Security sur les 17 tables d'église**, avec `ENABLE` et `FORCE` (la politique s'applique aussi au propriétaire). Une politique `tenant_isolation` par table : `USING` et `WITH CHECK ("egliseId" = hk_eglise_active())`. `hk_eglise_active()` lit `app.eglise_id`, positionné par transaction avec `set_config(..., true)` (l'équivalent paramétrable de `SET LOCAL`). Hors transaction, ou sans église active, aucune ligne n'est visible et aucune écriture n'est possible. Le réglage ne survit pas à la transaction, ce qui est compatible avec un pooler en mode transaction (Neon).

**Tables de plateforme hors RLS** : `Eglise`, `User`, `Membre`, `AccesSupport`, `AuditPlateforme` et les tables `Auth*`. On n'y accède que depuis `src/server/plateforme/`, `src/lib/tenant.ts` et `src/lib/auth.ts`.

**Clés étrangères composites.** Chaque table d'église porte `@@unique([id, egliseId])`, et ses relations vers d'autres tables d'église sont `(xId, egliseId) → (id, egliseId)`. Les contrôles de clé étrangère ignorent la RLS : sans clé composite, une ligne de l'église A pourrait pointer vers un enfant de l'église B. Avec elle, la base refuse (`23503`). Les relations optionnelles portent `onDelete: Restrict`, car le `SetNull` par défaut viderait aussi `egliseId`.

**Journaux non modifiables (RG-09).** `hk_app` n'a que `SELECT` et `INSERT` sur `AuditLog`, `AuditPlateforme` et `EvenementPresence`.

**Index partiels uniques (préversion Prisma `partialIndexes`).** Deux règles sont garanties par la base plutôt que par le seul code :

- `Presence_une_ouverte_par_enfant` : `UNIQUE (enfantId) WHERE statut <> 'RECUPERE' AND basculeVers IS NULL` (RG-08) ;
- `CarteFamille_une_active_par_famille` : `UNIQUE (familleId) WHERE revoqueeLe IS NULL`.

On utilise la fonction en préversion `partialIndexes` de Prisma 7.10 (`@@unique(..., where: raw(...))`) plutôt qu'un index écrit à la main dans une migration SQL : Prisma connaît alors l'index et ne propose pas de le supprimer à la migration suivante (pas de dérive de schéma). Contrepartie : une fonction en préversion peut évoluer. Garde-fou : `tests/integration/rls.test.ts` vérifie que les deux index existent en base, avec leur condition `WHERE`, et qu'ils refusent une seconde présence ouverte ou une seconde carte active (`23505`). Si une mise à jour de Prisma change ce comportement, la CI échoue.

**Garde-fous automatiques** (`tests/integration/rls.test.ts`) :

- test de catalogue : toute table portant `egliseId`, hors liste de plateforme, a la RLS activée, forcée, et sa politique ;
- `hk_app` n'est ni superutilisateur, ni BYPASSRLS, ni propriétaire.

On a vérifié que ces tests échouent quand on désactive la RLS d'une table.

## Conséquences

- Toute nouvelle table d'église doit inclure sa politique dans la même migration, sinon le test de catalogue échoue. Elle reste de toute façon illisible sans politique, car `FORCE` sans politique ne laisse passer aucune ligne.
- Le seed et les opérations de plateforme qui écrivent dans une église doivent positionner `app.eglise_id` (même mécanisme que l'application).
- Lot 1 : un QR d'une autre église (RG-14) est invisible sous RLS. Pour afficher « Cette carte n'appartient pas à cette église » plutôt que « carte inconnue », il faudra une fonction `SECURITY DEFINER` qui renvoie seulement l'église d'un jeton, sans aucune donnée nominative.

## Barrière applicative (étape 4)

`src/lib/tenant.ts` est le seul point d'entrée vers les données d'une église.

- `verifierContexte(session)` part de la session, jamais de la requête. Il vérifie que l'utilisateur est membre actif de l'église active, que son compte est actif et que l'église n'est pas suspendue. Sinon, il lève `AccesRefuse` avec une raison : `non_authentifie`, `aucune_eglise`, `non_membre`, `compte_inactif` ou `eglise_suspendue`.
- `clientEglise(egliseId)` étend Prisma (`$extends`, `query.$allOperations`) :
  - il ajoute `egliseId` à chaque `where` et à chaque création ;
  - il refuse avec `RequeteHorsEglise` une requête qui nomme une autre église ou tente de déplacer une ligne vers une autre église ;
  - il refuse les tables de plateforme (`user`, `membre`, `eglise`…), cachées aussi du type TypeScript ;
  - il exécute chaque requête dans une transaction `[set_config('app.eglise_id'), requête]`.
- `db.$tx(fn)` ouvre une transaction interactive, positionne `app.eglise_id` en premier, puis y exécute toutes les opérations (via `AsyncLocalStorage`). `$transaction` n'est pas exposé.
- Les écritures utilisent les clés scalaires (`familleId`, non `famille: { connect }`) : le client ajoute `egliseId`, et Prisma interdit de mêler les deux formes.
- `attribuerMatricule(tx)` (RG-01) incrémente `Eglise.prochainMatricule` par `UPDATE … RETURNING`, sur `hk_eglise_active()` : le compteur ne peut être que celui de l'église active.
- `src/lib/session.ts` renvoie `null` jusqu'à l'étape 5 (Better Auth) : sans session, tout accès est refusé.

**Vérification de l'indépendance des deux barrières.** Barrière applicative désactivée, les tests qui attendent `RequeteHorsEglise` échouent, mais aucune lecture, modification ou suppression ne traverse vers l'église B : la RLS seule suffit à les bloquer. Inversement, sans RLS sur une table, les tests de catalogue et d'isolation SQL échouent.

## Jetons des cartes et des badges (décidé à l'étape 6, réalisé au lot 1)

- Les jetons QR (`HKF1.` + 22 caractères base62, environ 131 bits) sont tirés par `randomBytes` (`node:crypto`), jamais par `Math.random`.
- La base ne stocke que l'empreinte SHA-256 du jeton : `CarteFamille.tokenHash` et `Membre.badgeTokenHash`, uniques, à la place des colonnes en clair `token` et `badgeToken`. Au scan, on calcule l'empreinte du jeton lu et on cherche sur l'empreinte. Une fuite de la base ne permet donc pas de fabriquer une carte valide.
- Le jeton en clair n'existe qu'au moment de produire le PDF de la carte ou du badge. Conséquence assumée : une réimpression génère un nouveau jeton et révoque l'ancien.
- Réalisation au lot 1, avec la génération des cartes : migration qui remplace les colonnes, adaptation du seed, fonction `SECURITY DEFINER` de RG-14 appelée avec l'empreinte.
