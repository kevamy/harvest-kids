-- Harvest Kids — lot 1, étape 3 : recherche par téléphone limitée à l'église active (ADR 0011).
-- Sous Row-Level Security, la fin d'un numéro ne peut pas être servie par un index (reverse()
-- n'est pas leakproof) : l'index restreint la recherche aux numéros de l'église.

-- CreateIndex
CREATE INDEX "PersonneAutorisee_egliseId_telephone_idx" ON "PersonneAutorisee"("egliseId", "telephone");

