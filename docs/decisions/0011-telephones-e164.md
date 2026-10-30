# 0011 — Numéros de téléphone au format E.164

- Statut : accepté (lot 1, étape 3)
- Date : 2026-10-31

## Contexte

Les numéros des tuteurs, des personnes autorisées et de l'accueil de l'église sont saisis de mille façons (espaces, tirets, points, `00229`, `+229`). Ils servent à la recherche, aux appels d'urgence (`tel:`, WhatsApp, lot 3) et aux cartes. Au Bénin, depuis fin 2024, les numéros ont 10 chiffres (`01` suivi de l'ancien numéro à 8 chiffres). Des numéros à l'ancien format circulent encore.

## Décision

- **Stockage au format E.164**, « + » puis les chiffres (`+2290197451233`), normalisé par le serveur à chaque enregistrement (`src/lib/telephone.ts`). L'affichage est formaté par paires (`+229 01 97 45 12 33`).
- **Indicatif par défaut de l'église** (paramètre `telephone.indicatifParDefaut`, +229 par défaut, Paramètres › Église), appliqué à un numéro saisi sans indicatif.
- **Règles par pays** dans une table (`REGLES_TELEPHONE`) : longueur nationale, préfixe interurbain à retirer, ancien plan de numérotation. Un pays de plus, c'est une ligne de plus. Un indicatif inconnu est accepté s'il respecte E.164 (8 à 15 chiffres).
- **Ancien format béninois** : un numéro à 8 chiffres n'est jamais enregistré tel quel. Le formulaire propose « Voulez-vous dire 01 … ? » avec un bouton de confirmation, et le serveur refuse le numéro tant qu'il n'est pas corrigé.
- **Recherche** : la saisie est normalisée de la même façon. Un numéro partiel est trouvé sur la fin des numéros enregistrés (`telephone LIKE '%' || chiffres`), par une requête SQL sous RLS via le client scopé. Les index `(egliseId, telephone)` de `Tuteur` et `PersonneAutorisee` limitent la recherche aux numéros de l'église active.

## Conséquences

- **Limite assumée** : sous Row-Level Security, PostgreSQL n'utilise un index que pour des conditions entièrement `leakproof`. Ni `LIKE` ni `reverse()` ne le sont, et seul un superutilisateur pourrait les déclarer `LEAKPROOF`, ce qui est impossible sur Neon. La fin du numéro est donc filtrée ligne par ligne, parmi les numéros d'une seule église (quelques centaines à quelques milliers), ce qui suffit. Si le volume l'exige un jour, il faudra ajouter une colonne inversée indexée, remplie par le service.

- Les liens `tel:` et WhatsApp (lot 3) utilisent directement le numéro enregistré.
- L'import CSV (étape 7) applique la même normalisation et signale les numéros à confirmer.
- Les comptes utilisateurs (connexion par téléphone, lot 0) ont leur propre normalisation (`src/lib/identifiant.ts`). Elle est à rapprocher de celle-ci si l'on étend la connexion à d'autres pays.
