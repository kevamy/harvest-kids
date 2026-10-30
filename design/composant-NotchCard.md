# NotchCard
Carte aux grands arrondis (`radius-lg`) dont le coin supérieur droit est découpé par une encoche de la couleur du sol : c'est la forme qui fait reconnaître Harvest Kids.

- Classes : `hk-notch` + une couleur (`--nuit`, `--rose`, `--bleu`, `--soleil`, `--blanc`).
- L'encoche mesure `notch-w` × `notch-h` avec des raccords arrondis `radius-md`. Elle prend la couleur de la variable CSS `--ground` (par défaut `creme`) : si la carte est posée sur un autre fond, redéfinir `--ground` sur la carte.
- `hk-notch__corner` place une icône ou un badge dans l'encoche.
- Une carte = un sujet (une classe, un chiffre, une alerte). Les cartes colorées (`rose`, `bleu`, `nuit`) servent aux classes et aux chiffres ; `blanc` aux formulaires et alertes. Pas plus de deux couleurs vives côte à côte.
