# 0008 — Cartes : empreintes des jetons, cycle de vie et fonction RG-14

- Statut : accepté (lot 1, étape 1)
- Date : 2026-10-30

## Contexte

L'ADR 0002 prévoyait pour le lot 1 de ne stocker que l'empreinte des jetons et de distinguer, au scan, une carte d'une autre église (RG-14) d'une carte inconnue. Le cahier des charges 1.2 ajoute le mode de carte par église (RG-16), la réémission groupée et la réimpression. Une réimpression ne doit pas bloquer les cartes en circulation avant que les nouvelles soient remises aux familles.

## Décision

**Empreintes.** `CarteFamille.tokenHash` et `Membre.badgeTokenHash` contiennent le SHA-256 hexadécimal du jeton (`empreinteJeton()`, `src/lib/jetons.ts`). Le jeton en clair n'existe que dans le PDF imprimé. Les cartes portent le préfixe `HKF1.`, les badges `HKB1.`. La migration a converti les jetons existants en SQL (`encode(sha256(convert_to(token, 'UTF8')), 'hex')`, même valeur que Node), église par église : la RLS forcée s'applique aussi au rôle qui migre, donc chaque `UPDATE` positionne `app.eglise_id`.

**Cycle de vie : en attente, active, révoquée** (`src/server/cartes/cycle.ts`).

- `activeLe` null = en attente. Quatre index partiels uniques garantissent au plus une carte active et une carte en attente par couverture : la famille pour une carte famille (`enfantId` null), l'enfant pour une carte enfant.
- Émission : la carte est active tout de suite si aucune carte active ne couvre ses enfants (première carte). Sinon, elle est en attente et l'ancienne reste valide. Une carte en attente plus ancienne de la même couverture, jamais remise, est révoquée.
- Activation : par « Remettre la carte » (`activerCarte`) ou au premier scan de check-in ou de check-out (`activerAuPremierScan`, lot 2). Dans la même transaction, la carte devient active et toutes les cartes actives couvrant les mêmes enfants sont révoquées, d'un type comme de l'autre. L'audit est écrit dans cette transaction.
- « Carte perdue » (`declarerCartePerdue`) : la nouvelle carte est active tout de suite, l'ancienne est révoquée.
- Invariant : au plus une carte active couvre un enfant. Au sein d'un même type, ce sont les index qui le garantissent ; entre les deux types, c'est le verrou de la ligne `Famille` (`SELECT … FOR UPDATE`) pendant toute l'opération. Un test d'intégration le vérifie après chaque opération et sous deux activations concurrentes.
- Une carte enfant désigne forcément un enfant de sa famille : clé étrangère composite `(enfantId, familleId, egliseId)`.

**Résolution en lecture seule** (`src/server/cartes/resolution.ts`). `resoudreJeton` renvoie l'un de ces états : active, en attente, révoquée ou périmée (RG-03), autre église (RG-14), inconnue. Elle n'écrit jamais : le scan de vérification n'active pas une carte en attente, et une carte périmée (date limite d'une réémission dépassée) est refusée sans écriture. La révocation correspondante, avec audit, revient à la tâche quotidienne (étape 3).

**Fonction RG-14** `hk_jeton_autre_eglise(p_empreinte text) RETURNS boolean`.

- `SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`.
- Renvoie seulement un booléen : l'empreinte existe-t-elle, sur une carte (quel que soit son état) ou un badge, dans une autre église que l'église active ? Jamais d'identifiant, de nom ni d'église.
- Faux sans église active ou si la valeur n'a pas la forme d'un SHA-256 hexadécimal en minuscules.
- `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO hk_app`.
- `FORCE ROW LEVEL SECURITY` s'applique aussi au propriétaire. La politique `rg14_lecture_proprietaire` (`FOR SELECT TO <rôle qui migre>`, `USING (true)`) lui ouvre la lecture des cartes. Elle ne donne rien de plus au propriétaire, qui peut déjà désactiver la RLS. `hk_app` n'est ni propriétaire ni membre de ce rôle. On ne crée pas de rôle dédié, car `hk_owner` n'a pas `CREATEROLE` sur le VPS.

Cette fonction remplace celle qu'annonçait l'ADR 0002 (« renvoyer l'église d'un jeton ») : un booléen suffit au message RG-14 et ne révèle rien d'autre.

## Conséquences

- Une fuite de la base ne permet pas de fabriquer une carte. Réimprimer, c'est toujours émettre une nouvelle carte.
- Les tests de `tests/integration/rg14-fonction.test.ts` figent le catalogue (`pg_proc`, ACL) et le comportement. On a vérifié qu'ils échouent dans trois cas : `search_path` non fixé (la table piégée de `pg_temp` est lue), `EXECUTE` accordé à `PUBLIC`, politique propriétaire supprimée.
- Familles en brouillon (`Famille.finaliseeLe` null, `Enfant.matricule` null) : aucune carte ne peut leur être émise.
