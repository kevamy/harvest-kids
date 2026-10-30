-- Harvest Kids — lot 1 : empreintes des jetons, cycle de vie des cartes, réémission groupée,
-- familles en brouillon et fonction RG-14.
-- Structure générée par `prisma migrate diff`, complétée à la main (reprise des données,
-- Row-Level Security, fonction SECURITY DEFINER). Voir docs/decisions/0008-cartes-et-jetons.md.

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
CREATE TYPE "ModeCarte" AS ENUM ('FAMILLE', 'ENFANT');

-- ---------------------------------------------------------------------
-- Empreintes des jetons (ADR 0002 et 0008) : la base ne garde que le SHA-256 du jeton.
-- Les lignes existantes sont converties avant la suppression des colonnes en clair.
-- ---------------------------------------------------------------------
DROP INDEX "CarteFamille_token_key";
DROP INDEX "CarteFamille_une_active_par_famille";
DROP INDEX "Membre_badgeToken_key";

ALTER TABLE "CarteFamille"
  ADD COLUMN "tokenHash" TEXT,
  ADD COLUMN "enfantId" TEXT,
  ADD COLUMN "activeLe" TIMESTAMP(3),
  ADD COLUMN "reemissionId" TEXT;

ALTER TABLE "Famille" ADD COLUMN "finaliseeLe" TIMESTAMP(3);

-- FORCE ROW LEVEL SECURITY s'applique aussi au rôle qui exécute la migration : sans
-- app.eglise_id, un UPDATE ne verrait aucune ligne. On reprend les données église par église,
-- comme le seed, sans jamais lever la RLS. Le réglage est local à la transaction.
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    UPDATE "CarteFamille"
      SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'),
          -- Les cartes émises avant le lot 1 étaient actives dès leur émission.
          "activeLe" = "emiseLe";
    -- Les familles existantes ont été inscrites complètes : elles sont finalisées.
    UPDATE "Famille" SET "finaliseeLe" = "createdAt";
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
END
$$;

ALTER TABLE "Membre" ADD COLUMN "badgeTokenHash" TEXT;
UPDATE "Membre" SET "badgeTokenHash" = encode(sha256(convert_to("badgeToken", 'UTF8')), 'hex')
  WHERE "badgeToken" IS NOT NULL;

-- Garde-fou avant de supprimer les jetons en clair : chaque carte et chaque badge doit avoir
-- une empreinte bien formée. Sinon la migration échoue ; elle s'exécute dans une transaction,
-- donc rien n'est perdu. Le contrôle des cartes se fait dans chaque église (RLS forcée) ;
-- toute carte appartient à une église existante (clé étrangère), donc toutes sont vues.
DO $$
DECLARE
  e record;
  manquantes integer := 0;
  n integer;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    SELECT count(*) INTO n FROM "CarteFamille"
      WHERE "tokenHash" IS NULL OR "tokenHash" !~ '^[0-9a-f]{64}$';
    manquantes := manquantes + n;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
  IF manquantes > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % carte(s) sans empreinte valide, jetons conservés.', manquantes;
  END IF;

  SELECT count(*) INTO n FROM "Membre"
    WHERE "badgeToken" IS NOT NULL
      AND ("badgeTokenHash" IS NULL OR "badgeTokenHash" !~ '^[0-9a-f]{64}$');
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % badge(s) sans empreinte valide, jetons conservés.', n;
  END IF;
END
$$;

ALTER TABLE "CarteFamille" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE "CarteFamille" DROP COLUMN "token";
ALTER TABLE "Membre" DROP COLUMN "badgeToken";

-- ---------------------------------------------------------------------
-- Familles en brouillon (import CSV) : sans matricule tant qu'elles ne sont pas finalisées
-- (Famille.finaliseeLe, ajoutée et reprise plus haut).
-- ---------------------------------------------------------------------
ALTER TABLE "Enfant" ALTER COLUMN "matricule" DROP NOT NULL;

-- ---------------------------------------------------------------------
-- Réémission groupée (RG-16)
-- ---------------------------------------------------------------------
CREATE TABLE "ReemissionCartes" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "mode" "ModeCarte" NOT NULL,
    "dateLimite" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creePar" TEXT NOT NULL,

    CONSTRAINT "ReemissionCartes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReemissionCartes_egliseId_creeLe_idx" ON "ReemissionCartes"("egliseId", "creeLe");
CREATE UNIQUE INDEX "ReemissionCartes_id_egliseId_key" ON "ReemissionCartes"("id", "egliseId");

ALTER TABLE "ReemissionCartes" ADD CONSTRAINT "ReemissionCartes_egliseId_fkey"
  FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Table d'église : RLS activée, forcée, et sa politique dans la même migration (ADR 0002).
-- Les droits de hk_app viennent des droits par défaut posés par la migration rls.
ALTER TABLE "ReemissionCartes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReemissionCartes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReemissionCartes"
  USING ("egliseId" = hk_eglise_active())
  WITH CHECK ("egliseId" = hk_eglise_active());

-- ---------------------------------------------------------------------
-- Index et clés des cartes
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "CarteFamille_tokenHash_key" ON "CarteFamille"("tokenHash");
CREATE INDEX "CarteFamille_familleId_idx" ON "CarteFamille"("familleId");
CREATE INDEX "CarteFamille_reemissionId_idx" ON "CarteFamille"("reemissionId");

-- Au plus une carte active et une carte en attente par couverture (famille ou enfant).
CREATE UNIQUE INDEX "CarteFamille_famille_active" ON "CarteFamille"("familleId")
  WHERE ("revoqueeLe" IS NULL AND "activeLe" IS NOT NULL AND "enfantId" IS NULL);
CREATE UNIQUE INDEX "CarteFamille_enfant_active" ON "CarteFamille"("enfantId")
  WHERE ("revoqueeLe" IS NULL AND "activeLe" IS NOT NULL AND "enfantId" IS NOT NULL);
CREATE UNIQUE INDEX "CarteFamille_famille_en_attente" ON "CarteFamille"("familleId")
  WHERE ("revoqueeLe" IS NULL AND "activeLe" IS NULL AND "enfantId" IS NULL);
CREATE UNIQUE INDEX "CarteFamille_enfant_en_attente" ON "CarteFamille"("enfantId")
  WHERE ("revoqueeLe" IS NULL AND "activeLe" IS NULL AND "enfantId" IS NOT NULL);

CREATE UNIQUE INDEX "Enfant_id_familleId_egliseId_key" ON "Enfant"("id", "familleId", "egliseId");
CREATE UNIQUE INDEX "Membre_badgeTokenHash_key" ON "Membre"("badgeTokenHash");

-- Une carte enfant désigne un enfant de la même famille et de la même église.
ALTER TABLE "CarteFamille" ADD CONSTRAINT "CarteFamille_enfantId_familleId_egliseId_fkey"
  FOREIGN KEY ("enfantId", "familleId", "egliseId") REFERENCES "Enfant"("id", "familleId", "egliseId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarteFamille" ADD CONSTRAINT "CarteFamille_reemissionId_egliseId_fkey"
  FOREIGN KEY ("reemissionId", "egliseId") REFERENCES "ReemissionCartes"("id", "egliseId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- RG-14 : « Cette carte n'appartient pas à cette église. »
-- ---------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY s'applique aussi au propriétaire : une fonction SECURITY DEFINER
-- ne verrait que l'église active. Cette politique, réservée au rôle qui exécute les migrations
-- (hk_owner en local et sur le VPS, neondb_owner sur Neon), lui ouvre la lecture des cartes.
-- Elle ne donne rien de plus au propriétaire, qui peut déjà désactiver la RLS ; hk_app n'est
-- ni propriétaire ni membre de ce rôle.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY rg14_lecture_proprietaire ON "CarteFamille" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;

-- Ne renvoie qu'un booléen : le jeton (par son empreinte) existe-t-il dans une autre église ?
-- Jamais d'identifiant, de nom ni d'église. Faux sans église active ou si l'empreinte n'a pas
-- la forme d'un SHA-256 hexadécimal. search_path fixé : un objet de pg_temp ne peut pas
-- remplacer les tables de public.
CREATE FUNCTION hk_jeton_autre_eglise(p_empreinte text) RETURNS boolean
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
             SELECT 1 FROM "Membre"
             WHERE "badgeTokenHash" = p_empreinte AND "egliseId" <> hk_eglise_active()
           )
    END
  $$;

REVOKE ALL ON FUNCTION hk_jeton_autre_eglise(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hk_jeton_autre_eglise(text) TO hk_app;
