-- Harvest Kids — isolation multi-églises (RG-13), journal non modifiable (RG-09).
-- Écrite à la main. Voir docs/decisions/0002-isolation-multi-eglises.md.
--
-- Rôles :
--   propriétaire (celui qui exécute les migrations) : possède les tables ;
--   hk_app : rôle de l'application, NOBYPASSRLS, jamais propriétaire.
-- Le mot de passe et LOGIN de hk_app sont posés hors migration (docs/exploitation.md).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hk_app') THEN
    CREATE ROLE hk_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO hk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hk_app;
-- The migrations ledger is absent from Prisma's shadow database.
DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM hk_app;
  END IF;
END
$$;

-- Journaux non modifiables : lecture et ajout seulement.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog", "AuditPlateforme", "EvenementPresence" FROM hk_app;

-- Tables créées par les migrations futures : mêmes droits par défaut. Une table d'église
-- reste inaccessible tant que sa politique RLS n'existe pas (FORCE + aucune politique = aucune
-- ligne) ; le test de catalogue vérifie que chaque table d'église en a une.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hk_app;

-- ---------------------------------------------------------------------
-- Row-Level Security sur toutes les tables d'église
-- ---------------------------------------------------------------------
-- app.eglise_id est positionné par transaction (set_config(..., true)) par getTenantDb().
-- Non positionné : current_setting renvoie NULL ou '' et aucune ligne n'est visible.

CREATE FUNCTION hk_eglise_active() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.eglise_id', true), '') $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Famille', 'Tuteur', 'PersonneAutorisee', 'Enfant', 'CarteFamille',
    'Classe', 'Culte', 'Session', 'SessionClasse', 'AffectationMoniteur',
    'Presence', 'EvenementPresence', 'Appel', 'AppelTelephonique', 'Incident',
    'AuditLog', 'Parametre'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE : la politique s'applique aussi au propriétaire des tables.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("egliseId" = hk_eglise_active())
         WITH CHECK ("egliseId" = hk_eglise_active())',
      t
    );
  END LOOP;
END
$$;
