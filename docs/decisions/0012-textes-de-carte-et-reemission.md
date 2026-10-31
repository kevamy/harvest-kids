# 0012 — Textes de carte par église et réémission groupée

- Statut : accepté (lot 1, étape 5)
- Date : 2026-10-31

## Contexte

Chaque église règle le pied du recto (téléphone de l'accueil enfants et consigne courte) et les consignes du verso de ses cartes (cahier §7.1, §7.10). Le texte doit tenir dans les cinq formats, de la carte CR80 au grand format. Après un changement de mode (RG-16), de logo ou de format, l'église doit pouvoir réémettre toutes ses cartes sans invalider celles qui circulent.

## Décision

### Textes de carte

- Paramètre d'église `cartes.textes` (table `Parametre`, sous RLS), validé par Zod :
  - affichage du téléphone ;
  - consigne courte, 60 caractères au plus ;
  - titre du verso, 40 caractères au plus ;
  - une à trois consignes au verso, 90 caractères chacune au plus.

  Les valeurs par défaut sont dans le code (`src/server/impression/textes.ts`).

- Corps de texte et interligne (`TYPO`) partagés par le PDF, les aperçus et le contrôle de mise en page.
- **Contrôle de mise en page** (`mesure.ts`) : chaque texte est mesuré avec les métriques réelles des polices TTF embarquées, coupé mot par mot comme dans le PDF, puis sa hauteur est comparée à la zone de chaque format.
  - Un test unitaire passe le plus long texte autorisé (chaque champ à sa limite, téléphone affiché, nom d'église de 120 caractères) dans les cinq formats.
  - La contre-épreuve vérifie qu'un texte trop long est bien détecté.
  - L'action d'enregistrement refait ce contrôle avec le nom et le téléphone réels de l'église, et refuse en nommant le format.
- Les aperçus de Paramètres › Impression montrent le pied (recto seul) ou le verso (recto-verso) avec ces textes, à l'échelle et aux corps du PDF.

### Réémission groupée

- Route `POST /api/impression/reemission` (ADMIN, `eglise.parametrer`, en-tête `Origin` contrôlé). Elle crée une ligne `ReemissionCartes` (mode courant, date limite facultative, auteur) et, pour chaque famille finalisée qui a au moins un enfant actif avec matricule, les cartes du mode courant, reliées à cette réémission.
- Même ordre qu'une impression unitaire : tirage des jetons, rendu du PDF en mémoire (format et faces des réglages ; CR80 carte par carte, sinon planche A4, familles par ordre alphabétique), puis une seule transaction. Un rendu en échec ne crée ni réémission ni carte.
- Cycle de l'ADR 0008 inchangé :
  - une famille qui a une carte active reçoit une carte en attente, et l'ancienne reste valide jusqu'à la remise ou au premier scan ;
  - une famille sans carte active reçoit une carte active.
- Après un changement de mode, les cartes **en attente de l'autre type** sont révoquées (raison `mode_change`) : jamais remises, elles révoqueraient sinon les nouvelles cartes en s'activant.
- **Date limite** : l'administrateur saisit le dernier jour de validité des anciennes cartes, dans le fuseau de l'église (RG-12). Elle est enregistrée comme l'instant de minuit local qui suit ce jour, et acceptée de demain à un an.
  - Au scan, une ancienne carte remplacée par une carte de cette réémission est refusée après cette date, en lecture seule.
  - La tâche quotidienne la révoque ensuite, avec audit (ADR 0010).
- Audit `reemission.creee` : mode, format, date limite et nombres de familles et de cartes, sans donnée personnelle.
- `ClientEglise.$tx` accepte un `timeout` (45 s pour la réémission). La route déclare `maxDuration = 60`, la limite du plan Vercel.
- Fuseau : `src/lib/fuseau.ts`, fondé sur `date-fns` 4.4.0 et `@date-fns/tz` 1.5.0 (section 10 du cahier, versions épinglées). Ses tests couvrent un jour de changement d'heure et passent quel que soit le fuseau de la machine.

## Conséquences

- La transaction de réémission verrouille tour à tour chaque ligne `Famille` jusqu'à sa fin. Un check-in d'une de ces familles attend donc quelques secondes au plus. La réémission se fait en dehors des cultes.
- Sur Vercel, une très grande église (plusieurs milliers de cartes) pourrait dépasser 60 s. Il faudrait alors découper la réémission par lots de familles. Sur le VPS, la limite ne s'applique pas.
- Modifier les limites de longueur impose de relancer le test des cinq formats ; agrandir une limite peut demander de réduire un corps dans `TYPO`.
