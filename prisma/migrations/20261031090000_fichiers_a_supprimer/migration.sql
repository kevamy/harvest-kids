-- Harvest Kids — lot 1, étape 3 : fichiers remplacés supprimés en différé (24 h) par la tâche
-- quotidienne. Structure générée par `prisma migrate diff`, complétée à la main (RLS).

-- CreateTable
CREATE TABLE "FichierASupprimer" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "apresLe" TIMESTAMP(3) NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FichierASupprimer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FichierASupprimer_apresLe_idx" ON "FichierASupprimer"("apresLe");

-- CreateIndex
CREATE UNIQUE INDEX "FichierASupprimer_id_egliseId_key" ON "FichierASupprimer"("id", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "FichierASupprimer_egliseId_cle_key" ON "FichierASupprimer"("egliseId", "cle");

-- AddForeignKey
ALTER TABLE "FichierASupprimer" ADD CONSTRAINT "FichierASupprimer_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Table d'église : RLS activée, forcée, et sa politique dans la même migration (ADR 0002).
-- Les droits de hk_app viennent des droits par défaut posés par la migration rls.
ALTER TABLE "FichierASupprimer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FichierASupprimer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FichierASupprimer"
  USING ("egliseId" = hk_eglise_active())
  WITH CHECK ("egliseId" = hk_eglise_active());
