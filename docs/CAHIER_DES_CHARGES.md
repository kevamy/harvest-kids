# Harvest Kids — Cahier des charges

Version 1.1, octobre 2026 (ajout du multi-églises et du logo de l'église sur les cartes). Destinataire : Claude Code (développement), validé par l'équipe des leaders.

---

## 1. Contexte

Lors d'un culte, une mère n'a pas retrouvé son enfant immédiatement à la sortie. L'enfant était à l'infirmerie, mais personne à l'accueil ne le savait : panique et va-et-vient. La réunion des leaders a identifié les causes suivantes :

- aucun système d'enregistrement à l'arrivée (check-in) ni au départ (check-out) des enfants ;
- un flux mal géré entre les deux cultes, où les départs du premier culte croisent les arrivées du second ;
- des numéros de parents qui ne sont pas utilisés systématiquement en cas d'urgence ;
- un moniteur seul dans sa salle.

Les solutions retenues, que l'application doit outiller :

- un matricule unique par enfant, scanné à l'entrée et à la sortie (QR code dans un premier temps, borne plus tard) ;
- l'affichage du numéro de l'enfant sur un écran pour que les parents le repèrent ;
- une équipe d'accueil dédiée, distincte de l'équipe d'animation ;
- toujours deux moniteurs par classe.

## 2. Objectifs et critères de réussite

1. À tout instant pendant un culte, l'équipe d'accueil sait **où se trouve chaque enfant** (accueil, classe, infirmerie, récupéré) en moins de 10 secondes.
2. **Aucun enfant ne repart** sans qu'une personne autorisée ait été vérifiée et que le retrait ait été enregistré.
3. Un check-in prend **moins de 15 secondes** par famille déjà inscrite ; un check-out moins de 20 secondes.
4. **Aucune classe ne fonctionne avec un seul moniteur** sans que le responsable en soit alerté.
5. Le parent d'un enfant peut être **appelé en un geste** (écran d'appel ou téléphone) depuis la fiche de l'enfant.

## 3. Périmètre

### Version 1 (ce cahier des charges)

Application web responsive, installable (PWA), utilisée sur tablette par l'équipe d'accueil, les moniteurs et l'infirmerie, plus un écran d'appel projeté en salle de culte. **Une seule installation sert plusieurs églises** (multi-tenant, section 3 bis) : chaque église a ses propres familles, classes, cultes, équipes, paramètres et son propre logo, totalement cloisonnés des autres.

### Hors périmètre v1 (à prévoir dans l'architecture, sans le développer)

- la borne d'enregistrement en libre-service (le mode « borne » réutilisera les écrans de check-in) ;
- l'impression d'étiquettes thermiques (Brother QL ou Zebra) ;
- l'envoi de SMS ou de messages WhatsApp automatiques ;
- une application ou un espace pour les parents ;
- la synchronisation avec Harvest, le logiciel de gestion de l'église (prévoir un import CSV des familles en v1).

## 3 bis. Plateforme multi-églises

### Principe

Harvest Kids est un service unique hébergé une fois (Vercel en test, VPS Hostinger en production) qui accueille plusieurs églises. Chaque église est un **tenant** : elle ne voit jamais les données d'une autre église, et ses données peuvent être exportées ou supprimées sans toucher aux autres.

### Choix d'architecture

- **Une base PostgreSQL partagée, un schéma partagé, une colonne `egliseId` sur toutes les tables métier.** C'est le modèle le plus simple à exploiter sur un seul VPS (une seule migration, une seule sauvegarde) et il supporte sans difficulté des dizaines d'églises.
- **Double barrière d'isolation :**
  1. côté application, un client Prisma « scopé » (extension Prisma), obtenu uniquement via `getTenantDb()`, ajoute automatiquement `egliseId` à toute lecture et toute écriture. Le client Prisma brut n'est importable que dans `src/server/plateforme/` ;
  2. côté base, des politiques **Row-Level Security** PostgreSQL filtrent chaque table métier sur `current_setting('app.eglise_id')`, positionné en début de transaction (`SET LOCAL`). Une requête oubliée ne peut donc pas fuir vers une autre église. L'application se connecte avec un rôle PostgreSQL sans `BYPASSRLS` ; les migrations utilisent un rôle distinct.
- **L'église active vient de la session**, pas de l'URL : à la connexion, l'utilisateur entre dans l'église dont il est membre ; s'il est membre de plusieurs églises, il choisit (et peut changer) depuis le menu. Aucun sous-domaine n'est nécessaire en v1, ce qui évite les certificats wildcard sur Caddy et les domaines wildcard sur Vercel. Les sous-domaines par église restent possibles plus tard sans changer le modèle.
- **Exception, l'écran d'appel** : il est adressé par `/ecran/[slug-eglise]` et protégé par un jeton d'écran propre à l'église.

### Ce qui est propre à chaque église

Nom, slug, logo, coordonnées, fuseau horaire, cultes, classes, comptes et rôles, badges moniteurs, familles et enfants, séquence des matricules, textes de consentement, texte de la carte famille, lieux de rendez-vous, délais d'alerte, durée de conservation des données.

### Administration de la plateforme

Un rôle `SUPER_ADMIN`, hors de toute église, gère la plateforme depuis `/plateforme` :

- crée une église (nom, slug, logo, fuseau) et son premier administrateur ;
- crée automatiquement les classes et cultes par défaut, modifiables ensuite par l'église ;
- suspend, réactive, exporte (archive JSON + photos) ou supprime une église ;
- voit des indicateurs agrégés et anonymes (nombre d'enfants, de sessions, d'incidents par église), **jamais les données nominatives**.

Si un super-administrateur doit intervenir dans une église (support), il active un **accès de support** limité dans le temps (2 heures par défaut) en saisissant un motif. L'accès est journalisé et visible par l'administrateur de l'église.

### Données personnelles

Chaque église est responsable du traitement des données de ses familles ; l'exploitant de la plateforme agit comme sous-traitant. Prévoir un modèle de convention de sous-traitance et une page « Données et confidentialité » par église (textes paramétrables).

## 4. Utilisateurs et rôles

Les rôles ci-dessous s'appliquent **à l'intérieur d'une église** : un compte est rattaché à une ou plusieurs églises, avec des rôles différents dans chacune (table `Membre`). `SUPER_ADMIN` est le seul rôle global.

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| `SUPER_ADMIN` | Exploitant de la plateforme | Gérer les églises et leurs premiers administrateurs (section 3 bis), sans accès aux données nominatives hors accès de support |
| `ADMIN` | Administrateur de l'église | Tout dans son église : comptes, rôles, paramètres, logo, purges de données |
| `RESPONSABLE` | Responsable du ministère enfants | Ouvrir et clôturer les sessions, gérer classes et moniteurs, forcer une ouverture de classe, voir les rapports et le journal d'audit |
| `ACCUEIL` | Équipe de réception | Inscrire et modifier les familles, faire les check-in et check-out, appeler les parents, voir le tableau de bord en direct |
| `MONITEUR` | Équipe d'animation | Voir sa classe, confirmer l'arrivée en salle, envoyer un enfant à l'infirmerie, demander l'appel d'un parent, déclarer un incident |
| `INFIRMERIE` | Équipe de soins | Voir les enfants à l'infirmerie, les recevoir, les renvoyer en classe, consulter les alertes médicales, déclarer un incident |
| `ECRAN` | Compte technique de l'écran d'appel | Lecture seule de la page d'appel, sans aucune donnée nominative |

Une personne peut avoir plusieurs rôles. Les parents n'ont pas de compte en v1 : ils sont identifiés par leur carte QR, leur code de retrait et la vérification visuelle.

## 5. Vocabulaire et objets métier

- **Église** : le tenant. Possède un nom, un slug, un logo, un fuseau horaire et tous les paramètres listés en section 3 bis.
- **Membre** : le rattachement d'un compte utilisateur à une église, avec ses rôles dans cette église.
- **Famille** : un foyer, avec un ou plusieurs parents ou tuteurs et un ou plusieurs enfants.
- **Tuteur** : parent ou tuteur légal, avec nom, téléphone principal, téléphone secondaire, WhatsApp, lien avec l'enfant. Un tuteur est « contact principal ».
- **Personne autorisée** : adulte autorisé à récupérer un ou plusieurs enfants de la famille (tuteurs compris), avec photo obligatoire, nom, lien et téléphone.
- **Enfant** : prénom, nom, date de naissance, photo, sexe (facultatif), alertes médicales (allergies, traitements, consignes), notes, consentement photo, **matricule** (`HK-0001`).
- **Carte famille** : carte plastifiée format carte bancaire remise aux parents, au **logo de l'église** (pas celui de Harvest Kids), portant un QR code. Une carte par famille (elle donne accès à tous les enfants de la famille). Révocable et remplaçable.
- **Classe** : groupe d'enfants par tranche d'âge (ex. Pouponnière 0–2 ans, 3–5 ans, 6–8 ans, 9–12 ans), avec salle, capacité et nombre minimum de moniteurs (2 par défaut).
- **Culte** : créneau récurrent (ex. « Culte 1 — dimanche 8 h », « Culte 2 — dimanche 10 h 30 »).
- **Session** : l'occurrence datée d'un culte (ex. culte 1 du 19 octobre 2026). Toutes les présences sont rattachées à une session.
- **Présence** : le passage d'un enfant dans une session, avec sa classe, son statut, son code de retrait et ses horodatages.
- **Affectation moniteur** : la présence d'un moniteur dans une classe pour une session.
- **Appel** : demande de venue d'un parent, affichée sur l'écran d'appel.
- **Incident** : événement déclaré (blessure, malaise, comportement, enfant introuvable, tentative de retrait non autorisée…).

## 6. Statuts d'une présence

```
ATTENDU ──► PRESENT ──► EN_SALLE ──► RECUPERE
               │            │  ▲
               │            ▼  │
               └──────► INFIRMERIE
                    (APPEL_PARENT est un drapeau qui se superpose au statut)
```

| Statut | Signification | Déclencheur |
|---|---|---|
| `PRESENT` | Enregistré à l'accueil, en route vers sa classe | Check-in à l'accueil |
| `EN_SALLE` | Confirmé par un moniteur de la classe | Scan ou toucher par un moniteur de la classe |
| `INFIRMERIE` | À l'infirmerie | Moniteur ou infirmerie ; enregistre l'heure et l'accompagnant |
| `RECUPERE` | Remis à une personne autorisée | Check-out validé |
| Drapeau `appelParent` | Le parent est appelé | Moniteur, accueil ou infirmerie ; affiché sur l'écran d'appel jusqu'à résolution |

Chaque changement de statut est horodaté et enregistré dans l'historique de la présence et dans le journal d'audit (qui, quand, depuis quel appareil).

## 7. Parcours fonctionnels

### 7.1 Inscription d'une famille (ACCUEIL, RESPONSABLE)

1. Saisie du ou des tuteurs, puis des enfants, puis des personnes autorisées (photo prise avec la caméra de la tablette).
2. Saisie des alertes médicales par enfant, en texte libre plus des cases rapides (allergie alimentaire, asthme, épilepsie, traitement en cours, autre).
3. Recueil du consentement du tuteur : case à cocher datée « J'accepte que les données de mes enfants soient utilisées pour leur sécurité pendant les activités de l'église » et case séparée pour l'usage des photos. Sans le premier consentement, l'inscription ne peut pas être validée.
4. À la validation : attribution des matricules et génération de la carte famille.
5. Impression : PDF de la carte famille (format CR80, 85,6 × 54 mm). Recto : **logo de l'église** et nom de l'église, nom de la famille, QR code, prénoms et matricules des enfants. Verso : consignes de dépôt et de retrait, téléphone de l'accueil enfants (texte paramétrable par l'église). Le logo Harvest Kids n'apparaît pas sur la carte. Si l'église n'a pas encore téléversé de logo, son nom est composé en Fredoka à la place. Possibilité d'imprimer une planche A4 de 10 cartes.
6. Import CSV des familles (modèle téléchargeable) pour la reprise depuis Harvest ou des fichiers existants, avec écran de prévisualisation et rapport d'erreurs.

Une recherche rapide (nom d'enfant, nom de parent, téléphone, matricule) est disponible partout.

### 7.2 Préparation d'une session (RESPONSABLE)

1. Les sessions du jour sont créées automatiquement à partir des cultes récurrents (ou manuellement).
2. Le responsable **ouvre la session** ; les classes sont listées avec leur nombre de moniteurs présents.
3. Chaque moniteur fait son propre check-in en scannant son badge moniteur (QR) ou en se sélectionnant, puis choisit sa classe.
4. **Une classe n'est ouverte que lorsque 2 moniteurs y sont affectés** (paramètre `minMoniteurs`). Tant qu'elle n'est pas ouverte, le check-in vers cette classe est bloqué. Le responsable peut forcer l'ouverture en saisissant un motif ; la classe apparaît alors en alerte sur tous les tableaux de bord.
5. Si un moniteur quitte sa classe en cours de session et que le nombre tombe sous le minimum, une alerte rouge s'affiche sur le tableau de bord de l'accueil et du responsable.
6. Un moniteur des autres départements peut être ajouté comme renfort (rôle MONITEUR temporaire pour la session).

### 7.3 Check-in (ACCUEIL)

1. L'agent d'accueil scanne la carte famille (caméra de la tablette ou douchette USB/Bluetooth qui saisit comme un clavier). À défaut, il recherche la famille.
2. L'écran affiche les enfants de la famille avec photo, âge et alertes médicales ; tous sont cochés par défaut, l'agent décoche ceux qui ne sont pas là.
3. La classe est proposée automatiquement selon l'âge et reste modifiable.
4. L'agent valide : chaque enfant passe en `PRESENT`, un **code de retrait de session** de 4 caractères est généré pour la famille (alphabet sans caractères ambigus : pas de 0, O, 1, I, L).
5. Confirmation affichée en grand : matricules, classes et code de retrait, que l'agent dicte au parent (plus tard, imprimé sur une étiquette parent).
6. Si une alerte médicale existe, elle est rappelée à l'écran et marquée sur la fiche de classe.
7. Un enfant déjà présent dans une autre session ouverte (resté du culte 1) est signalé : l'agent choisit de le basculer dans la nouvelle session.

### 7.4 Arrivée en salle (MONITEUR)

1. La tablette du moniteur affiche la liste de sa classe : enfants `PRESENT` à confirmer en haut, enfants `EN_SALLE` en dessous.
2. Le moniteur confirme l'arrivée d'un enfant par un toucher ou un scan ; l'enfant passe en `EN_SALLE`.
3. Un enfant resté `PRESENT` plus de 10 minutes (paramétrable) génère une alerte « non arrivé en salle » sur le tableau de bord de l'accueil.

### 7.5 Pendant le culte (MONITEUR, INFIRMERIE, ACCUEIL)

- **Infirmerie** : depuis la fiche, « Accompagner à l'infirmerie » (choix de l'accompagnant, motif court). L'infirmerie voit l'enfant arriver, le reçoit, puis le renvoie en classe ou le garde. **Le statut `INFIRMERIE` est visible partout, y compris au check-out** (c'est la cause de l'incident d'origine).
- **Appeler le parent** : depuis la fiche, choix du motif (pleurs, change, soins, comportement, autre). Le matricule apparaît sur l'écran d'appel avec le lieu de rendez-vous (accueil enfants ou infirmerie). L'appel est résolu quand le parent arrive ou quand le moniteur l'annule.
- **Urgence** : bouton présent sur chaque fiche. Il affiche les tuteurs et personnes autorisées avec leurs numéros ; un toucher lance l'appel (`tel:`), un autre ouvre WhatsApp (`https://wa.me/`). Chaque appel lancé est journalisé (qui, quand, quel numéro, résultat saisi : joint, pas de réponse, messagerie).
- **Incident** : formulaire court (type, description, personnes présentes, mesures prises) rattaché à l'enfant et à la session, notifié au responsable sur son tableau de bord.

### 7.6 Check-out (ACCUEIL, et MONITEUR en salle si la configuration le permet)

1. Le parent présente sa carte famille (scan) ou donne son code de retrait de session.
2. L'écran affiche les enfants de la famille présents dans la session avec leur statut et leur lieu, ainsi que **les photos des personnes autorisées**.
3. L'agent vérifie visuellement l'adulte et touche sa photo pour indiquer qui récupère.
4. L'agent sélectionne les enfants remis et valide : statut `RECUPERE`, horodatage, personne qui récupère, agent qui remet.
5. Cas particuliers :
   - **Enfant à l'infirmerie** : message en tête « Ayo est à l'infirmerie. Accompagnez le parent. », le check-out reste possible depuis l'infirmerie.
   - **Enfant encore en salle** : l'agent demande à la classe de l'amener (notification sur la tablette de la classe) ou accompagne le parent.
   - **Adulte non reconnu parmi les personnes autorisées** : retrait bloqué. L'écran propose d'appeler le contact principal ; le responsable peut autoriser exceptionnellement après appel, en saisissant le nom de l'adulte, une photo et le motif. L'événement crée automatiquement un incident.
   - **Carte et code absents** : recherche par nom, vérification renforcée (photo obligatoire de la personne autorisée reconnue + confirmation par un second membre de l'équipe).

### 7.7 Transition entre les deux cultes (ACCUEIL, RESPONSABLE)

1. Le tableau de bord de l'accueil sépare clairement deux colonnes : **« Départs — culte 1 »** et **« Arrivées — culte 2 »**, pour que deux agents puissent travailler en parallèle sans se gêner.
2. À l'heure de fin du culte 1, un compteur « enfants non récupérés » apparaît. Dix minutes après la fin (paramétrable), chaque enfant non récupéré déclenche un appel parent automatique sur l'écran d'appel et une alerte sur le tableau de bord.
3. Un enfant qui reste pour le culte 2 (parents qui servent, par exemple) est **basculé** dans la session suivante sans repasser par l'accueil, avec traçabilité.
4. La session 1 ne peut être clôturée que lorsque tous les enfants sont `RECUPERE` ou basculés ; sinon le responsable doit justifier la clôture.

### 7.8 Écran d'appel (compte ECRAN)

- Page `/ecran/[slug-eglise]` plein écran, sur fond bleu nuit, avec le **logo de l'église** (variante claire), lisible à 15 mètres : matricules (pas de noms, pas de photos) et lieu de rendez-vous.
- Couleurs : soleil = parent attendu à l'accueil, alerte = infirmerie, bleu layette = prêt au retrait en fin de culte.
- Rafraîchissement automatique en 5 secondes maximum ; un indicateur discret signale une perte de connexion.
- Le compte ECRAN reste connecté sur l'appareil projeté (session longue, révocable).

### 7.9 Tableaux de bord et rapports

- **Accueil (en direct)** : effectifs par classe et par statut, classes ouvertes et nombre de moniteurs, alertes (classe sous le minimum, enfant non arrivé en salle, enfant à l'infirmerie, appels en cours, enfants non récupérés).
- **Responsable** : idem plus incidents de la session et journal des actions.
- **Rapports** : présences par session, par classe, par période ; taux d'encadrement ; incidents ; export CSV et PDF.

### 7.10 Administration

- Profil de l'église : nom, coordonnées, fuseau horaire, **logo** (SVG ou PNG transparent, avec une variante claire facultative pour les fonds sombres), téléphone de l'accueil enfants imprimé sur les cartes.
- Gestion des comptes et de leurs rôles dans l'église, invitation d'un compte déjà membre d'une autre église, badges moniteurs (QR imprimables, au logo de l'église).
- Gestion des cultes récurrents, des classes (tranches d'âge, salles, capacité, minimum de moniteurs).
- Paramètres : délais d'alerte, lieux de rendez-vous, texte de la carte famille, durée de conservation des données.
- Révocation et réédition d'une carte famille perdue (l'ancien QR devient invalide immédiatement).

## 8. Règles de gestion

| Code | Règle |
|---|---|
| RG-01 | Le matricule est `HK-` suivi de 4 chiffres (5 au-delà de 9999), attribué séquentiellement **par église** (compteur propre à chaque église, incrémenté de façon atomique), jamais réutilisé. Le couple (église, matricule) est unique en base. |
| RG-02 | **Le QR code ne contient jamais le matricule ni un nom.** Il contient un jeton aléatoire opaque (`HKF1.` + 22 caractères base62) associé côté serveur à la famille. Le matricule étant affiché publiquement sur l'écran d'appel, un QR basé sur le matricule pourrait être falsifié. |
| RG-03 | Un jeton de carte révoqué est refusé avec le message « Cette carte a été remplacée. Demandez la nouvelle carte au parent ou recherchez la famille. » |
| RG-04 | Le code de retrait de session est valable uniquement pour la session où il a été généré. |
| RG-05 | Check-in impossible vers une classe non ouverte (moins de `minMoniteurs`), sauf ouverture forcée motivée par un RESPONSABLE. |
| RG-06 | Check-out uniquement par une personne autorisée de la famille, identifiée visuellement sur sa photo ; toute exception crée un incident. |
| RG-07 | Un enfant `INFIRMERIE` est signalé en tête de tout écran qui l'affiche. |
| RG-08 | Un même enfant ne peut avoir qu'une seule présence non clôturée à la fois. |
| RG-09 | Toute action qui change un statut, une autorisation ou une donnée d'enfant est écrite au journal d'audit, non modifiable. |
| RG-10 | L'écran d'appel n'affiche aucune donnée nominative. |
| RG-11 | Les photos d'enfants et d'adultes ne sont jamais publiques : elles sont servies par une route authentifiée. |
| RG-12 | Les horaires sont gérés dans le fuseau de l'église (par défaut `Africa/Porto-Novo`, UTC+1, sans heure d'été). |
| RG-13 | Aucune donnée d'une église n'est lisible ni modifiable depuis une autre église. Toute table métier porte `egliseId`, filtré par l'application et par la Row-Level Security. |
| RG-14 | Un QR (carte famille, badge moniteur) scanné dans une église à laquelle il n'appartient pas est refusé avec le message « Cette carte n'appartient pas à cette église. » |
| RG-15 | Les fichiers (photos, logos, PDF) sont rangés sous un préfixe par église (`eglises/{egliseId}/…`) et la route de lecture vérifie que le fichier appartient à l'église active. |

## 9. Exigences non fonctionnelles

### Ergonomie et appareils

- Cible principale : tablette Android 10 à 11 pouces, Chrome, en paysage et en portrait. Fonctionne aussi sur téléphone et ordinateur.
- Cibles tactiles de 56 px minimum, police de base 18 px, une action principale par écran.
- Interface entièrement en français ; libellés, erreurs et confirmations rédigés selon la charte (`design/charte.md`).
- Accessibilité : contrastes AA, focus visible, statuts toujours écrits en toutes lettres et pas seulement codés par la couleur.

### Performance et réseau

- Scan jusqu'à affichage de la famille : moins de 1 seconde sur le réseau de l'église.
- Le Wi-Fi ou la 4G de l'église peuvent être instables : l'application doit afficher un état clair « Hors connexion » et **empêcher les actions non enregistrées** plutôt que de faire croire qu'elles ont réussi. Le mode hors connexion avec file d'attente des check-in est prévu au lot 5 ; le check-out restera toujours en ligne.
- Mise à jour des écrans en direct en 5 secondes maximum.

### Sécurité et données personnelles

- Les données concernent des mineurs : principe de minimisation (ne collecter que ce qui sert à leur sécurité).
- Cadre légal : loi n° 2017-20 portant Code du numérique en République du Bénin (livre V sur la protection des données à caractère personnel) et autorité de contrôle APDP. Prévoir : consentement daté du tuteur, information sur la finalité, droit d'accès et de rectification, durée de conservation paramétrable (par défaut, suppression des historiques de présence au-delà de 3 ans et des familles inactives depuis 2 ans, après confirmation).
- Contrôle d'accès par rôle **et par église** vérifié côté serveur sur chaque action et chaque requête (RG-13).
- HTTPS partout, cookies `HttpOnly`, `Secure`, `SameSite=Lax`, en-têtes de sécurité (CSP, HSTS).
- Mots de passe hachés (Argon2 ou bcrypt via la bibliothèque d'authentification), limitation des tentatives de connexion.
- Sessions des tablettes partagées : verrouillage automatique après 15 minutes d'inactivité, déverrouillage par code PIN personnel à 6 chiffres.
- Sauvegarde quotidienne chiffrée de la base et des photos, conservée hors du VPS, avec un test de restauration documenté.

## 10. Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | TypeScript (mode strict) | Un seul langage front et back, typage partagé avec la base. |
| Framework | **Next.js**, dernière version stable, App Router, sortie `standalone` | Tourne à l'identique sur Vercel (test) et en conteneur Node sur le VPS (prod). |
| Interface | **Tailwind CSS v4** + **shadcn/ui** (Radix UI), restylés avec `design/tokens.css` | Composants accessibles, entièrement personnalisables aux couleurs Harvest Kids. |
| Icônes | lucide-react | Trait arrondi cohérent avec Fredoka. |
| Polices | Fredoka (titres, matricules) et Nunito (texte) via `next/font/google` | Auto-hébergées au build, pas d'appel à Google en production. |
| Formulaires | React Hook Form + Zod | Validation partagée client et serveur. |
| Données | **PostgreSQL 16** + **Prisma ORM** | Relationnel, migrations versionnées, schéma lisible. |
| Multi-églises | Colonne `egliseId` + extension Prisma (client scopé) + **Row-Level Security** PostgreSQL | Isolation garantie même en cas d'oubli dans une requête ; une seule base à sauvegarder. |
| Mutations | Server Actions (avec vérification de rôle systématique) | Moins de code d'API ; route handlers pour l'écran d'appel et les flux en direct. |
| Lecture en direct | TanStack Query avec `refetchInterval` (3 à 5 s) derrière un hook `useLiveQuery` | Fonctionne sur Vercel comme sur le VPS ; remplaçable plus tard par SSE sans toucher aux écrans. |
| Authentification | **Better Auth** (e-mail ou téléphone + mot de passe, plugin admin pour les rôles) + PIN de déverrouillage | Sessions en base, compatible Prisma, auto-hébergé. |
| QR : génération | `qrcode` (SVG côté serveur) | Cartes et badges nets à l'impression. |
| QR : lecture | `@zxing/browser` (caméra) + champ de saisie qui capte les douchettes | La même saisie servira à la borne. |
| PDF | `@react-pdf/renderer` | Cartes famille, badges moniteurs, rapports. |
| Photos | Adaptateur de stockage à deux pilotes : `local` (volume Docker sur le VPS) et `vercel-blob` (test) ; redimensionnement avec `sharp` (max 600 px, WebP) | Les photos restent sur le serveur de l'église en production. |
| Dates | date-fns + `@date-fns/tz` | Fuseau Africa/Porto-Novo. |
| PWA | Serwist | Installation sur l'écran d'accueil, plein écran, base du futur mode hors connexion. |
| Tests | Vitest (unitaires) + Playwright (parcours de bout en bout sur viewport tablette) | Le scénario de l'incident d'origine devient un test automatique. |
| Qualité | ESLint, Prettier, `pnpm` | |
| Suivi d'erreurs | Sentry (offre gratuite), optionnel | |

## 11. Modèle de données (point de départ Prisma)

À affiner pendant le lot 0 ; tout changement de structure doit être présenté avant migration. Toutes les tables métier portent `egliseId` (dénormalisé même quand il se déduit d'une relation) pour que la Row-Level Security s'applique simplement, table par table.

```prisma
enum Role { ADMIN RESPONSABLE ACCUEIL MONITEUR INFIRMERIE ECRAN }   // rôles DANS une église
enum StatutPresence { PRESENT EN_SALLE INFIRMERIE RECUPERE }
enum StatutSession { PLANIFIEE OUVERTE CLOTUREE }
enum StatutEglise { ACTIVE SUSPENDUE }
enum TypeIncident { BLESSURE MALAISE COMPORTEMENT ENFANT_INTROUVABLE RETRAIT_NON_AUTORISE AUTRE }

// ---------- Plateforme (hors RLS)

model Eglise {
  id              String       @id @default(cuid())
  nom             String
  slug            String       @unique          // utilisé par /ecran/[slug]
  logoKey         String?                       // logo principal (fonds clairs)
  logoClairKey    String?                       // variante claire (fonds sombres)
  telephoneAccueil String?
  adresse         String?
  fuseau          String       @default("Africa/Porto-Novo")
  statut          StatutEglise @default(ACTIVE)
  ecranToken      String       @unique          // jeton de l'écran d'appel
  prochainMatricule Int        @default(1)      // compteur par église (RG-01)
  createdAt       DateTime     @default(now())
  membres         Membre[]
}

model User {
  id          String   @id @default(cuid())
  nom         String
  email       String?  @unique
  telephone   String?  @unique
  superAdmin  Boolean  @default(false)          // seul rôle global
  actif       Boolean  @default(true)
  createdAt   DateTime @default(now())
  membres     Membre[]
  // + tables de session/compte gérées par Better Auth (la session stocke egliseActiveId)
}

model Membre {
  id          String  @id @default(cuid())
  egliseId    String
  eglise      Eglise  @relation(fields: [egliseId], references: [id])
  userId      String
  user        User    @relation(fields: [userId], references: [id])
  roles       Role[]
  pinHash     String?
  badgeToken  String? @unique                   // QR du badge moniteur
  actif       Boolean @default(true)
  @@unique([egliseId, userId])
}

model AccesSupport {
  id          String   @id @default(cuid())
  egliseId    String
  userId      String                           // super-administrateur
  motif       String
  debut       DateTime @default(now())
  fin         DateTime
}

// ---------- Données d'une église (toutes avec egliseId + RLS)

model Famille {
  id          String   @id @default(cuid())
  egliseId    String
  nom         String
  notes       String?
  consentementDonnees DateTime?
  consentementPhotos  DateTime?
  tuteurs     Tuteur[]
  enfants     Enfant[]
  autorises   PersonneAutorisee[]
  cartes      CarteFamille[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([egliseId, nom])
}

model Tuteur {
  id          String  @id @default(cuid())
  egliseId    String
  familleId   String
  famille     Famille @relation(fields: [familleId], references: [id])
  prenom      String
  nom         String
  lien        String
  telephone   String
  telephone2  String?
  whatsapp    String?
  principal   Boolean @default(false)
  @@index([egliseId, telephone])
}

model PersonneAutorisee {
  id          String  @id @default(cuid())
  egliseId    String
  familleId   String
  famille     Famille @relation(fields: [familleId], references: [id])
  tuteurId    String? @unique
  prenom      String
  nom         String
  lien        String
  telephone   String?
  photoKey    String          // obligatoire
  actif       Boolean @default(true)
}

model Enfant {
  id            String   @id @default(cuid())
  egliseId      String
  matricule     String           // HK-0001, unique dans l'église
  familleId     String
  famille       Famille  @relation(fields: [familleId], references: [id])
  prenom        String
  nom           String
  dateNaissance DateTime @db.Date
  sexe          String?
  photoKey      String?
  alertes       String[]
  alerteDetail  String?
  classeForceeId String?
  actif         Boolean  @default(true)
  presences     Presence[]
  @@unique([egliseId, matricule])
}

model CarteFamille {
  id         String   @id @default(cuid())
  egliseId   String
  familleId  String
  famille    Famille  @relation(fields: [familleId], references: [id])
  token      String   @unique   // HKF1.xxxx, globalement unique, sans matricule ni église
  emiseLe    DateTime @default(now())
  revoqueeLe DateTime?
}

model Classe {
  id            String  @id @default(cuid())
  egliseId      String
  nom           String
  ageMinMois    Int
  ageMaxMois    Int
  salle         String?
  capacite      Int?
  minMoniteurs  Int     @default(2)
  ordre         Int     @default(0)
  active        Boolean @default(true)
}

model Culte {
  id         String  @id @default(cuid())
  egliseId   String
  nom        String
  jour       Int
  heureDebut String
  heureFin   String
  actif      Boolean @default(true)
}

model Session {
  id        String        @id @default(cuid())
  egliseId  String
  culteId   String?
  date      DateTime      @db.Date
  debut     DateTime
  fin       DateTime
  statut    StatutSession @default(PLANIFIEE)
  classesOuvertes SessionClasse[]
  presences Presence[]
  @@unique([egliseId, culteId, date])
}

model SessionClasse {
  id           String  @id @default(cuid())
  egliseId     String
  sessionId    String
  session      Session @relation(fields: [sessionId], references: [id])
  classeId     String
  ouverteLe    DateTime?
  forcageMotif String?
  forcePar     String?
  moniteurs    AffectationMoniteur[]
  @@unique([sessionId, classeId])
}

model AffectationMoniteur {
  id              String   @id @default(cuid())
  egliseId        String
  sessionClasseId String
  sessionClasse   SessionClasse @relation(fields: [sessionClasseId], references: [id])
  membreId        String
  arrivee         DateTime @default(now())
  depart          DateTime?
}

model Presence {
  id           String         @id @default(cuid())
  egliseId     String
  sessionId    String
  session      Session        @relation(fields: [sessionId], references: [id])
  enfantId     String
  enfant       Enfant         @relation(fields: [enfantId], references: [id])
  classeId     String
  statut       StatutPresence
  codeRetrait  String
  appelParent  Boolean        @default(false)
  checkinPar   String
  checkinLe    DateTime       @default(now())
  enSalleLe    DateTime?
  recupereLe   DateTime?
  recuperePar  String?
  remisPar     String?
  basculeVers  String?
  evenements   EvenementPresence[]
  @@index([egliseId, sessionId, statut])
}

model EvenementPresence {
  id         String   @id @default(cuid())
  egliseId   String
  presenceId String
  presence   Presence @relation(fields: [presenceId], references: [id])
  type       String
  detail     Json?
  userId     String
  createdAt  DateTime @default(now())
}

model Appel {
  id         String   @id @default(cuid())
  egliseId   String
  presenceId String
  motif      String
  lieu       String
  creeLe     DateTime @default(now())
  resoluLe   DateTime?
  creePar    String
}

model AppelTelephonique {
  id         String   @id @default(cuid())
  egliseId   String
  presenceId String?
  enfantId   String
  numero     String
  canal      String
  resultat   String?
  userId     String
  createdAt  DateTime @default(now())
}

model Incident {
  id          String       @id @default(cuid())
  egliseId    String
  sessionId   String?
  enfantId    String?
  type        TypeIncident
  description String
  mesures     String?
  declarePar  String
  createdAt   DateTime     @default(now())
  clotureLe   DateTime?
}

model AuditLog {
  id        String   @id @default(cuid())
  egliseId  String?          // null = action de plateforme
  userId    String?
  action    String
  entite    String
  entiteId  String
  avant     Json?
  apres     Json?
  appareil  String?
  createdAt DateTime @default(now())
  @@index([egliseId, entite, entiteId])
}

model Parametre {
  egliseId String
  cle      String
  valeur   Json
  @@id([egliseId, cle])
}

// Exemple de politique RLS, à générer dans la migration pour chaque table métier :
// ALTER TABLE "Enfant" ENABLE ROW LEVEL SECURITY;
// ALTER TABLE "Enfant" FORCE ROW LEVEL SECURITY;
// CREATE POLICY tenant_isolation ON "Enfant"
//   USING ("egliseId" = current_setting('app.eglise_id', true))
//   WITH CHECK ("egliseId" = current_setting('app.eglise_id', true));
```

## 12. Architecture et organisation du code

```
harvest-kids/
├─ CLAUDE.md
├─ docs/                       cahier des charges, décisions (ADR), guide d'exploitation
├─ design/                     tokens, charte, logos (fournis)
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts                  données de démonstration (familles, classes, cultes)
├─ public/                     logos, icônes PWA, manifest
├─ src/
│  ├─ app/
│  │  ├─ (auth)/connexion/
│  │  ├─ (app)/                layout avec barre d'application et verrouillage PIN
│  │  │  ├─ accueil/           tableau de bord en direct, check-in, check-out
│  │  │  ├─ classe/[id]/       vue moniteur
│  │  │  ├─ infirmerie/
│  │  │  ├─ familles/          liste, fiche, inscription, import
│  │  │  ├─ sessions/          ouverture, transition, clôture
│  │  │  ├─ rapports/
│  │  │  └─ admin/
│  │  ├─ plateforme/           administration des églises (SUPER_ADMIN)
│  │  ├─ ecran/[slug]/         écran d'appel d'une église (jeton d'écran)
│  │  └─ api/                  route handlers : flux en direct, photos, PDF, santé
│  ├─ components/
│  │  ├─ ui/                   shadcn restylés
│  │  └─ hk/                   NotchCard, ChildCard, StatusPill, CallBoard, Scanner…
│  ├─ features/                logique par domaine (checkin, checkout, sessions, familles…)
│  ├─ lib/                     auth, rbac, tenant (getTenantDb, église active), db, storage, qr, audit, dates, live-query
│  └─ server/                  services métier appelés par les actions
├─ tests/
│  ├─ unit/
│  └─ e2e/
├─ docker/
│  ├─ Dockerfile
│  ├─ docker-compose.yml       app + postgres + caddy (prod)
│  ├─ docker-compose.dev.yml   postgres local
│  └─ Caddyfile
└─ .github/workflows/          ci.yml, deploy.yml
```

Principes :

- La logique métier (règles RG-xx) vit dans `src/server/` et est testée unitairement ; les Server Actions ne font que valider l'entrée (Zod), vérifier le rôle, appeler le service et écrire l'audit.
- Un seul module `lib/rbac.ts` décrit qui peut faire quoi ; aucun contrôle de rôle uniquement côté client.
- Un seul point d'entrée vers les données d'une église : `lib/tenant.ts` (`getEgliseActive()`, `getTenantDb()`), qui lit l'église de la session, vérifie l'appartenance de l'utilisateur, ouvre la transaction avec `SET LOCAL app.eglise_id` et renvoie le client Prisma scopé.
- Le stockage des photos passe par une interface `Storage` (`put`, `get`, `delete`) avec les pilotes `local` et `vercel-blob`, choisis par variable d'environnement.
- `useLiveQuery` encapsule le rafraîchissement en direct pour pouvoir passer plus tard à SSE.

## 13. Environnements et déploiement

| Environnement | Hébergement | Base de données | Photos | Déclenchement |
|---|---|---|---|---|
| Développement | Poste local | PostgreSQL dans Docker (`docker-compose.dev.yml`) | dossier local | `pnpm dev` |
| Test / recette | **Vercel** (déploiements de prévisualisation par branche) | Neon (PostgreSQL serverless, branche par environnement) | Vercel Blob | Push sur une branche ou une PR |
| Production | **VPS Hostinger** (Ubuntu 24.04 LTS) | PostgreSQL 16 en conteneur, volume persistant | Volume Docker `uploads` | Tag `v*` ou merge sur `main` après validation |

Production sur le VPS :

- Docker Compose avec trois services : `app` (image Next.js `standalone`), `db` (postgres:16), `caddy` (reverse proxy, certificats HTTPS automatiques Let's Encrypt).
- Images construites par GitHub Actions et publiées sur GitHub Container Registry ; déploiement par SSH : `docker compose pull && docker compose up -d`, puis `prisma migrate deploy`.
- Pare-feu : seuls les ports 22, 80 et 443 ouverts ; connexion SSH par clé uniquement ; PostgreSQL non exposé.
- Sauvegardes : `pg_dump` quotidien + archive des photos, chiffrés et envoyés hors du VPS (rclone vers un stockage externe), rétention 30 jours ; snapshot Hostinger hebdomadaire.
- Route `/api/sante` pour la supervision (Uptime Kuma ou équivalent).
- Données de test : **jamais de vraies données d'enfants sur Vercel** ; la recette se fait avec le jeu de démonstration du seed.

Variables d'environnement (à documenter dans `.env.example`) : `DATABASE_URL` (rôle applicatif soumis à la RLS), `DATABASE_MIGRATION_URL` (rôle propriétaire pour les migrations), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STORAGE_DRIVER`, `BLOB_READ_WRITE_TOKEN`, `UPLOADS_DIR`, `DEFAULT_TIMEZONE`, `SUPER_ADMIN_EMAIL` (création du premier super-administrateur), `SENTRY_DSN`.

Une seule instance de production sert toutes les églises. Les sauvegardes couvrent toutes les églises ; l'export par église (section 3 bis) permet de restituer ou de transférer les données d'une seule église.

## 14. Design

Le design system **Harvest Kids** fait foi. Fichiers fournis dans `design/` :

- `charte.md` : principes, couleurs, typographie, formes, ton des textes ;
- `tokens.css` : bloc `@theme` Tailwind v4 et la carte à encoche, à importer dans `globals.css` ;
- `composants-reference.css` et `composant-*.md` : comportement attendu des composants Button, StatusPill, NotchCard, ChildCard, CallBoard ;
- `logo/` : logo principal, négatif, sans baseline, icône (SVG et PNG).

Inspirations de mise en page retenues du modèle fourni : en-tête bleu nuit avec logo à gauche et action principale en pilule à droite ; cartes à grands arrondis avec encoche découpée ; alternance de cartes colorées pleines (rose, bleu layette, nuit, soleil) et de cartes blanches ; gros chiffres en Fredoka pour les indicateurs ; petites pastilles arrondies pour les tranches d'âge.

**Identité visuelle de l'église et de l'application.** L'interface reste aux couleurs de Harvest Kids, mais l'église doit se sentir chez elle :

- en-tête de l'application : logo de l'église à gauche et nom de l'église, sélecteur d'église si l'utilisateur en a plusieurs ; le logo Harvest Kids n'apparaît que sur l'écran de connexion et dans le pied de page (« Harvest Kids »), en petit ;
- carte famille et badge moniteur : logo de l'église uniquement (sections 7.1 et 7.10) ;
- écran d'appel : logo de l'église en variante claire.

Le gabarit de la carte famille garde la structure du design system (fond `blanc`, bandeau `nuit` ou couleur douce, matricules en Fredoka) pour qu'un logo d'église de n'importe quelle couleur y reste lisible.

Correspondance des statuts et couleurs : voir `composant-StatusPill.md`. Le rose plein est réservé au check-out et aux surfaces décoratives ; le bleu plein à l'action principale.

## 15. Plan de livraison

Chaque lot se termine par une démonstration sur l'environnement Vercel et une validation avant de passer au suivant.

| Lot | Contenu | Critères d'acceptation |
|---|---|---|
| **0. Fondations** | Projet Next.js, Tailwind + tokens, shadcn, Prisma + schéma, **socle multi-églises** (`Eglise`, `Membre`, église active en session, `getTenantDb()`, politiques RLS, espace `/plateforme`), Better Auth + rôles par église + PIN, layout tablette, composants `hk/`, seed avec **deux églises de démonstration**, CI (lint, types, tests), déploiement Vercel, Dockerfile et compose | Connexion par rôle et choix de l'église ; un utilisateur de l'église A ne voit aucune donnée de l'église B, y compris par une requête forcée (test automatique) ; page de démonstration des composants fidèle au design system ; CI verte ; build Docker qui démarre en local |
| **1. Familles et cartes** | Profil de l'église et téléversement du logo, inscription famille (tuteurs, enfants, personnes autorisées, photos, consentements), recherche, matricules par église, carte famille PDF au logo de l'église, révocation, import CSV, badges moniteurs | Une famille de 3 enfants s'inscrit en moins de 5 minutes ; la carte imprimée porte le logo de l'église et se scanne ; une carte révoquée est refusée ; une carte de l'église A est refusée dans l'église B |
| **2. Sessions, check-in, check-out** | Cultes et sessions, ouverture des classes à 2 moniteurs, check-in, vue moniteur et confirmation en salle, check-out avec vérification des personnes autorisées, code de retrait | Check-in famille < 15 s ; classe à 1 moniteur bloquée ; retrait par personne non autorisée bloqué et tracé en incident |
| **3. Infirmerie, appels, urgence** | Infirmerie, appel parent, écran d'appel `/ecran`, bouton urgence avec journal des appels, incidents | **Test e2e du scénario d'origine** : un enfant envoyé à l'infirmerie est signalé au check-out et sur l'écran d'appel en moins de 5 s |
| **4. Transition et pilotage** | Double colonne départs / arrivées, alertes de non-récupération, bascule entre sessions, clôture, tableaux de bord, rapports et exports, audit consultable | Clôture impossible avec un enfant non récupéré sans justification ; rapports exportables |
| **5. Robustesse et borne** | File d'attente hors connexion pour le check-in, mode borne (plein écran, scan seul, sans navigation), préparation impression d'étiquettes, déploiement production sur le VPS Hostinger, sauvegardes et restauration testée | Coupure réseau de 2 minutes pendant des check-in sans perte ; restauration de sauvegarde réussie sur un VPS vierge |

## 16. Tests

- Unitaires (Vitest) pour chaque règle RG-xx dans `src/server/`.
- Bout en bout (Playwright, viewport 1280 × 800 et 800 × 1280) pour les parcours : inscription, check-in, confirmation en salle, infirmerie, appel, check-out autorisé, check-out refusé, transition entre cultes.
- **Tests d'isolation multi-églises** (obligatoires, dans la CI) : pour chaque service et chaque route, vérifier qu'un utilisateur de l'église A ne peut ni lire, ni modifier, ni deviner l'existence d'une donnée de l'église B ; vérifier qu'une requête exécutée sans église active est refusée par la RLS.
- Un jeu de données de démonstration réaliste généré par le seed : deux églises, chacune avec 20 à 40 familles (noms béninois variés), 4 classes et 2 cultes, et un utilisateur membre des deux églises.

## 17. Points à valider par l'équipe des leaders

1. Les tranches d'âge exactes des classes et le nom de chaque classe.
2. Une carte par famille (proposé) ou une carte par enfant.
3. Le check-out se fait-il uniquement à l'accueil, ou aussi à la porte des classes ?
4. Les horaires exacts des deux cultes et le délai d'alerte après la fin du culte 1.
5. Qui imprime et plastifie les cartes, et sur quel matériel.
6. Le lieu de rendez-vous à afficher sur l'écran d'appel (accueil enfants, infirmerie, autre).
7. La durée de conservation des données.
8. Le nom de domaine de la plateforme et qui joue le rôle d'exploitant (super-administrateur) et de sous-traitant des données.
9. Les paramètres par défaut créés pour une nouvelle église (classes, cultes, textes de consentement).
