# 0003 — Authentification, église active et verrouillage des tablettes

- Statut : accepté
- Date : 2026-10-18

## Contexte

Les comptes sont rattachés à une ou plusieurs églises, avec des rôles par église (cahier §4). Les tablettes sont partagées et doivent se verrouiller après 15 minutes d'inactivité, avec un déverrouillage par PIN personnel à 6 chiffres (§9). On se connecte par e-mail **ou** téléphone, avec un mot de passe et une limitation des tentatives.

## Décision

**Better Auth n'authentifie que.** Il gère les tables `User` et `Auth*` (adaptateur Prisma, noms de modèles personnalisés, télémétrie désactivée). L'appartenance et les rôles vivent dans `Membre` (table maison). On n'utilise ni le plugin organization ni le plugin admin : `superAdmin` est un booléen de `User`. L'inscription publique est fermée (`disableSignUp`) : les comptes sont créés côté serveur par `src/server/plateforme/comptes.ts`, avec le hachage scrypt de Better Auth.

**Église active dans la session.** `AuthSession.egliseActiveId` est un champ additionnel, non modifiable par le client. À la création de session, un hook :

- refuse les comptes désactivés ;
- choisit l'église d'office si le compte n'en a qu'une.

Sinon, l'écran « Choisissez votre église » appelle `choisirEgliseActive`, qui vérifie l'appartenance avant d'écrire. `getTenantDb()` revérifie l'appartenance à chaque accès.

**Connexion par e-mail ou téléphone.** La Server Action normalise l'identifiant (E.164, préfixe +229 pour un numéro béninois). Un téléphone est traduit en e-mail côté serveur. Un numéro inconnu passe par la même connexion vouée à l'échec, si bien que la réponse ne révèle jamais l'existence d'un compte. Un compte « téléphone seul » reçoit un e-mail technique non routable.

**Limitation des tentatives.**

- Better Auth limite ses propres routes HTTP (stockage en base, partagé entre instances Vercel).
- La Server Action de connexion a son propre compteur en base (`AuthRateLimit`), atomique (`INSERT … ON CONFLICT … RETURNING`) : 5 tentatives par identifiant et 30 par adresse IP sur 15 minutes. Une connexion réussie remet à zéro le compteur de l'identifiant.

**Verrouillage par inactivité.**

- `AuthSession.derniereActivite` est mise à jour **au plus une fois par minute**. La condition est écrite dans l'`UPDATE` lui-même, donc pas de double écriture sous concurrence.
- Comptent comme activité : la navigation, les Server Actions, et les interactions réelles (toucher, clavier) que la tablette signale par `POST /api/session/activite`, au plus une fois par minute.
- **Ne comptent pas** les rafraîchissements automatiques : `useLiveQuery` envoie l'en-tête `x-hk-rafraichissement: 1`, et `getSessionCourante({ rafraichissementAuto: true })` n'écrit rien. Une tablette laissée sur un écran en direct se verrouille donc bien après 15 minutes.
- Une session verrouillée n'écrit plus d'activité et `getTenantDb()` la refuse (`AccesRefuse("verrouille")`). La mise en page affiche l'écran de verrouillage à la place de la page.

**PIN.**

- Un PIN par `Membre`, donc par église, haché en scrypt. Les codes triviaux (`000000`, `123456`) sont refusés.
- Cinq erreurs bloquent le PIN pendant 15 minutes ; il faut alors se reconnecter avec son mot de passe, ce qui remet les compteurs à zéro.
- Le PIN est demandé à la première entrée dans une église.

**En-têtes de sécurité.** `src/proxy.ts` pose sur chaque requête :

- une CSP avec nonce (`script-src 'nonce-…' 'strict-dynamic'`) — toutes les pages sont donc rendues à la demande (`connection()` dans la mise en page racine) ;
- `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (caméra autorisée pour le scanner) ;
- HSTS en production.

Le proxy ne fait qu'une redirection optimiste vers la connexion quand le cookie est absent. Les vrais contrôles sont côté serveur. Les cookies sont `HttpOnly`, `SameSite=Lax`, et `Secure` en production.

## Conséquences

- Les Server Actions de `src/app/` ne touchent pas la base directement : elles valident (Zod) puis appellent `src/server/plateforme/espace-personnel.ts` (règle ESLint d'accès brut).
- L'écran d'appel (lot 3) ne dépendra pas d'un compte ECRAN : la piste retenue est un jeton d'écran échangé contre un cookie d'appareil révocable.
- Les mots de passe de démonstration du seed sont publics par construction : ils ne doivent jamais servir hors des environnements de démonstration.
