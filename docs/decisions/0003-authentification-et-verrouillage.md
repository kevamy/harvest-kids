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

**Connexion par e-mail ou téléphone.** La Server Action normalise l'identifiant comme partout ailleurs (`src/lib/telephone.ts`, ADR 0011) : E.164, indicatif +229 par défaut. Un numéro béninois à l'ancien format à 8 chiffres est essayé avec le préfixe 01, puisque les comptes sont enregistrés à 10 chiffres. Un téléphone est traduit en e-mail côté serveur. Un numéro inconnu passe par la même connexion vouée à l'échec, si bien que la réponse ne révèle jamais l'existence d'un compte. Un compte « téléphone seul » reçoit un e-mail technique non routable.

**Limitation des tentatives : par personne d'abord** (révisé au lot 1, étape 9). Toutes les tablettes d'une église partagent la même adresse IP publique : une limite par IP bloquerait l'église entière un dimanche matin. Chaque limite compte donc d'abord par personne, puis par IP, à titre de garde-fou seulement (300 essais par 15 minutes, `GARDE_IP`). Les compteurs sont en base (`AuthRateLimit`, partagés entre instances), atomiques (`INSERT … ON CONFLICT … RETURNING`) ; `src/server/plateforme/limitation.ts` regroupe les règles.

- **Connexion** : 5 tentatives par identifiant (e-mail ou téléphone normalisé) sur 15 minutes, puis le garde-fou IP. Une connexion réussie remet à zéro le compteur de l'identifiant.
- **PIN** : 5 erreurs par membre bloquent son PIN 15 minutes (voir plus bas), sans aucune limite par IP.
- **Activation d'un compte** (ADR 0014) : 10 essais par lien (empreinte du jeton, jamais le jeton) sur 15 minutes, puis le garde-fou IP.
- **Route HTTP de Better Auth** : `/sign-in/email` est fermée (`disabledPaths`). Elle aurait contourné le compte par identifiant, et sa propre limite compte par IP. La connexion passe uniquement par la Server Action, qui appelle `auth.api.signInEmail` côté serveur ; cet appel n'est concerné ni par `disabledPaths` ni par la limitation HTTP de Better Auth.
- Tests : 15 moniteurs différents (connexion, PIN, activation) depuis la même IP ne sont pas bloqués ; un identifiant ou un lien reste limité seul ; le garde-fou IP refuse le 301ᵉ essai.

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
