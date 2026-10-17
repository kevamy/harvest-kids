# 0001 — Stack et versions du lot 0

- Statut : accepté
- Date : 2026-10-18

## Contexte

La stack est imposée par le cahier des charges (section 10) et `CLAUDE.md`. Certaines versions « latest » publiées sur npm au 18/10/2026 ne sont pas utilisables telles quelles.

## Décision

Versions exactes figées dans `package.json` (pas de `^`), installées avec pnpm 12 et Node 22.

| Paquet                               | Version | Remarque                                                                                              |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------- |
| next                                 | 16.4.2  | App Router, `output: "standalone"`                                                                    |
| react / react-dom                    | 19.3.1  |                                                                                                       |
| typescript                           | 6.0.3   | TypeScript 7 n'est pas encore supporté par typescript-eslint (`<6.1`)                                 |
| eslint                               | 9.39.5  | ESLint 10 n'est pas encore supporté par les plugins de `eslint-config-next` (import, jsx-a11y, react) |
| tailwindcss + @tailwindcss/turbopack | 4.3.3   | Intégration Turbopack fournie par le modèle Next 16.4, à la place de `@tailwindcss/postcss`           |
| prisma / @prisma/client              | 7.10.1  | `prisma@latest` pointe vers une 8.0.0-rc ; Better Auth exige `^7`                                     |
| vitest                               | 5.0.5   | projets `unit` et `integration`                                                                       |
| @playwright/test                     | 1.64.1  | viewports tablette 1280×800 et 800×1280                                                               |

**Cache Components désactivé.** Le modèle Next 16.4 active `cacheComponents` par défaut. Presque tous les écrans lisent la session et l'église active ; un cache serveur (`use cache`) mal clé pourrait renvoyer les données d'une église à une autre (RG-13). On reste sur le rendu dynamique ; le direct passe par TanStack Query (`useLiveQuery`).

**Démarrage standalone.** `pnpm start` lance `scripts/start-standalone.mjs`, qui reproduit ce que fait l'image Docker (copie de `.next/static` et `public/`, puis `server.js`). Les e2e de la CI tournent donc sur le même artefact que la production.

## Conséquences

- Remonter TypeScript et ESLint dès que typescript-eslint et `eslint-config-next` les supportent.
- Toute page authentifiée est rendue à la demande : pas d'optimisation de cache à attendre côté serveur.
