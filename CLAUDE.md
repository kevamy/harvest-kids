# Harvest Kids — instructions pour Claude Code

Application web (tablette) d'accueil, de suivi et de retrait sécurisé des enfants de l'église. Le besoin complet est dans `docs/CAHIER_DES_CHARGES.md` : **lis-le entièrement avant toute tâche** et réfère-toi aux règles de gestion par leur code (RG-01 à RG-15).

## Méthode de travail

- Travaille **lot par lot** (section 15 du cahier des charges). Au début d'un lot, propose un plan court (fichiers, migrations, tests) et attends la validation avant de coder.
- Toute modification du schéma Prisma est présentée et expliquée avant de générer la migration. Jamais de `prisma db push` sur un environnement partagé : uniquement `prisma migrate`.
- N'ajoute pas de dépendance absente de la section 10 sans expliquer pourquoi et sans accord.
- Termine chaque tâche par : `pnpm lint`, `pnpm typecheck`, `pnpm test` (et `pnpm test:e2e` quand un parcours est touché). Ne déclare pas une tâche finie si l'une de ces commandes échoue.
- Tiens `docs/decisions/` à jour : un court fichier ADR par choix technique non trivial.
- Si une exigence du cahier des charges est ambiguë, pose la question au lieu de supposer.
- Modifie les fichiers uniquement avec l'outil d'édition de fichiers, jamais par des scripts shell (`sed`, `python`, `node -e`, here-documents) : ils altèrent les antislashs, les guillemets et les accents (au lot 1, l'expression régulière du matricule a été cassée ainsi).
- Si un test dépasse anormalement sa durée, relève l'état de la base avant de relancer quoi que ce soit (`pg_stat_activity` : transactions ouvertes, requêtes en attente de verrou, `pg_locks` non accordés), pour pouvoir en identifier la cause.
- Ne lance jamais deux suites de tests ou deux builds en même temps (même base, même port, poste à 16 Go).

## Stack imposée

Next.js (dernière version stable, App Router, `output: "standalone"`), TypeScript strict, Tailwind CSS v4, shadcn/ui, lucide-react, React Hook Form + Zod, Prisma + PostgreSQL 16, Better Auth, TanStack Query, `qrcode`, `@zxing/browser`, `@react-pdf/renderer`, `sharp`, date-fns + `@date-fns/tz`, Serwist, Vitest, Playwright, pnpm.

Le code doit tourner **sans modification** sur Vercel (test) et dans Docker sur un VPS Hostinger (production) : pas d'API propre à Vercel en dehors du pilote de stockage `vercel-blob`, pas de WebSocket, pas d'écriture sur le disque hors du pilote de stockage `local`.

## Multi-églises (multi-tenant) — règles non négociables

L'application sert plusieurs églises depuis une seule installation (section 3 bis du cahier des charges).

- Toute table métier porte `egliseId`. Toute nouvelle table métier aussi, avec sa politique Row-Level Security dans la même migration.
- On accède aux données d'une église **uniquement** via `getTenantDb()` (`src/lib/tenant.ts`), qui lit l'église active de la session, vérifie l'appartenance et positionne `app.eglise_id`. Importer le client Prisma brut est interdit (règle ESLint `no-restricted-imports`), sauf dans : `src/server/plateforme/`, `src/lib/tenant.ts`, `src/lib/auth.ts` (adaptateur Better Auth, tables hors RLS uniquement), `prisma/seed.ts` et `tests/`.
- Les tables de plateforme (hors RLS) sont `Eglise`, `User`, `Membre`, `AccesSupport`, `AuditPlateforme` et les tables `Auth*` de Better Auth. Toutes les autres sont des tables d'église, sous RLS.
- Jamais d'`egliseId` lu depuis le corps d'une requête, un paramètre d'URL ou un champ caché pour décider de l'accès : il vient de la session.
- Les uniques métier sont composés avec l'église (`@@unique([egliseId, matricule])`, etc.) ; les compteurs (matricules) sont par église.
- Les fichiers sont rangés sous `eglises/{egliseId}/` et servis après contrôle de l'église active.
- Chaque fonctionnalité livrée s'accompagne d'un test d'isolation (église A contre église B).
- Logo : la carte famille, les badges et l'écran d'appel portent le **logo de l'église**, jamais celui de Harvest Kids.

## Règles de code

- La logique métier vit dans `src/server/` (fonctions pures ou services testés) ; les Server Actions valident avec Zod, vérifient le rôle via `lib/rbac.ts`, appellent le service et écrivent l'audit (`lib/audit.ts`). Aucune vérification de droit uniquement côté client.
- Un layout ne protège jamais une page : chaque page, Server Action et route handler vérifie lui-même la session, l'église et le rôle (via rbac/tenant), même si son layout le fait déjà.
- Tout formulaire qui contient un secret (mot de passe, PIN) déclare `method="post"` et garde son bouton d'envoi désactivé tant que la page n'est pas prête (`usePret()`).
- Chaque changement de statut d'une présence crée un `EvenementPresence` et une entrée `AuditLog`, dans la même transaction.
- Le QR code ne contient jamais de matricule ni de nom (RG-02).
- Les photos ne sont jamais servies en URL publique : route `/api/photos/[key]` authentifiée (RG-11).
- Fuseau horaire de l'église active (par défaut `Africa/Porto-Novo`, RG-12) ; stocker en UTC, afficher en heure locale de l'église.
- Une seule horloge par comparaison de dates. Ce qui compare une date stockée à « maintenant » (échéances, dates limites, purges, tâche quotidienne) le fait en SQL avec `now()` de PostgreSQL. Une date destinée à une telle comparaison est posée par la base (`DEFAULT now()`, `now() + interval …`), jamais par `new Date()` côté Node. Une date que le serveur pose et compare lui-même (activité de session, blocage du PIN, limitation) reste côté serveur. En test, on fait passer le temps en reculant les dates stockées depuis leur propre valeur, jamais en passant une date simulée.
- Les écrans en direct utilisent `useLiveQuery` (TanStack Query, intervalle 3 à 5 s), jamais un `setInterval` maison.
- Une action non enregistrée côté serveur ne doit jamais afficher de succès : gérer les erreurs réseau avec un message explicite.
- Noms de domaine en français dans le code métier (`Famille`, `Enfant`, `Presence`, `codeRetrait`) ; code technique en anglais courant.

## Design

Le design system Harvest Kids fait foi (`design/charte.md`, `design/tokens.css`, `design/composant-*.md`).

- Importer `design/tokens.css` dans `src/app/globals.css` juste après `@import "tailwindcss";`. Utiliser les classes générées (`bg-nuit`, `text-rose-fonce`, `rounded-lg`, `font-display`, `text-matricule`, `min-h-touch`…), **jamais de couleur en dur**.
- Polices : Fredoka (titres, chiffres, matricules) et Nunito (texte) via `next/font/google`, variables `--font-fredoka` et `--font-nunito`.
- Composants maison dans `src/components/hk/` : `NotchCard`, `StatusPill`, `ChildCard`, `CallBoard`, `Scanner`, `MatriculeBadge`. Restyler les composants shadcn avec les tokens (boutons en pilule, cibles de 56 px minimum, rayons `radius-lg` pour les cartes).
- Statuts : une couleur par statut, toujours accompagnée du libellé (voir `design/composant-StatusPill.md`). Le rose plein (`rose-fonce`) est réservé à l'action de check-out.
- Logos Harvest Kids dans `design/logo/` : copier dans `public/`, générer les icônes PWA à partir de `harvest-kids-icone.svg`. Ils servent à l'écran de connexion, à l'icône de l'application et au pied de page ; partout ailleurs, c'est le logo de l'église active qui s'affiche.
- Textes : français, casse de phrase, vouvoiement, boutons qui disent l'action (« Enregistrer l'arrivée », « Confirmer le retrait »), messages de confirmation qui reprennent le même verbe, messages d'erreur qui disent quoi faire.

## Commandes attendues (à créer au lot 0)

```
pnpm dev              # serveur de développement
pnpm db:up            # PostgreSQL local (docker-compose.dev.yml)
pnpm db:migrate       # prisma migrate dev
pnpm db:seed          # données de démonstration
pnpm lint | typecheck | test | test:e2e
pnpm build            # build standalone
```

## Sécurité des données

Ce sont des données de mineurs. Jamais de vraies données dans le dépôt, les seeds, les captures ou l'environnement Vercel. Pas de journalisation de données personnelles (noms, téléphones, alertes médicales) dans les logs applicatifs ou Sentry.
