# Harvest Kids

Harvest Kids est l'application d'accueil des enfants de l'église : enregistrement à l'arrivée, suivi en classe, appel des parents et retrait sécurisé. Elle tourne d'abord sur les tablettes des moniteurs, puis sur une borne. Le design reprend les couleurs d'une baby shower, bleu et rose, posées sur un sol crème et tenues par un bleu nuit profond.

## Ce que l'interface doit faire ressentir

Aux parents : « mon enfant est entre de bonnes mains ». Aux moniteurs : « je sais quoi faire, même avec un enfant dans les bras ». D'où trois principes :

1. **Doux dans la forme, ferme dans le fond.** Grands arrondis, couleurs tendres, mais chaque statut, chaque alerte est sans ambiguïté et toujours écrit en toutes lettres.
2. **Un geste, une action.** Cibles tactiles de `touch-min` (56 px) au moins, une seule action principale par écran, le scan comme point d'entrée.
3. **Le matricule est le repère commun.** `HK-0427` se lit de loin, se dit à voix haute, s'affiche sur l'écran d'appel. Il est toujours en style `matricule`.

## Couleurs

Le sol est `creme`, les cartes sont `blanc` ou colorées. `nuit` est à la fois l'encre et la grande surface sombre (en-têtes, écran d'appel, carte de chiffres), comme l'indigo du modèle de référence.

- **Bleu** : `bleu` pour l'action principale (arriver, scanner, enregistrer), `bleu-layette` pour les grandes surfaces, `bleu-voile` pour les fonds d'information.
- **Rose** : `rose` pour les grandes surfaces, `rose-fonce` pour l'action de sortie (check-out) et le mot kids sur fond clair, `rose-voile` pour les encadrés doux.
- **Soleil** : accent rare, réservé à l'appel d'un parent et aux chiffres-clés.
- **`alerte` et `succes`** : uniquement pour les statuts Infirmerie et Récupéré, les erreurs et les confirmations.

Règles de contraste : texte `nuit` sur `rose`, `bleu-layette`, `soleil` ; texte `blanc` sur `bleu`, `rose-fonce`, `nuit`, `alerte`, `succes`. Jamais de texte blanc sur `rose` ou `bleu-layette`. Le bleu et le rose ne codent jamais le sexe d'un enfant : ils alternent.

## Typographie

- **Fredoka** (famille `display`) pour les titres, les chiffres et les matricules : ronde, enfantine sans être puérile, et c'est la police du mot kids dans le logo.
- **Nunito** (famille `text`) pour tout le reste, en 18 px (`body-lg`) par défaut sur tablette.
- Casse de phrase partout, pas de majuscules pour les libellés.

## Formes

- **Carte à encoche** (`NotchCard`) : la forme signature, reprise du modèle. Coin supérieur droit découpé de la couleur du sol, raccords en `radius-md`. À utiliser pour les blocs importants (classes, chiffres, alertes), pas pour chaque élément de liste.
- Cartes en `radius-lg`, photos en `radius-md`, boutons et pastilles en `radius-pill`.
- Une seule ombre, `shadow-card`, uniquement pour les cartes blanches sur `creme`. Pas de bordure autour des cartes.

## Logo

Le logo reprend celui de Harvest (le logiciel de gestion de l'église) : même mot, même police, les deux feuilles qui forment le v passent en bleu (gauche) et rose (droite), et kids est ajouté dessous, en Fredoka rose. Voir le groupe Logos.

## Ton des textes

Phrases courtes, verbes d'action, vouvoiement des parents, tutoiement interdit. Un bouton dit ce qu'il fait (« Confirmer le retrait »), le message qui suit reprend le même verbe (« Retrait confirmé »). Un message d'erreur dit ce qui bloque et quoi faire : « Cette personne n'est pas autorisée à récupérer Ayo. Appelez le parent principal. »

## Pour les développeurs

Les tokens sont exposés en variables CSS (`--nuit`, `--space-6`, `--radius-lg`, `--font-display`…) et les composants en classes `hk-*` (voir `components/bundle.css`). Dans l'application Next.js, ces mêmes valeurs alimentent le bloc `@theme` de Tailwind v4.
