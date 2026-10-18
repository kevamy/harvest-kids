# 0002 — Statut « Attendu » calculé à l'affichage

- Statut : accepté
- Date : 2026-10-18

## Contexte

Le schéma des statuts (cahier §6) et `design/composant-StatusPill.md` montrent un statut `ATTENDU`, absent de l'enum `StatutPresence` du modèle de données (§11).

## Décision

Aucune `Presence` n'est créée avant le check-in. « Attendu » est calculé pour un enfant inscrit sans présence dans la session. L'enum de base reste `PRESENT`, `EN_SALLE`, `INFIRMERIE`, `RECUPERE`. Côté interface, `src/lib/statuts.ts` définit `StatutAffiche` = statuts de base + `ATTENDU` + `APPEL` (le drapeau `appelParent` affiché comme statut).

## Conséquences

- Pas de présences fantômes à nettoyer, et RG-08 (une seule présence non clôturée) reste simple.
- Une liste « attendus » se calcule par différence entre enfants inscrits et présences de la session.
