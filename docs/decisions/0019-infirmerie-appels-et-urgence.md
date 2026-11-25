# 0019 — Infirmerie, appel parent, Urgence et incidents

- Statut : accepté (lot 3, étapes 1 à 4 et 6)
- Date : 2026-11-25 (décisions de l'utilisateur du 2026-11-24)

## Contexte

L'incident d'origine (cahier §1) : une mère ne trouvait pas son enfant, qui était à l'infirmerie sans que l'accueil le sache. Le lot 3 doit rendre le statut Infirmerie visible partout, y compris au check-out, faire appeler un parent à l'écran, joindre la famille en urgence et garder une trace de chaque appel et de chaque incident.

## Décision

- **Fiche de présence** (`/presences/[id]`, en direct) : point d'entrée de l'infirmerie, de l'appel parent, de l'Urgence et de la déclaration d'incident. Droits calculés par `droitsPresence` : l'accueil, l'infirmerie, le responsable et l'admin atteignent tout enfant de l'église ; un membre affecté à la classe, les enfants de sa classe seulement (404 sinon).
- **Infirmerie** : PRESENT ou en salle → INFIRMERIE « en route » (`infirmerieLe` posé par la base, accompagnant parmi les membres actifs, motif court) ; reçu par l'infirmerie (`infirmerieRecueLe`) ; renvoyé en classe → **PRESENT**, à confirmer par un membre de la classe, jamais « en salle » sans qu'on l'ait vu, avec l'alerte « pas encore en salle » comptée depuis le retour (`retourInfirmerieLe`). Une contrainte CHECK lie `infirmerieLe` au statut. Chaque passage verrouille la présence et écrit un événement et un audit.
- **Alerte « pas arrivé à l'infirmerie »** : au-delà de `infirmerie.delaiReceptionMinutes` (5 min par défaut, réglable), comparée en SQL avec `now()`, en rouge sur la page Infirmerie et aux tableaux de l'accueil et du responsable, jusqu'à la réception ou au retour.
- **Visible partout** : bandeau commun en tête de la fiche, de la liste de classe et du check-out ; région « Enfants à l'infirmerie » aux tableaux ; tuile Infirmerie sur l'écran d'appel dès l'envoi. Tableaux, infirmerie et écran se rafraîchissent toutes les 3 s.
- **Check-out** : à l'accueil, l'agent accompagne le parent et remet l'enfant comme d'habitude (aucun nouveau droit) ; **à la porte de la classe, refusé** pour un enfant à l'infirmerie (sans case à cocher, revérifié sous le verrou de la session).
- **Appel parent** : motif dans une liste fermée, lieu parmi `appels.lieux` (« Infirmerie » proposé pour un enfant à l'infirmerie) ; un seul appel ouvert par présence (index partiel, verrou de la présence) ; terminé « parent arrivé », « annulé », ou « récupéré » dans la transaction du check-out. La résolution se pose une fois (droits par colonne et déclencheur). Le drapeau `Presence.appelParent`, jamais utilisé, est remplacé par l'appel ouvert.
- **Urgence** : tuteurs (contact principal d'abord) et personnes autorisées ; un toucher ouvre `tel:`, un autre `wa.me`. L'appel part **tout de suite** et se journalise en parallèle (`AppelTelephonique` : qui, quand, numéro, canal) : une urgence n'attend jamais le réseau, et un journal en échec s'affiche (« Appel non journalisé »). Seul un numéro de la famille peut être journalisé. Le journal est en ajout seul ; son résultat (joint, pas de réponse, messagerie) se note une fois. L'audit ne contient pas le numéro.
- **Incidents** : déclarés depuis la fiche, rattachés à l'enfant et à la session ; contenu figé une fois déclaré (droits par colonne) ; compléments dans `IncidentNote`, en ajout seul ; clôture posée une fois par le responsable (déclencheur).

## Conséquences

- Le scénario d'origine est couvert par un test de bout en bout : un enfant envoyé à l'infirmerie est signalé au check-out et sur l'écran d'appel en moins de 5 secondes.
- Les journaux (appels téléphoniques, notes, résolution des appels, clôture des incidents) résistent aussi à une requête de l'application qui tenterait de les réécrire : la base refuse.
- Écart au cahier, à y reporter : §6 (flèche INFIRMERIE → PRESENT, confirmée par la classe).
