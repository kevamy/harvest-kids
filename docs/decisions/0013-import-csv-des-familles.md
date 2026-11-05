# 0013 — Import CSV des familles

- Statut : accepté (lot 1, étape 7)
- Date : 2026-11-05

## Contexte

Les églises reprennent des listes existantes (Harvest, tableurs) : cahier §7.1, point 6. Ces fichiers viennent d'Excel, de LibreOffice ou de Google Sheets, sous Windows ou non : encodages et séparateurs varient, les numéros sont souvent à l'ancien format béninois, les dates sont saisies à la main. L'import ne doit ni bloquer une liste entière pour une case mal remplie, ni enregistrer sans contrôle des données de mineurs.

## Décision

- **Familles importées en brouillon** : sans matricule, sans carte, sans photo ni consentement, dans la liste « À compléter ». Elles sont finalisées à l'accueil (matricules, photos, consentements, téléphones) et purgées après le délai de l'église si elles ne le sont pas (ADR 0010). Le check-in les refuse (lot 2).
- **Une ligne par enfant.** Les enfants qui ont le même nom de famille et le même téléphone du tuteur 1 forment une famille. Sans téléphone utilisable, la clé devient le nom de famille et le prénom et le nom du tuteur 1. Ces valeurs sont normalisées (casse, accents, espaces et ponctuation). Deux tuteurs au plus par famille, douze enfants au plus.
- **Lecture du fichier sans dépendance** (`src/lib/csv.ts`, RFC 4180) : séparateur `;` ou `,` détecté sur la ligne d'en-tête, hors guillemets ; UTF-8 avec ou sans BOM, décodé strictement, sinon Windows-1252. Le `TextDecoder("windows-1252")` de Node décode en réalité en Latin-1 (les octets 0x80 à 0x9F, dont `’`, `œ` et `€`, deviennent des caractères de contrôle invisibles) : la table de ces 32 octets est donc dans le code. Le modèle téléchargeable est en UTF-8 avec BOM et `;`, sans ligne d'exemple (elle serait importée par erreur).
- **Seules les lignes inutilisables sont rejetées** : pas de nom d'enfant, date de naissance absente ou invalide. Les dates sont acceptées en `JJ/MM/AAAA` (`5/3/2019` aussi) et en `AAAA-MM-JJ`. Une année sur deux chiffres, une date dans le futur ou un enfant de 18 ans ou plus sont refusés avec un message qui dit quoi corriger.
- **Téléphones** normalisés en E.164 comme dans le formulaire (ADR 0011). Un numéro béninois à 8 chiffres est proposé à la correction : une case par numéro et « Valider toutes les corrections ». Sans validation, le tuteur est importé sans ce numéro. Un numéro illisible n'est pas rejeté : la famille est importée sans lui, avec l'avertissement « numéro illisible, à corriger à la finalisation ». `Tuteur.telephone` devient donc facultatif (migration `tuteur_telephone_facultatif`) ; la finalisation l'exige pour le contact principal.
- **Doublons possibles** signalés, jamais importés d'office : même téléphone de tuteur, ou même nom de famille et mêmes prénoms d'enfants. La comparaison porte sur les familles de l'église active (brouillons compris) et sur les familles précédentes du même fichier. Un doublon possible n'est importé que si « Importer quand même » est coché.
- **Prévisualisation puis import, sans stockage du fichier** : la prévisualisation n'écrit rien. À l'import, le navigateur renvoie le même fichier avec les choix ; le serveur vérifie son empreinte SHA-256, l'analyse de nouveau, puis crée tous les brouillons dans une seule transaction (tout ou rien). Limites : 1 Mo et 2 000 lignes.
- **Droit `familles.importer`** : ADMIN et RESPONSABLE. L'accueil finalise les brouillons mais n'importe pas.
- **Audit** : une entrée `famille.brouillon_cree` par famille et une entrée `familles.importees` (empreinte du fichier, compteurs), sans nom ni numéro.

## Conséquences

- Le contact principal d'une famille inscrite ou finalisée a toujours un numéro valide (bouton Urgence, lot 3). Les autres tuteurs peuvent ne pas en avoir, mais tout numéro saisi est valide : la normalisation refuse un numéro illisible ou non confirmé. `enregistrerFamille` l'exige à l'inscription, à la finalisation et à la modification. On ne peut ni retirer le numéro du contact principal, ni désigner comme contact principal un tuteur sans numéro. Avant de valider la transaction, un contrôle relit les tuteurs de la famille en base : un seul contact principal, avec un numéro. Il couvre aussi un tuteur de brouillon absent de la demande. La base ne peut pas l'imposer : l'état « finalisée » est sur `Famille`. Tests d'intégration dans `familles.test.ts`.
- Un nom repris d'une autre colonne (nom de famille vide, ou nom de l'enfant vide) est surligné « À vérifier » dans la prévisualisation. Une colonne de nom entièrement absente est signalée une fois pour tout le fichier.
- Un enfant n'est compté en double dans une famille que s'il a le même prénom et la même date de naissance.
- Les doublons sont détectés en chargeant les familles de l'église (identifiant, nom, prénoms des enfants, téléphones), quelques centaines à quelques milliers de lignes. Si le volume l'exige, il faudra une requête ciblée par téléphone et par nom.
- Deux imports simultanés du même fichier pourraient créer des doublons : ils resteraient visibles dans « À compléter » et signalés au prochain import.
- Le format d'export de Harvest n'est pas connu : si ses en-têtes diffèrent, ajouter des synonymes d'en-têtes dans `COLONNES` (`src/server/import-familles/analyse.ts`).
