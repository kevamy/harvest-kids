-- Harvest Kids — lot 2, étape 2 : sessions, moniteurs et retrait exceptionnel (cahier §7.2,
-- §7.6, RG-05, RG-06, RG-08). Structure générée par `prisma migrate diff`, complétée à la main
-- (garde-fous, contraintes CHECK, RLS, droits).

-- ---------------------------------------------------------------------
-- Garde-fous : les nouvelles contraintes doivent être respectées par les données existantes.
-- Sinon la migration échoue avec un message clair ; elle s'exécute dans une transaction,
-- donc rien n'est modifié. Comptage église par église (RLS forcée, y compris pour le
-- propriétaire).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  e record;
  presences integer := 0;
  affectations integer := 0;
  n integer;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    SELECT count(*) INTO n FROM "Presence"
      WHERE "egliseId" = e.id AND "statut" = 'RECUPERE' AND "recuperePar" IS NULL;
    presences := presences + n;
    SELECT count(*) - count(DISTINCT "membreId") INTO n FROM "AffectationMoniteur"
      WHERE "egliseId" = e.id AND "depart" IS NULL;
    affectations := affectations + n;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
  IF presences > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % présence(s) RECUPERE sans personne qui a récupéré l''enfant.',
      presences;
  END IF;
  IF affectations > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % affectation(s) de moniteur active(s) en double.',
      affectations;
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "RetraitExceptionnel" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "familleId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "lien" TEXT,
    "telephone" TEXT,
    "photoKey" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "autorisePar" TEXT NOT NULL,
    "remisPar" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetraitExceptionnel_pkey" PRIMARY KEY ("id"),
    -- Téléphone de l'adulte, facultatif, au format E.164 (ADR 0011).
    CONSTRAINT "RetraitExceptionnel_telephone_e164" CHECK (
      "telephone" IS NULL OR "telephone" ~ '^[+][1-9][0-9]{7,14}$'
    )
);

-- AlterTable
ALTER TABLE "Presence" ADD COLUMN     "retraitExceptionnelId" TEXT;

-- Qui a récupéré l'enfant : une personne autorisée OU un retrait exceptionnel, jamais les
-- deux ; un statut RECUPERE exige l'un des deux (donc exactement un).
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_un_seul_recuperateur" CHECK (
  "recuperePar" IS NULL OR "retraitExceptionnelId" IS NULL
);
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_recupere_par_quelquun" CHECK (
  "statut" <> 'RECUPERE' OR "recuperePar" IS NOT NULL OR "retraitExceptionnelId" IS NOT NULL
);

-- CreateIndex
CREATE INDEX "RetraitExceptionnel_egliseId_sessionId_idx" ON "RetraitExceptionnel"("egliseId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "RetraitExceptionnel_id_egliseId_key" ON "RetraitExceptionnel"("id", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "RetraitExceptionnel_incidentId_egliseId_key" ON "RetraitExceptionnel"("incidentId", "egliseId");

-- Un moniteur n'est que dans une classe à la fois (rejoindre une classe termine la précédente).
-- CreateIndex
CREATE UNIQUE INDEX "AffectationMoniteur_une_active_par_membre" ON "AffectationMoniteur"("membreId") WHERE ("depart" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "Incident_id_egliseId_key" ON "Incident"("id", "egliseId");

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_retraitExceptionnelId_egliseId_fkey" FOREIGN KEY ("retraitExceptionnelId", "egliseId") REFERENCES "RetraitExceptionnel"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetraitExceptionnel" ADD CONSTRAINT "RetraitExceptionnel_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetraitExceptionnel" ADD CONSTRAINT "RetraitExceptionnel_sessionId_egliseId_fkey" FOREIGN KEY ("sessionId", "egliseId") REFERENCES "Session"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetraitExceptionnel" ADD CONSTRAINT "RetraitExceptionnel_familleId_egliseId_fkey" FOREIGN KEY ("familleId", "egliseId") REFERENCES "Famille"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetraitExceptionnel" ADD CONSTRAINT "RetraitExceptionnel_autorisePar_fkey" FOREIGN KEY ("autorisePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetraitExceptionnel" ADD CONSTRAINT "RetraitExceptionnel_remisPar_fkey" FOREIGN KEY ("remisPar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetraitExceptionnel" ADD CONSTRAINT "RetraitExceptionnel_incidentId_egliseId_fkey" FOREIGN KEY ("incidentId", "egliseId") REFERENCES "Incident"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Table d'église : RLS activée, forcée, et sa politique dans la même migration (ADR 0002).
ALTER TABLE "RetraitExceptionnel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetraitExceptionnel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetraitExceptionnel"
  USING ("egliseId" = hk_eglise_active())
  WITH CHECK ("egliseId" = hk_eglise_active());

-- Une autorisation de retrait ne se modifie ni ne s'efface (RG-09), comme le journal d'audit :
-- hk_app garde SELECT et INSERT (droits par défaut de la migration rls).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "RetraitExceptionnel" FROM hk_app;
