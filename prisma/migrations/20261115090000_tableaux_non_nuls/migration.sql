-- Colonnes tableau jamais NULL : Enfant.alertes et Membre.roles (les deux seules colonnes
-- tableau du schéma) deviennent NOT NULL avec la liste vide par défaut. Une requête SQL brute
-- qui lit un tableau NULL fait planter l'écran qui l'affiche (liste de classe, lot 2 étape 4).
-- Les SET DEFAULT sont ceux de `prisma migrate diff` (String[] @default([])) ; Prisma ne sait
-- pas écrire NOT NULL sur une liste : la reprise, le garde-fou et le NOT NULL sont à la main.

-- 1. Reprise des NULL existants. FORCE ROW LEVEL SECURITY s'applique aussi au rôle qui exécute
-- la migration : sans app.eglise_id, un UPDATE sur "Enfant" ne verrait aucune ligne. On reprend
-- église par église, sans jamais lever la RLS (comme cartes_lot1). Le réglage est local à la
-- transaction. "Membre" est une table de plateforme, hors RLS.
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    UPDATE "Enfant" SET "alertes" = ARRAY[]::TEXT[] WHERE "alertes" IS NULL;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
END
$$;

UPDATE "Membre" SET "roles" = ARRAY[]::"Role"[] WHERE "roles" IS NULL;

-- 2. Garde-fou : plus aucun NULL, sinon la migration échoue avec un message clair. Elle
-- s'exécute dans une transaction : rien n'est modifié. Le contrôle des enfants se fait dans
-- chaque église (RLS forcée) ; tout enfant appartient à une église existante (clé étrangère),
-- donc tous sont vus.
DO $$
DECLARE
  e record;
  restants integer := 0;
  n integer;
BEGIN
  FOR e IN SELECT id FROM "Eglise" LOOP
    PERFORM set_config('app.eglise_id', e.id, true);
    SELECT count(*) INTO n FROM "Enfant" WHERE "alertes" IS NULL;
    restants := restants + n;
  END LOOP;
  PERFORM set_config('app.eglise_id', '', true);
  IF restants > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % enfant(s) avec des alertes NULL.', restants;
  END IF;
  SELECT count(*) INTO n FROM "Membre" WHERE "roles" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration interrompue : % membre(s) avec des rôles NULL.', n;
  END IF;
END
$$;

-- 3. Liste vide par défaut, NULL refusé par la base.
ALTER TABLE "Enfant"
  ALTER COLUMN "alertes" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "alertes" SET NOT NULL;

ALTER TABLE "Membre"
  ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"Role"[],
  ALTER COLUMN "roles" SET NOT NULL;
