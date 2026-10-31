-- Harvest Kids — lot 1, étape 6 : badges moniteurs (RG-02, RG-03, RG-14, ADR 0008).
-- L'empreinte du badge quitte Membre (table de plateforme, un seul badge connu) pour la table
-- d'église BadgeMoniteur, qui garde l'historique : un badge remplacé est refusé avec son propre
-- message. Structure générée par `prisma migrate diff`, complétée à la main (copie, garde-fou,
-- RLS, politique du propriétaire, fonction RG-14).

-- CreateTable
CREATE TABLE "BadgeMoniteur" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "emisLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoqueLe" TIMESTAMP(3),

    CONSTRAINT "BadgeMoniteur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BadgeMoniteur_tokenHash_key" ON "BadgeMoniteur"("tokenHash");

-- CreateIndex
CREATE INDEX "BadgeMoniteur_egliseId_membreId_idx" ON "BadgeMoniteur"("egliseId", "membreId");

-- CreateIndex
CREATE UNIQUE INDEX "BadgeMoniteur_id_egliseId_key" ON "BadgeMoniteur"("id", "egliseId");

-- Au plus un badge non révoqué par membre.
CREATE UNIQUE INDEX "BadgeMoniteur_un_actif_par_membre" ON "BadgeMoniteur"("membreId") WHERE ("revoqueLe" IS NULL);

-- AddForeignKey
ALTER TABLE "BadgeMoniteur" ADD CONSTRAINT "BadgeMoniteur_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeMoniteur" ADD CONSTRAINT "BadgeMoniteur_membreId_egliseId_fkey" FOREIGN KEY ("membreId", "egliseId") REFERENCES "Membre"("id", "egliseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Table d'église : RLS activée, forcée, et sa politique dans la même migration (ADR 0002).
-- Les droits de hk_app viennent des droits par défaut posés par la migration rls.
ALTER TABLE "BadgeMoniteur" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BadgeMoniteur" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BadgeMoniteur"
  USING ("egliseId" = hk_eglise_active())
  WITH CHECK ("egliseId" = hk_eglise_active());

-- ---------------------------------------------------------------------
-- Copie des badges existants, église par église (RLS forcée, y compris pour le propriétaire).
-- Le badge d'un membre désactivé ou sans rôle MONITEUR est copié révoqué : il serait refusé.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    INSERT INTO "BadgeMoniteur" ("id", "egliseId", "membreId", "tokenHash", "emisLe", "revoqueLe")
      SELECT 'badge_' || m."id", m."egliseId", m."id", m."badgeTokenHash", m."updatedAt",
             CASE WHEN m."actif" AND 'MONITEUR' = ANY (m."roles") THEN NULL ELSE now() END
      FROM "Membre" m
      WHERE m."egliseId" = e.id AND m."badgeTokenHash" IS NOT NULL;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
END
$$;

-- Garde-fou avant de supprimer la colonne : chaque empreinte de Membre doit se retrouver,
-- identique, dans BadgeMoniteur pour le même membre et la même église. Sinon la migration
-- échoue ; elle s'exécute dans une transaction, donc rien n'est perdu.
DO $$
DECLARE
  e record;
  attendues integer;
  copiees integer := 0;
  n integer;
BEGIN
  SELECT count(*) INTO attendues FROM "Membre" WHERE "badgeTokenHash" IS NOT NULL;
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    SELECT count(*) INTO n FROM "BadgeMoniteur" b
      JOIN "Membre" m ON m."id" = b."membreId" AND m."egliseId" = b."egliseId"
      WHERE b."egliseId" = e.id AND b."tokenHash" = m."badgeTokenHash";
    copiees := copiees + n;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
  IF copiees <> attendues THEN
    RAISE EXCEPTION 'Migration interrompue : % empreinte(s) de badge sur % copiée(s), Membre conservé.',
      copiees, attendues;
  END IF;
END
$$;

-- DropIndex
DROP INDEX "Membre_badgeTokenHash_key";

-- AlterTable
ALTER TABLE "Membre" DROP COLUMN "badgeTokenHash";

-- ---------------------------------------------------------------------
-- RG-14 : la politique de lecture du propriétaire, posée sur CarteFamille au lot 1, est étendue
-- à BadgeMoniteur, en lecture seule. Elle ne sert qu'à la fonction SECURITY DEFINER ci-dessous ;
-- hk_app n'est ni propriétaire ni membre de ce rôle.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY rg14_lecture_proprietaire ON "BadgeMoniteur" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;

-- Même contrat qu'au lot 1 : un booléen seulement, jamais d'identifiant, de nom ni d'église.
-- Un badge compte quel que soit son état (comme une carte) : un badge révoqué d'une autre
-- église reste « d'une autre église ».
CREATE OR REPLACE FUNCTION hk_jeton_autre_eglise(p_empreinte text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT CASE
      WHEN p_empreinte IS NULL
        OR p_empreinte !~ '^[0-9a-f]{64}$'
        OR hk_eglise_active() IS NULL
      THEN false
      ELSE EXISTS (
             SELECT 1 FROM "CarteFamille"
             WHERE "tokenHash" = p_empreinte AND "egliseId" <> hk_eglise_active()
           )
        OR EXISTS (
             SELECT 1 FROM "BadgeMoniteur"
             WHERE "tokenHash" = p_empreinte AND "egliseId" <> hk_eglise_active()
           )
    END
  $$;

REVOKE ALL ON FUNCTION hk_jeton_autre_eglise(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hk_jeton_autre_eglise(text) TO hk_app;
