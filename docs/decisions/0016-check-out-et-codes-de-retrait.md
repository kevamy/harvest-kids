# 0016 — Check-out : vérification de l'adulte et limite des codes de retrait

- Statut : accepté (lot 2, étape 5)
- Date : 2026-11-15

## Contexte

Au check-out, le parent présente sa carte ou donne le code de retrait de la session (cahier §7.6, RG-04). Le code tient en 4 caractères pris dans un alphabet de 31 : quelqu'un qui en essaie au comptoir pourrait finir par tomber sur celui d'une famille. Toutes les tablettes d'une église partagent la même adresse IP publique (ADR 0003), et le `userAgent` ne distingue pas deux tablettes du même modèle.

## Décision

- **Une carte ou un code ne suffit jamais** (RG-06) : l'agent touche la photo d'une personne autorisée active de la famille ; le bouton « Confirmer le retrait » reste désactivé sans elle, et le serveur refuse une personne inactive ou d'une autre famille. Un adulte qui n'est pas parmi les photos bloque le retrait ; l'écran propose d'appeler le contact principal (`tel:`, `https://wa.me/`). L'autorisation exceptionnelle par le responsable vient avec l'étape 5b.
- **Un seul champ** pour le scan et le code : une valeur de 4 caractères de l'alphabet du code est un code (minuscules acceptées), toute autre valeur un jeton de carte.
- **Codes erronés : 5 par tablette et par session en 15 minutes.** Une tablette est une session de connexion (identifiant de session Better Auth). Seuls les codes erronés sont comptés, dans le compteur partagé `AuthRateLimit` (fenêtre fixe, horloge du serveur comme les autres limitations), sous la clé `checkout-code:{église}:{session}:{tablette}`. Un code mal formé n'est pas compté (faute de frappe). Au cinquième, la saisie d'un code est bloquée jusqu'à la fin de la fenêtre ; le scan d'une carte reste possible. Chaque code erroné est audité (`checkout.code_errone`, avec le nombre d'essais, jamais le code tapé). Le tableau de l'accueil affiche une alerte « Tablette bloquée » tant que le blocage dure.
- **Le code ne vaut que dans sa session** (RG-04) : la famille est cherchée parmi les présences de la session choisie seulement. À la validation, la carte ou le code est vérifié de nouveau ; un code qui n'est plus celui de la famille compte comme un code erroné.
- **Validation dans une transaction** : la ligne de la session est verrouillée (comme au check-in) ; les présences cochées sont verrouillées (`FOR UPDATE`) puis passent en `RECUPERE` avec `recupereLe` posée par la base, la personne autorisée et l'agent. Un enfant remis au même moment sur une autre tablette fait échouer la seconde validation, sans rien écrire. Une carte en attente scannée est activée à ce moment (ADR 0008). Chaque enfant remis écrit un `EvenementPresence` (`checkout`, avec le statut d'avant et le moyen : scan ou code) et une entrée d'audit `presence.checkout`.

## Conséquences

- Se déconnecter puis se reconnecter ouvre une nouvelle session, donc un nouveau compteur : la limite freine les essais au comptoir, elle ne remplace pas la vérification visuelle de l'adulte, qui reste obligatoire.
- Un enfant à l'infirmerie (RG-07) ou encore en route vers sa classe est signalé en tête de la famille ; le check-out reste possible, l'agent accompagne le parent. La notification à la tablette de la classe vient avec le lot 3.
