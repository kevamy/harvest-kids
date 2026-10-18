# 0003 — Intégration du design system et périmètre du service worker

- Statut : accepté
- Date : 2026-10-18

## Contexte

`design/tokens.css` fournit le bloc `@theme` Tailwind v4. `design/composants-reference.css` et `charte.md` utilisent des variables (`--nuit`, `--space-*`, `--touch-min`, `--font-text`) que `tokens.css` ne définit pas. Le CLI shadcn tente en outre de réécrire `tokens.css` avec sa propre palette.

L'application tourne sur des tablettes partagées et manipule des données de mineurs. Le cahier exige de ne jamais faire croire qu'une action a réussi hors connexion.

## Décision

- `design/` reste la source et n'est jamais modifié par l'outillage. `globals.css` importe `tokens.css` juste après Tailwind. `components.json` pointe vers `src/app/globals.css`.
- Les couleurs sémantiques de shadcn (`primary`, `border`, `ring`…) sont mappées sur les tokens dans `globals.css` : aucun composant ne porte sa propre palette.
- `composants-reference.css` n'est pas importé : il est traduit en composants React (`src/components/hk/`, `src/components/ui/button.tsx`) avec les classes générées par les tokens.
- La fusion de classes (`cn`, paquet du mainteneur de shadcn) est configurée avec l'échelle typographique Harvest Kids, sinon `text-matricule` serait confondu avec une couleur.
- Les rares couleurs nécessaires hors CSS (manifeste, `theme-color`, icônes) vivent dans `src/lib/couleurs.ts`. Un test vérifie qu'elles correspondent à `tokens.css`.
- **Service worker (Serwist, `@serwist/turbopack`) limité à la coque** : précache des ressources statiques et cache des logos et icônes publics. Les pages sont toujours en `NetworkOnly`, avec un repli vers `/hors-connexion`. Les réponses d'API ne sont jamais interceptées : aucune donnée nominative n'est mise en cache sur une tablette partagée. La file d'attente hors connexion du lot 5 sera une décision séparée.
- Icônes PWA générées par `scripts/generer-icones.mjs` (sharp) à partir de `harvest-kids-icone.svg`, puis commitées.

## Conséquences

- Hors connexion, l'utilisateur voit une page explicite au lieu d'un écran périmé.
- Les captures de référence ne sont pas comparées au pixel (polices rendues différemment entre Windows et Linux) : elles sont jointes au rapport Playwright, et les e2e vérifient la mise en page (débordement, cibles de 56 px, polices, couleurs).
