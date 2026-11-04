# 0009 — Impression des cartes : PDF en mémoire, react-pdf, polices et planches

- Statut : accepté (lot 1, étape 4)
- Date : 2026-10-31

## Contexte

Chaque église imprime elle-même ses cartes, dans cinq formats (cahier §7.10). Le jeton en clair ne doit exister que dans le PDF (ADR 0008). L'application tourne à l'identique sur Vercel et dans l'image Docker du VPS, en build standalone. À l'étape 2, `sharp` y manquait de fichiers natifs sans qu'aucun test ne le voie.

## Décision

- **`@react-pdf/renderer`** produit les PDF côté serveur, en paquet externe (`serverExternalPackages`). Le QR code (`qrcode`, correction M) est dessiné en rectangles vectoriels, net à toute taille. Une zone de silence de 4 modules l'entoure, et le symbole mesure au moins 20 mm.
- **Polices** Fredoka (600) et Nunito (400, 700) en TTF statiques, avec leurs licences OFL, dans `src/server/impression/polices/`. Elles sont lues sur disque et incluses explicitement dans le build standalone (`outputFileTracingIncludes`), car le traçage ne voit pas un chemin construit à l'exécution.
- **Géométrie pure et partagée** (`planche.ts`) par le PDF et les aperçus HTML de Paramètres › Impression :
  - zone de sécurité de 3 mm ;
  - bandeau au logo de l'église ;
  - zone de perforation en portrait ;
  - pied au recto quand on imprime en recto seul.
- **Deux sorties** :
  - CR80 carte par carte, au format exact ;
  - planche A4 pour tous les formats, avec fond perdu de 3 mm, traits de coupe dans la marge de 8 mm et verso en miroir pour l'impression recto-verso bord long. Une planche contient 8 cartes en CR80 et en 90 × 54, 10 en 90 × 50, 4 en grand format.
- **Ordre de l'impression** : tirage des jetons, rendu du PDF en mémoire, puis une transaction qui émet les cartes avec ces jetons. Un rendu en échec ne crée aucune carte ; une transaction en échec n'envoie aucun PDF. Les PDF ne sont jamais stockés.
- **PDF d'essai** : famille fictive, mention « ESSAI », jeton enregistré nulle part, lecture seule.
- **Contrôles** :
  - les tests unitaires vérifient la taille de page de chaque PDF (`/MediaBox`, en points) ;
  - l'e2e télécharge les PDF sur le build de production ;
  - la CI rend un vrai PDF avec les polices dans l'image Docker (`scripts/verifier-pdf.mjs`).

## Conséquences

- La taille d'une page de carte est exacte, sans arrondi. Un contenu dépassant la page d'une fraction de point créerait une page de plus.
- react-pdf omet sans erreur une image illisible. Le logo étant converti en PNG par `sharp` au téléversement, ce cas ne se présente pas.
- react-pdf n'exporte certains sous-modules qu'en ESM. Next et Vitest le chargent ainsi ; un script `tsx` en CommonJS échoue. Pour un usage hors application, passer par Vitest ou par un module ESM.
