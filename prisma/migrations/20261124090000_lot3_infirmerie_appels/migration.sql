-- Harvest Kids — lot 3 : infirmerie, appels des parents, journal des appels, écran d'appel,
-- incidents (cahier §7.7, §7.8, §7.9, RG-07, RG-09, RG-10 ; ADR 0018 et 0019). Structure
-- générée par `prisma migrate diff`, complétée à la main (garde-fous, contraintes CHECK, droits
-- par colonne, déclencheurs, RLS).

-- ---------------------------------------------------------------------
-- Garde-fous : les nouvelles contraintes doivent être respectées par les données existantes.
-- Ces tables n'ont jamais été écrites par l'application avant le lot 3 ; si une donnée les
-- contredit, la migration échoue avec un message clair, dans sa transaction, sans rien
-- modifier. Comptage église par église (RLS forcée, y compris pour le propriétaire).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  e record;
  infirmerie integer := 0;
  appels integer := 0;
  telephoniques integer := 0;
  incidents integer := 0;
  n integer;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    SELECT count(*) INTO n FROM "Presence"
      WHERE "egliseId" = e.id AND "statut" = 'INFIRMERIE';
    infirmerie := infirmerie + n;
    -- Un appel déjà résolu n'a pas de résolution ; un motif hors liste ; deux appels ouverts.
    SELECT count(*) INTO n FROM "Appel"
      WHERE "egliseId" = e.id
        AND ("resoluLe" IS NOT NULL
             OR "motif" NOT IN ('pleurs', 'change', 'soins', 'comportement', 'autre'));
    appels := appels + n;
    SELECT count(*) - count(DISTINCT "presenceId") INTO n FROM "Appel"
      WHERE "egliseId" = e.id AND "resoluLe" IS NULL;
    appels := appels + n;
    SELECT count(*) INTO n FROM "AppelTelephonique"
      WHERE "egliseId" = e.id
        AND ("resultat" IS NOT NULL
             OR "canal" NOT IN ('tel', 'whatsapp')
             OR "numero" !~ '^[+][1-9][0-9]{7,14}$');
    telephoniques := telephoniques + n;
    SELECT count(*) INTO n FROM "Incident"
      WHERE "egliseId" = e.id AND "clotureLe" IS NOT NULL;
    incidents := incidents + n;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
  IF infirmerie > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % présence(s) déjà au statut INFIRMERIE, sans heure d''envoi.',
      infirmerie;
  END IF;
  IF appels > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % appel(s) de parent contraire(s) aux nouvelles règles (motif, résolution, un seul ouvert par présence).',
      appels;
  END IF;
  IF telephoniques > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % appel(s) téléphonique(s) contraire(s) aux nouvelles règles (canal, numéro, résultat).',
      telephoniques;
  END IF;
  IF incidents > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % incident(s) clos sans auteur de la clôture.',
      incidents;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Écran d'appel : le jeton en clair de l'église disparaît (jamais utilisé), remplacé par les
-- écrans appairés (ADR 0018).
-- ---------------------------------------------------------------------
-- DropIndex
DROP INDEX "Eglise_ecranToken_key";

-- AlterTable
ALTER TABLE "Eglise" DROP COLUMN "ecranToken";

-- CreateTable
CREATE TABLE "EcranAppareil" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "jetonHash" TEXT NOT NULL,
    "jetonExpireLe" TIMESTAMP(3) NOT NULL,
    "appaireLe" TIMESTAMP(3),
    "appareilHash" TEXT,
    "derniereVue" TIMESTAMP(3),
    "creePar" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoqueLe" TIMESTAMP(3),
    "revoquePar" TEXT,

    CONSTRAINT "EcranAppareil_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EcranAppareil_nom_non_vide" CHECK (btrim("nom") <> ''),
    -- Un appareil appairé a son secret ; un lien non consommé n'en a pas.
    CONSTRAINT "EcranAppareil_appairage" CHECK (("appaireLe" IS NULL) = ("appareilHash" IS NULL)),
    CONSTRAINT "EcranAppareil_revocation" CHECK (("revoqueLe" IS NULL) = ("revoquePar" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "EcranAppareil_jetonHash_key" ON "EcranAppareil"("jetonHash");

-- CreateIndex
CREATE UNIQUE INDEX "EcranAppareil_appareilHash_key" ON "EcranAppareil"("appareilHash");

-- CreateIndex
CREATE INDEX "EcranAppareil_egliseId_idx" ON "EcranAppareil"("egliseId");

-- AddForeignKey
ALTER TABLE "EcranAppareil" ADD CONSTRAINT "EcranAppareil_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Table de plateforme (hors RLS, comme JetonCompte) : l'écran est reconnu par son cookie avant
-- qu'on connaisse l'église ; seul src/server/plateforme/ecran.ts y accède. Jamais effacée par
-- l'application (historique des écrans) ; seules les colonnes d'appairage, de dernière vue et
-- de révocation se modifient.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "EcranAppareil" FROM hk_app;
GRANT UPDATE ("appaireLe", "appareilHash", "derniereVue", "revoqueLe", "revoquePar")
  ON TABLE "EcranAppareil" TO hk_app;

-- Un appairage ne se refait pas et une révocation ne se lève pas : on révoque puis on recrée.
CREATE FUNCTION hk_ecran_appareil_garde() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."appaireLe" IS NOT NULL
     AND (NEW."appaireLe" IS DISTINCT FROM OLD."appaireLe"
          OR NEW."appareilHash" IS DISTINCT FROM OLD."appareilHash") THEN
    RAISE EXCEPTION 'Écran déjà appairé : révoquez-le et créez-en un autre.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."revoqueLe" IS NOT NULL
     AND (NEW."revoqueLe" IS DISTINCT FROM OLD."revoqueLe"
          OR NEW."revoquePar" IS DISTINCT FROM OLD."revoquePar") THEN
    RAISE EXCEPTION 'Écran révoqué : la révocation est définitive.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "EcranAppareil_garde" BEFORE UPDATE ON "EcranAppareil"
  FOR EACH ROW EXECUTE FUNCTION hk_ecran_appareil_garde();

-- ---------------------------------------------------------------------
-- Présence : infirmerie (ADR 0019). Le drapeau appelParent, jamais écrit ni lu, laisse la
-- place à l'appel ouvert (table Appel).
-- ---------------------------------------------------------------------
-- AlterTable
ALTER TABLE "Presence" DROP COLUMN "appelParent",
ADD COLUMN     "infirmerieLe" TIMESTAMP(3),
ADD COLUMN     "infirmerieRecueLe" TIMESTAMP(3),
ADD COLUMN     "retourInfirmerieLe" TIMESTAMP(3);

-- L'heure d'envoi existe si et seulement si l'enfant est à l'infirmerie (ou en route) ; la
-- réception suppose un envoi.
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_infirmerie_statut" CHECK (
  ("statut" = 'INFIRMERIE') = ("infirmerieLe" IS NOT NULL)
);
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_infirmerie_recue" CHECK (
  "infirmerieRecueLe" IS NULL OR "infirmerieLe" IS NOT NULL
);

-- ---------------------------------------------------------------------
-- Appels des parents
-- ---------------------------------------------------------------------
-- AlterTable
ALTER TABLE "Appel" ADD COLUMN     "resoluPar" TEXT,
ADD COLUMN     "resolution" TEXT;

ALTER TABLE "Appel" ADD CONSTRAINT "Appel_motif" CHECK (
  "motif" IN ('pleurs', 'change', 'soins', 'comportement', 'autre')
);
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_lieu_non_vide" CHECK (btrim("lieu") <> '');
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_resolution" CHECK (
  "resolution" IS NULL OR "resolution" IN ('parent_arrive', 'annule', 'recupere')
);
-- Résolu le, résolution et résolu par : tous nuls ou tous renseignés.
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_resolution_complete" CHECK (
  ("resoluLe" IS NULL) = ("resolution" IS NULL) AND ("resoluLe" IS NULL) = ("resoluPar" IS NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "Appel_un_ouvert_par_presence" ON "Appel"("presenceId") WHERE ("resoluLe" IS NULL);

-- Seule la résolution se pose, une fois.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "Appel" FROM hk_app;
GRANT UPDATE ("resoluLe", "resolution", "resoluPar") ON TABLE "Appel" TO hk_app;

CREATE FUNCTION hk_appel_resolution_seule() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."resoluLe" IS NOT NULL
     OR (to_jsonb(NEW) - 'resoluLe' - 'resolution' - 'resoluPar')
        IS DISTINCT FROM (to_jsonb(OLD) - 'resoluLe' - 'resolution' - 'resoluPar') THEN
    RAISE EXCEPTION 'Appel déjà résolu, ou modification autre que sa résolution.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Appel_resolution_seule" BEFORE UPDATE ON "Appel"
  FOR EACH ROW EXECUTE FUNCTION hk_appel_resolution_seule();

-- ---------------------------------------------------------------------
-- Journal des appels téléphoniques (bouton Urgence) : en ajout seul, sauf le résultat, posé
-- une fois.
-- ---------------------------------------------------------------------
-- AlterTable
ALTER TABLE "AppelTelephonique" ADD COLUMN     "resultatLe" TIMESTAMP(3);

ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_canal" CHECK (
  "canal" IN ('tel', 'whatsapp')
);
ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_resultat" CHECK (
  "resultat" IS NULL OR "resultat" IN ('joint', 'pas_de_reponse', 'messagerie')
);
ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_resultat_date" CHECK (
  ("resultat" IS NULL) = ("resultatLe" IS NULL)
);
-- Numéro au format E.164 (ADR 0011).
ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_numero_e164" CHECK (
  "numero" ~ '^[+][1-9][0-9]{7,14}$'
);

-- CreateIndex
CREATE INDEX "AppelTelephonique_presenceId_createdAt_idx" ON "AppelTelephonique"("presenceId", "createdAt");

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AppelTelephonique" FROM hk_app;
GRANT UPDATE ("resultat", "resultatLe") ON TABLE "AppelTelephonique" TO hk_app;

CREATE FUNCTION hk_appel_telephonique_resultat_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."resultat" IS NOT NULL
     OR (to_jsonb(NEW) - 'resultat' - 'resultatLe')
        IS DISTINCT FROM (to_jsonb(OLD) - 'resultat' - 'resultatLe') THEN
    RAISE EXCEPTION 'Résultat de l''appel déjà noté, ou modification du journal.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "AppelTelephonique_resultat_seul" BEFORE UPDATE ON "AppelTelephonique"
  FOR EACH ROW EXECUTE FUNCTION hk_appel_telephonique_resultat_seul();

-- ---------------------------------------------------------------------
-- Incidents : contenu figé une fois déclaré ; seule la clôture se pose, une fois. Les
-- compléments passent par IncidentNote, en ajout seul (RG-09).
-- ---------------------------------------------------------------------
-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "cloturePar" TEXT;

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_cloture_complete" CHECK (
  ("clotureLe" IS NULL) = ("cloturePar" IS NULL)
);

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "Incident" FROM hk_app;
GRANT UPDATE ("clotureLe", "cloturePar") ON TABLE "Incident" TO hk_app;

CREATE FUNCTION hk_incident_cloture_seule() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD."clotureLe" IS NOT NULL
     OR (to_jsonb(NEW) - 'clotureLe' - 'cloturePar')
        IS DISTINCT FROM (to_jsonb(OLD) - 'clotureLe' - 'cloturePar') THEN
    RAISE EXCEPTION 'Incident déjà clos, ou modification de son contenu : ajoutez une note.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Incident_cloture_seule" BEFORE UPDATE ON "Incident"
  FOR EACH ROW EXECUTE FUNCTION hk_incident_cloture_seule();

-- CreateTable
CREATE TABLE "IncidentNote" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "auteur" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IncidentNote_texte_non_vide" CHECK (btrim("texte") <> '')
);

-- CreateIndex
CREATE INDEX "IncidentNote_incidentId_createdAt_idx" ON "IncidentNote"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_incidentId_egliseId_fkey" FOREIGN KEY ("incidentId", "egliseId") REFERENCES "Incident"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Table d'église : RLS activée, forcée, et sa politique dans la même migration (ADR 0002).
ALTER TABLE "IncidentNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncidentNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IncidentNote"
  USING ("egliseId" = hk_eglise_active())
  WITH CHECK ("egliseId" = hk_eglise_active());

-- En ajout seul : hk_app garde SELECT et INSERT (droits par défaut de la migration rls).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "IncidentNote" FROM hk_app;
