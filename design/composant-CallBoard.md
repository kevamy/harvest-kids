# CallBoard
Écran plein format, sur fond `nuit`, projeté en salle de culte pour afficher les matricules des enfants dont le parent doit venir.

- Uniquement des matricules : aucun nom ni photo d'enfant n'est projeté.
- Tuile `soleil` = parent attendu à l'accueil ; `alerte` = infirmerie ; `bleu-layette` = enfant prêt au retrait en fin de culte.
- Lisible à 15 m : matricule à 40 px dans l'aperçu, 96 px et plus en plein écran (`clamp()` côté application).
- Une tuile disparaît dès que l'enfant est récupéré ou que le moniteur annule l'appel.
