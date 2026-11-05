# 0014 — Comptes et liens d'activation

- Statut : accepté (lot 1, étape 8)
- Date : 2026-11-06

## Contexte

Avant un pilote, chaque église doit gérer elle-même ses comptes : ajouter un moniteur, changer des rôles, désactiver un compte, réinitialiser un mot de passe oublié (cahier §7.10). L'application n'envoie pas d'e-mail : l'administrateur transmet lui-même les accès, par WhatsApp ou SMS. Un compte peut appartenir à plusieurs églises, et l'administrateur d'une église ne doit pas pouvoir prendre la main sur l'administrateur d'une autre.

## Décision

- **Lien à usage unique** pour activer un compte (7 jours) et pour réinitialiser un mot de passe (24 heures). La table de plateforme `JetonCompte` (hors RLS : la page d'activation est publique) ne garde que l'empreinte SHA-256 du jeton (`HKC1.` et 43 caractères base62, environ 256 bits). L'échéance est posée et comparée par PostgreSQL (`now() + interval`, `expireLe > now()`). Émettre un lien révoque les liens encore ouverts du compte ; consommer un lien enregistre le mot de passe, révoque les autres liens et ferme les sessions, dans une seule transaction.
- **Le jeton est dans le fragment** : `https://…/activation#HKC1.…`. Le navigateur n'envoie jamais le fragment au serveur : le jeton ne figure ni dans les journaux du serveur ni dans ceux de l'hébergeur. La page le lit, l'efface aussitôt de la barre d'adresse et de l'historique, et l'envoie seulement dans le POST du formulaire. La page `/activation` est publique, `noindex` (balise et en-tête `X-Robots-Tag`), avec `Referrer-Policy: no-referrer`, sans script tiers ; les tentatives sont limitées par adresse IP.
- **Un nouveau compte n'a pas de mot de passe** : pas de compte « credential » Better Auth tant que le lien n'a pas servi, donc aucune connexion possible avant. Le premier ADMIN d'une nouvelle église (console `/plateforme`) passe aussi par un lien : le super-administrateur ne choisit plus de mot de passe provisoire.
- **Rattachement direct** d'un compte existant (même e-mail ou même téléphone) avec les rôles choisis, audité, avec une réponse neutre (« Compte rattaché ») qui ne révèle pas ses autres églises.
- **Comptes de plusieurs églises** : l'ADMIN d'une église ne génère pour eux ni lien d'activation ni réinitialisation (il verrait le lien et pourrait s'en servir) ; ils restent au super-administrateur. Même règle pour un compte super-administrateur.
- **Réinitialisation à effet immédiat**, après une confirmation explicite (modale) : mot de passe effacé, sessions fermées, audit avec le nombre de sessions fermées.
- **Désactivation au niveau de l'appartenance** (`Membre.actif`) : l'accès à l'église est refusé dès la requête suivante (`getTenantDb`), le badge moniteur est révoqué, un lien encore ouvert de cette église ne sert plus. `User.actif` reste une action du super-administrateur.
- **Garde-fous** dans `modifierMembre` : un ADMIN ne désactive pas sa propre appartenance ; l'église garde au moins un ADMIN actif. Les ADMIN actifs de l'église sont verrouillés (`SELECT … FOR UPDATE`, toujours dans le même ordre, avant toute autre ligne) dans la transaction de la modification : deux ADMIN qui se retirent mutuellement en même temps sont sérialisés, et le second est refusé.
- **Audit** dans le journal de l'église : création, rattachement, lien, réinitialisation, activation, changement de rôles et désactivation, avec des identifiants et des rôles seulement, jamais de nom, d'adresse ni de jeton.
- **Rôle ECRAN** : pas attribuable depuis cet écran ; il viendra avec l'écran d'appel (lot 3).

## Conséquences

- Un lien perdu ou expiré se remplace en un geste (« Générer un nouveau lien ») ; l'ancien ne sert plus.
- Le super-administrateur n'a pas encore d'écran pour les comptes de plusieurs églises : il passe par la base en attendant (à prévoir avec l'exploitation, lot 5).
- La connexion par téléphone accepte encore un ancien numéro béninois à 8 chiffres sans le convertir (`src/lib/identifiant.ts`), alors que les comptes sont créés au format E.164 à 10 chiffres : à rapprocher de l'ADR 0011.
- Le test de concurrence des deux ADMIN dépend du minutage : sans le verrou, il a échoué une fois sur trois exécutions (contre-épreuve) ; avec le verrou, il passe à chaque exécution.
