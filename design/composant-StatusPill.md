# StatusPill
Pastille qui affiche le statut d'un enfant pendant une session de culte ; chaque statut a une seule couleur, partout dans l'application.

| Classe | Statut | Couleurs |
|---|---|---|
| `hk-pill--attendu` | Inscrit, pas encore arrivé | `blanc` + bordure `ligne`, texte `texte-doux` |
| `hk-pill--present` | Scanné à l'accueil, en route vers sa classe | `bleu-voile`, texte `nuit` |
| `hk-pill--en-salle` | Confirmé par un moniteur de la classe | `bleu-layette`, texte `nuit` |
| `hk-pill--appel` | Le parent est appelé (écran ou téléphone) | `soleil`, texte `nuit` |
| `hk-pill--infirmerie` | L'enfant est à l'infirmerie | `alerte`, texte `blanc` |
| `hk-pill--recupere` | Remis à une personne autorisée | `succes`, texte `blanc` |

Le point coloré et le libellé portent le sens ensemble : ne jamais afficher la couleur seule. `hk-pill--outline` sert aux étiquettes neutres (tranche d'âge) sur une carte colorée.
