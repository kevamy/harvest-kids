-- Harvest Kids — lot 1, étape 7 : import CSV des familles (ADR 0013).
-- Le tuteur d'un brouillon importé peut n'avoir aucun numéro (absent, illisible ou correction
-- non validée). La finalisation l'exige (enregistrerFamille) : une famille finalisée a toujours
-- le téléphone de chacun de ses tuteurs. Pas de reprise de données, RLS et index inchangés.

-- AlterTable
ALTER TABLE "Tuteur" ALTER COLUMN "telephone" DROP NOT NULL;
