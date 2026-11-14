# 0015 — Arrivée en salle : droit par affectation, annulation d'une confirmation

- Statut : accepté (lot 2, étape 4)
- Date : 2026-11-14

## Contexte

Le moniteur confirme l'arrivée en salle de chaque enfant enregistré à l'accueil (cahier §7.4). Une classe peut tourner avec des renforts qui n'ont pas le rôle MONITEUR (un membre de l'accueil envoyé par le responsable), et le droit de confirmer doit suivre la présence réelle dans la salle, pas un rôle. Sur tablette, une erreur de toucher est probable : un enfant marqué « en salle » à tort est exactement le risque de l'incident d'origine (un enfant que l'on croit ailleurs).

## Décision

- **Le droit vient de l'affectation** : seuls les membres affectés à la classe pour la session (`AffectationMoniteur` sans départ) confirment une arrivée, quel que soit leur rôle. Un RESPONSABLE ou un ADMIN non affecté voit toutes les classes sans confirmer ; un MONITEUR ne voit que la classe où il est affecté. La règle est écrite une fois, dans `droitsSalle` (`src/lib/rbac.ts`), avec le droit `salle.superviser` (RESPONSABLE ; ADMIN par principe). L'ancien droit par rôle `enfant.confirmerEnSalle` est supprimé. Les actions passent par `executerActionVerifiee`, qui lit l'affectation dans l'église active avant d'appeler le service ; la page `/classe/[id]` et sa route en direct font la même vérification, et répondent 404 sinon.
- **Confirmation** par un toucher, ou par le scan d'une carte : une carte famille confirme les enfants de la famille attendus dans cette classe, une carte enfant cet enfant seul (RG-16). Le scan ne fait que lire la carte (`resoudreJeton`) : une carte en attente retrouve la famille sans être activée, l'activation reste au check-in et au check-out (ADR 0008).
- **Concurrence** : `UPDATE … SET statut = 'EN_SALLE' … WHERE statut = 'PRESENT' RETURNING`. Deux tablettes qui confirment le même enfant en même temps : la seconde attend le verrou de ligne, ne met plus rien à jour, et n'écrit ni événement ni audit ; elle affiche « déjà en salle ».
- **Annulation** (retour à `PRESENT`, `enSalleLe` effacée) : pendant 1 minute après la confirmation, son auteur l'annule sans motif ; après ce délai, ou pour la confirmation d'un autre membre, seul un RESPONSABLE la corrige, avec un motif obligatoire. L'auteur est celui du dernier événement `en_salle` de la présence ; la ligne de la présence est verrouillée (`FOR UPDATE`) pendant la vérification.
- **Une seule horloge** : `enSalleLe` est posée par PostgreSQL (`now()`), et le délai d'une minute comme celui de l'alerte « non arrivé en salle » (`checkinLe` plus le délai réglé de l'église) sont comparés en SQL. Les tests font passer le temps en reculant les dates stockées.
- **Traçabilité** : chaque confirmation et chaque annulation écrit un `EvenementPresence` (`en_salle`, `en_salle_annulee`, avec le mode, l'auteur de l'annulation et le motif) et une entrée d'audit (`presence.en_salle`, `presence.en_salle_annulee`), dans la même transaction.
- **Alerte « non arrivé en salle »** : la route `/api/direct/alertes` renvoie, en plus des alertes de classes, les enfants encore `PRESENT` après le délai, avec leur prénom, leur matricule et leur classe ; le bandeau de l'accueil les affiche.

## Conséquences

- Aucune migration : `Presence.enSalleLe` et l'index `(egliseId, sessionId, statut)` existaient déjà.
- Un membre affecté qui quitte la classe dans la minute perd la main sur son annulation ; le responsable corrige alors avec un motif.
- Un renfort sans rôle MONITEUR atteint la liste de sa classe depuis l'accueil (« Ouvrir la liste de ma classe ») : la page « Classes » reste réservée aux rôles qui la voyaient.
