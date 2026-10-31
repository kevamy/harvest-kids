# 0010 — Tâche quotidienne et suppression différée des fichiers

- Statut : accepté (lot 1, étape 3)
- Date : 2026-10-31

## Contexte

Plusieurs écritures sont périodiques : purge des familles en brouillon expirées, révocation des cartes après la date limite d'une réémission (RG-16), suppression des fichiers remplacés. Elles ne doivent jamais avoir lieu à l'affichage d'une page : Next précharge les pages, et un simple survol écrirait en base. Le code tourne à l'identique sur Vercel et sur le VPS, sans API propre à Vercel.

Un fichier remplacé (logo, photo) ne doit pas disparaître tout de suite : une tablette qui affiche encore l'ancienne page montrerait une image cassée.

## Décision

- **Une route protégée** `GET /api/taches/quotidiennes`. Elle exige `Authorization: Bearer <CRON_SECRET>`, comparé à temps constant, et refuse tout appel sans `CRON_SECRET`. Elle est appelée par Vercel Cron en recette (`vercel.json`, production seulement) et par une tâche planifiée sur le VPS (lot 5). Elle figure dans les chemins publics du proxy, puisque l'appelant n'a pas de session.
- **Église par église**, avec le client scopé de chaque église (`executerTachesQuotidiennes`, `src/server/plateforme/taches.ts`). Une église en échec n'arrête pas les autres ; seuls des compteurs sont renvoyés ou journalisés.
- **Idempotente** et **auditée** : auteur `userId` null, appareil « tache-quotidienne ».
- **Au scan, la date limite est une lecture** : une carte périmée est refusée sans écriture ; la révocation revient à la tâche.
- **Suppression différée** : table d'église `FichierASupprimer` (`cle`, `apresLe`), sous RLS. Un fichier remplacé y est inscrit dans la transaction du remplacement, avec `apresLe` = `now() + interval '24 hours'`, posé par PostgreSQL. Chaque nouveau fichier reçoit une nouvelle clé, donc aucun cache de navigateur ne sert l'ancien. La tâche ne supprime qu'une clé du préfixe de l'église.
- **Une seule horloge** (ajout du 2026-10-31, règle reprise dans CLAUDE.md) : toutes les échéances sont comparées en SQL au `now()` de PostgreSQL, que ce soit pour les fichiers dus, la date limite d'une réémission (au scan comme dans la tâche) ou l'âge des brouillons. Les dates comparées ainsi sont posées par la base (`emiseLe`, `createdAt` par `DEFAULT now()`, `apresLe` par `now() + interval`). Un décalage entre l'horloge du serveur Node et celle de PostgreSQL (conteneur Docker en local, Vercel et Neon en recette) ne peut donc plus avancer ni retarder une échéance. En test, le temps passe en reculant les dates stockées depuis leur propre valeur.

## Conséquences

- Un brouillon expiré, une carte périmée ou un fichier remplacé peuvent subsister jusqu'au passage suivant de la tâche, au plus un jour. Ce n'est pas un risque : au scan, la carte est déjà refusée.
- Sur les prévisualisations Vercel, la tâche ne passe pas d'elle-même. On la teste par un appel manuel (`docs/exploitation.md`).
- Sans `CRON_SECRET` dans un environnement, la tâche ne s'exécute pas. Les brouillons et les fichiers remplacés s'accumulent, sans effet sur la sécurité.
