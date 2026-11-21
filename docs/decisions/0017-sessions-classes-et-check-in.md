# 0017 — Sessions du jour, ouverture des classes et check-in

- Statut : accepté (lot 2, étapes 1 à 3)
- Date : 2026-11-21 (décisions prises du 2026-11-06 au 2026-11-14)

## Contexte

Le lot 2 fait passer un enfant de l'accueil à sa classe (cahier §7.2 et §7.3, RG-04, RG-05, RG-08, RG-12). Plusieurs tablettes travaillent en même temps sur la même session : deux moniteurs arrivent ensemble dans une classe, deux familles se présentent à deux postes d'accueil. Les heures des cultes sont celles de l'église, dans son fuseau, alors que le serveur tourne en UTC (Vercel, VPS). Les points ouverts de la section 17 (horaires, délais, lieu du retrait) doivent rester réglables par chaque église.

## Décision

- **Réglages par église** (étape 1) : les cultes sont une table d'église (nom, jour, heures de début et de fin dans l'heure locale, actif) ; on les désactive, on ne les supprime jamais. Les délais (`sessions.delaiAlerteNonRecupereMinutes`, `presences.delaiNonArriveEnSalleMinutes`), les lieux de rendez-vous (`appels.lieux`) et le lieu du retrait (`checkout.lieu`, ADMIN seul) sont des `Parametre`, avec des valeurs par défaut. Chaque changement est audité.
- **Sessions du jour créées à la demande** (`assurerSessionsDuJour`) : une seule requête SQL crée les sessions des cultes actifs du jour, avec le jour et les heures calculés par PostgreSQL dans le fuseau de l'église (`AT TIME ZONE e.fuseau`), stockées en UTC. L'unique (église, culte, date) et `ON CONFLICT DO NOTHING` permettent de l'appeler à chaque visite sans doublon, sans tâche planifiée.
- **Ouverture d'une classe** (RG-05) : une classe s'ouvre quand le minimum de moniteurs est atteint, sous verrou de la ligne de la classe (`FOR UPDATE`), pour que deux arrivées simultanées l'ouvrent une seule fois. Rejoindre une classe termine l'affectation précédente (départ et audit) au lieu de refuser ; un index partiel garantit une seule affectation active par membre. Un membre sans rôle moniteur entre comme renfort, ajouté par le responsable. L'ouverture forcée exige un motif et au moins un moniteur présent. Une classe ouverte passée sous le minimum reçoit une alerte rouge, sans bloquer les check-ins ; vidée de ses moniteurs, l'alerte maximale.
- **Clôture** d'une session seulement quand tous les enfants sont récupérés (la clôture justifiée vient au lot 4) ; les moniteurs encore en classe sortent.
- **Check-in** (étape 3) : le scan ou la recherche ne fait que lire. La validation se fait dans une transaction qui verrouille la ligne de la session : les check-ins d'une session sont sérialisés, donc deux familles n'obtiennent jamais le même code. Elle refuse une famille en brouillon, une classe non ouverte (RG-05) et un enfant encore présent dans une session ouverte (RG-08 ; la bascule vient au lot 4). Une carte en attente est activée à la validation, jamais au simple affichage du scan (ADR 0008). Chaque enfant écrit un `EvenementPresence` et une entrée d'audit.
- **Code de retrait** (RG-04) : 4 caractères d'un alphabet de 31 sans caractères ambigus (ni 0, O, 1, I, L), tirés par `randomInt` ; un code par famille et par session (le deuxième check-in d'une famille reprend son code), différent de ceux des autres familles de la session.

## Conséquences

- Aucune tâche planifiée n'est nécessaire pour créer les sessions : le même code tourne sur Vercel et sur le VPS.
- Les check-ins d'une même session attendent les uns les autres pendant la transaction (quelques millisecondes : 288 à 368 ms mesurés du scan à la confirmation, e2e sur le build de production) ; les sessions différentes ne se gênent pas.
- Le code de retrait ne suffit jamais pour reprendre un enfant : la vérification de l'adulte et la limite des codes erronés sont décrites dans l'ADR 0016.
