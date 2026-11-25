# 0018 — Écran d'appel : appairage par lien unique, sans compte

- Statut : accepté (lot 3, étape 5)
- Date : 2026-11-25 (décisions de l'utilisateur du 2026-11-24)

## Contexte

L'écran d'appel est projeté dans la salle (cahier §7.8) : il affiche les numéros des enfants dont le parent est attendu et ceux qui sont à l'infirmerie, jamais leur nom (RG-10). Il tourne seul, toute la durée du culte, sur un appareil que personne ne déverrouille (télévision, tablette, ordinateur de la salle). Le cahier prévoyait un jeton par église (`Eglise.ecranToken`, stocké en clair, jamais utilisé) et un rôle `ECRAN`. Un compte ECRAN imposerait un mot de passe et le verrouillage par PIN après 15 minutes d'inactivité ; un jeton unique par église ne se révoque pas écran par écran.

## Décision

- **Un écran nommé par appareil** (`EcranAppareil`, table de plateforme hors RLS, car l'écran n'a pas de session et doit être reconnu avant qu'on connaisse l'église). L'ADMIN (`eglise.parametrer`) l'ajoute dans Paramètres › Écran d'appel et reçoit un **lien d'appairage** `/ecran/{slug}#HKE1.…` (43 caractères base62), affiché une seule fois, valable 24 heures (échéance posée par PostgreSQL) et à usage unique.
- **Le jeton est dans le fragment** de l'adresse : il n'est jamais envoyé au serveur avec la page, ni écrit dans un journal. La page le retire de la barre d'adresse, puis le poste une fois à `POST /api/ecran/[slug]/appairage`.
- **Consommation atomique** : un seul `UPDATE … WHERE "appaireLe" IS NULL AND "revoqueLe" IS NULL AND "jetonExpireLe" > now() … RETURNING`, qui vérifie aussi que le lien appartient à l'église de l'adresse et que l'église est active. Deux appareils qui ouvrent le même lien en même temps : un seul est appairé. Les essais sont limités par lien (10 en 15 minutes) puis par IP, comme les liens d'activation (ADR 0014).
- **Cookie de l'appareil** : l'appairage renvoie un secret `HKA1.…` gardé dans le cookie `hk_ecran` (HttpOnly, Secure, SameSite=Lax, chemin `/api/ecran`, 400 jours), renouvelé à l'usage. Seules les empreintes SHA-256 du lien et du secret sont stockées.
- **L'église vient du cookie, jamais de l'adresse** : `GET /api/ecran/[slug]` (toutes les 3 s) répond 401 sans cookie, 404 pour un appareil d'une autre église (ou inconnu), 410 pour un écran retiré. Les tuiles sont lues dans l'église de l'appareil, sous RLS (`withEglise`). Le logo passe par `/api/ecran/[slug]/logo`, avec le même contrôle.
- **Révocation écran par écran**, définitive (déclencheur) ; l'appairage aussi. Pour remplacer un appareil, on retire l'écran et on en ajoute un autre. La table n'est jamais effacée par l'application (historique) ; seules les colonnes d'appairage, de dernière vue et de révocation se modifient.
- **Dernière vue écrite au plus une fois par minute** (`UPDATE … WHERE "derniereVue" < now() - interval '1 minute'`), pas à chaque rafraîchissement de 3 s ; le cookie est renouvelé en même temps.
- `Eglise.ecranToken` est supprimé ; le rôle `ECRAN` reste dans l'énumération, sans aucun droit.
- **Mise en évidence** : une nouvelle tuile ressort 4 secondes (animation CSS jouée à son apparition, sans son), jamais sous `prefers-reduced-motion`.

## Conséquences

- Aucun mot de passe sur l'appareil de la salle, aucun verrouillage pendant le culte ; un appareil perdu se retire d'un geste, sans toucher aux autres écrans.
- `src/server/plateforme/ecran.ts` est le seul module qui lit `EcranAppareil`, toujours en nommant l'église (celle de l'ADMIN, ou celle de l'appareil). Ses tests d'isolation remplacent la RLS absente : un ADMIN de A ne liste, ne révoque ni ne crée un écran de B ; un appareil de A n'atteint jamais B.
- Un lien d'appairage expiré ou déjà utilisé ne sert plus : l'ADMIN retire l'écran et en ajoute un autre.
- Écarts au cahier, à y reporter : §3 bis et §7.8 (lien d'appairage par écran au lieu d'un jeton par église, pas de compte ECRAN), §4 (rôle ECRAN sans usage).
