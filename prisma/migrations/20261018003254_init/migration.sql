-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RESPONSABLE', 'ACCUEIL', 'MONITEUR', 'INFIRMERIE', 'ECRAN');

-- CreateEnum
CREATE TYPE "StatutPresence" AS ENUM ('PRESENT', 'EN_SALLE', 'INFIRMERIE', 'RECUPERE');

-- CreateEnum
CREATE TYPE "StatutSession" AS ENUM ('PLANIFIEE', 'OUVERTE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "StatutEglise" AS ENUM ('ACTIVE', 'SUSPENDUE');

-- CreateEnum
CREATE TYPE "TypeIncident" AS ENUM ('BLESSURE', 'MALAISE', 'COMPORTEMENT', 'ENFANT_INTROUVABLE', 'RETRAIT_NON_AUTORISE', 'AUTRE');

-- CreateTable
CREATE TABLE "Eglise" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoKey" TEXT,
    "logoClairKey" TEXT,
    "telephoneAccueil" TEXT,
    "adresse" TEXT,
    "fuseau" TEXT NOT NULL DEFAULT 'Africa/Porto-Novo',
    "statut" "StatutEglise" NOT NULL DEFAULT 'ACTIVE',
    "ecranToken" TEXT NOT NULL,
    "prochainMatricule" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Eglise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "telephone" TEXT,
    "telephoneVerifie" BOOLEAN NOT NULL DEFAULT false,
    "superAdmin" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membre" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roles" "Role"[],
    "pinHash" TEXT,
    "pinEchecs" INTEGER NOT NULL DEFAULT 0,
    "pinBloqueJusqua" TIMESTAMP(3),
    "badgeToken" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccesSupport" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccesSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPlateforme" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "egliseId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "appareil" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditPlateforme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "egliseActiveId" TEXT,
    "derniereActivite" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Famille" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "notes" TEXT,
    "consentementDonnees" TIMESTAMP(3),
    "consentementPhotos" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Famille_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tuteur" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "familleId" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "lien" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "telephone2" TEXT,
    "whatsapp" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Tuteur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonneAutorisee" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "familleId" TEXT NOT NULL,
    "tuteurId" TEXT,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "lien" TEXT NOT NULL,
    "telephone" TEXT,
    "photoKey" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PersonneAutorisee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enfant" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "familleId" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "dateNaissance" DATE NOT NULL,
    "sexe" TEXT,
    "photoKey" TEXT,
    "alertes" TEXT[],
    "alerteDetail" TEXT,
    "notes" TEXT,
    "classeForceeId" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enfant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarteFamille" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "familleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "emiseLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoqueeLe" TIMESTAMP(3),

    CONSTRAINT "CarteFamille_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classe" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "ageMinMois" INTEGER NOT NULL,
    "ageMaxMois" INTEGER NOT NULL,
    "salle" TEXT,
    "capacite" INTEGER,
    "minMoniteurs" INTEGER NOT NULL DEFAULT 2,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Classe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Culte" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "jour" INTEGER NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Culte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "culteId" TEXT,
    "date" DATE NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "statut" "StatutSession" NOT NULL DEFAULT 'PLANIFIEE',
    "clotureMotif" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionClasse" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "classeId" TEXT NOT NULL,
    "ouverteLe" TIMESTAMP(3),
    "forcageMotif" TEXT,
    "forcePar" TEXT,

    CONSTRAINT "SessionClasse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffectationMoniteur" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "sessionClasseId" TEXT NOT NULL,
    "membreId" TEXT NOT NULL,
    "renfort" BOOLEAN NOT NULL DEFAULT false,
    "arrivee" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depart" TIMESTAMP(3),

    CONSTRAINT "AffectationMoniteur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enfantId" TEXT NOT NULL,
    "classeId" TEXT NOT NULL,
    "statut" "StatutPresence" NOT NULL,
    "codeRetrait" TEXT NOT NULL,
    "appelParent" BOOLEAN NOT NULL DEFAULT false,
    "checkinPar" TEXT NOT NULL,
    "checkinLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enSalleLe" TIMESTAMP(3),
    "recupereLe" TIMESTAMP(3),
    "recuperePar" TEXT,
    "remisPar" TEXT,
    "basculeVers" TEXT,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvenementPresence" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "presenceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" JSONB,
    "userId" TEXT NOT NULL,
    "appareil" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvenementPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appel" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "presenceId" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "lieu" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resoluLe" TIMESTAMP(3),
    "creePar" TEXT NOT NULL,

    CONSTRAINT "Appel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppelTelephonique" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "presenceId" TEXT,
    "enfantId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "resultat" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppelTelephonique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "enfantId" TEXT,
    "type" "TypeIncident" NOT NULL,
    "description" TEXT NOT NULL,
    "personnes" TEXT,
    "mesures" TEXT,
    "declarePar" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clotureLe" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "avant" JSONB,
    "apres" JSONB,
    "appareil" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parametre" (
    "egliseId" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "valeur" JSONB NOT NULL,

    CONSTRAINT "Parametre_pkey" PRIMARY KEY ("egliseId","cle")
);

-- CreateIndex
CREATE UNIQUE INDEX "Eglise_slug_key" ON "Eglise"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Eglise_ecranToken_key" ON "Eglise"("ecranToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_telephone_key" ON "User"("telephone");

-- CreateIndex
CREATE UNIQUE INDEX "Membre_badgeToken_key" ON "Membre"("badgeToken");

-- CreateIndex
CREATE INDEX "Membre_userId_idx" ON "Membre"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membre_egliseId_userId_key" ON "Membre"("egliseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membre_id_egliseId_key" ON "Membre"("id", "egliseId");

-- CreateIndex
CREATE INDEX "AccesSupport_egliseId_fin_idx" ON "AccesSupport"("egliseId", "fin");

-- CreateIndex
CREATE INDEX "AuditPlateforme_createdAt_idx" ON "AuditPlateforme"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRateLimit_key_key" ON "AuthRateLimit"("key");

-- CreateIndex
CREATE INDEX "Famille_egliseId_nom_idx" ON "Famille"("egliseId", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "Famille_id_egliseId_key" ON "Famille"("id", "egliseId");

-- CreateIndex
CREATE INDEX "Tuteur_egliseId_telephone_idx" ON "Tuteur"("egliseId", "telephone");

-- CreateIndex
CREATE INDEX "Tuteur_familleId_idx" ON "Tuteur"("familleId");

-- CreateIndex
CREATE UNIQUE INDEX "Tuteur_id_egliseId_key" ON "Tuteur"("id", "egliseId");

-- CreateIndex
CREATE INDEX "PersonneAutorisee_familleId_idx" ON "PersonneAutorisee"("familleId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonneAutorisee_tuteurId_egliseId_key" ON "PersonneAutorisee"("tuteurId", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonneAutorisee_id_egliseId_key" ON "PersonneAutorisee"("id", "egliseId");

-- CreateIndex
CREATE INDEX "Enfant_familleId_idx" ON "Enfant"("familleId");

-- CreateIndex
CREATE INDEX "Enfant_egliseId_nom_prenom_idx" ON "Enfant"("egliseId", "nom", "prenom");

-- CreateIndex
CREATE UNIQUE INDEX "Enfant_egliseId_matricule_key" ON "Enfant"("egliseId", "matricule");

-- CreateIndex
CREATE UNIQUE INDEX "Enfant_id_egliseId_key" ON "Enfant"("id", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "CarteFamille_token_key" ON "CarteFamille"("token");

-- CreateIndex
CREATE UNIQUE INDEX "CarteFamille_id_egliseId_key" ON "CarteFamille"("id", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "CarteFamille_une_active_par_famille" ON "CarteFamille"("familleId") WHERE ("revoqueeLe" IS NULL);

-- CreateIndex
CREATE INDEX "Classe_egliseId_ordre_idx" ON "Classe"("egliseId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "Classe_id_egliseId_key" ON "Classe"("id", "egliseId");

-- CreateIndex
CREATE INDEX "Culte_egliseId_idx" ON "Culte"("egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "Culte_id_egliseId_key" ON "Culte"("id", "egliseId");

-- CreateIndex
CREATE INDEX "Session_egliseId_date_idx" ON "Session"("egliseId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Session_egliseId_culteId_date_key" ON "Session"("egliseId", "culteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Session_id_egliseId_key" ON "Session"("id", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionClasse_sessionId_classeId_key" ON "SessionClasse"("sessionId", "classeId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionClasse_id_egliseId_key" ON "SessionClasse"("id", "egliseId");

-- CreateIndex
CREATE INDEX "AffectationMoniteur_egliseId_sessionClasseId_idx" ON "AffectationMoniteur"("egliseId", "sessionClasseId");

-- CreateIndex
CREATE INDEX "Presence_egliseId_sessionId_statut_idx" ON "Presence"("egliseId", "sessionId", "statut");

-- CreateIndex
CREATE INDEX "Presence_sessionId_codeRetrait_idx" ON "Presence"("sessionId", "codeRetrait");

-- CreateIndex
CREATE UNIQUE INDEX "Presence_id_egliseId_key" ON "Presence"("id", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "Presence_basculeVers_egliseId_key" ON "Presence"("basculeVers", "egliseId");

-- CreateIndex
CREATE UNIQUE INDEX "Presence_une_ouverte_par_enfant" ON "Presence"("enfantId") WHERE (statut <> 'RECUPERE' AND "basculeVers" IS NULL);

-- CreateIndex
CREATE INDEX "EvenementPresence_presenceId_createdAt_idx" ON "EvenementPresence"("presenceId", "createdAt");

-- CreateIndex
CREATE INDEX "Appel_egliseId_resoluLe_idx" ON "Appel"("egliseId", "resoluLe");

-- CreateIndex
CREATE INDEX "AppelTelephonique_egliseId_enfantId_idx" ON "AppelTelephonique"("egliseId", "enfantId");

-- CreateIndex
CREATE INDEX "Incident_egliseId_sessionId_idx" ON "Incident"("egliseId", "sessionId");

-- CreateIndex
CREATE INDEX "AuditLog_egliseId_entite_entiteId_idx" ON "AuditLog"("egliseId", "entite", "entiteId");

-- CreateIndex
CREATE INDEX "AuditLog_egliseId_createdAt_idx" ON "AuditLog"("egliseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccesSupport" ADD CONSTRAINT "AccesSupport_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccesSupport" ADD CONSTRAINT "AccesSupport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Famille" ADD CONSTRAINT "Famille_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tuteur" ADD CONSTRAINT "Tuteur_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tuteur" ADD CONSTRAINT "Tuteur_familleId_egliseId_fkey" FOREIGN KEY ("familleId", "egliseId") REFERENCES "Famille"("id", "egliseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonneAutorisee" ADD CONSTRAINT "PersonneAutorisee_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonneAutorisee" ADD CONSTRAINT "PersonneAutorisee_familleId_egliseId_fkey" FOREIGN KEY ("familleId", "egliseId") REFERENCES "Famille"("id", "egliseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonneAutorisee" ADD CONSTRAINT "PersonneAutorisee_tuteurId_egliseId_fkey" FOREIGN KEY ("tuteurId", "egliseId") REFERENCES "Tuteur"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enfant" ADD CONSTRAINT "Enfant_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enfant" ADD CONSTRAINT "Enfant_familleId_egliseId_fkey" FOREIGN KEY ("familleId", "egliseId") REFERENCES "Famille"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enfant" ADD CONSTRAINT "Enfant_classeForceeId_egliseId_fkey" FOREIGN KEY ("classeForceeId", "egliseId") REFERENCES "Classe"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarteFamille" ADD CONSTRAINT "CarteFamille_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarteFamille" ADD CONSTRAINT "CarteFamille_familleId_egliseId_fkey" FOREIGN KEY ("familleId", "egliseId") REFERENCES "Famille"("id", "egliseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Culte" ADD CONSTRAINT "Culte_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_culteId_egliseId_fkey" FOREIGN KEY ("culteId", "egliseId") REFERENCES "Culte"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionClasse" ADD CONSTRAINT "SessionClasse_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionClasse" ADD CONSTRAINT "SessionClasse_sessionId_egliseId_fkey" FOREIGN KEY ("sessionId", "egliseId") REFERENCES "Session"("id", "egliseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionClasse" ADD CONSTRAINT "SessionClasse_classeId_egliseId_fkey" FOREIGN KEY ("classeId", "egliseId") REFERENCES "Classe"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionClasse" ADD CONSTRAINT "SessionClasse_forcePar_fkey" FOREIGN KEY ("forcePar") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffectationMoniteur" ADD CONSTRAINT "AffectationMoniteur_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffectationMoniteur" ADD CONSTRAINT "AffectationMoniteur_sessionClasseId_egliseId_fkey" FOREIGN KEY ("sessionClasseId", "egliseId") REFERENCES "SessionClasse"("id", "egliseId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffectationMoniteur" ADD CONSTRAINT "AffectationMoniteur_membreId_egliseId_fkey" FOREIGN KEY ("membreId", "egliseId") REFERENCES "Membre"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_sessionId_egliseId_fkey" FOREIGN KEY ("sessionId", "egliseId") REFERENCES "Session"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_enfantId_egliseId_fkey" FOREIGN KEY ("enfantId", "egliseId") REFERENCES "Enfant"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_classeId_egliseId_fkey" FOREIGN KEY ("classeId", "egliseId") REFERENCES "Classe"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_recuperePar_egliseId_fkey" FOREIGN KEY ("recuperePar", "egliseId") REFERENCES "PersonneAutorisee"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_basculeVers_egliseId_fkey" FOREIGN KEY ("basculeVers", "egliseId") REFERENCES "Presence"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementPresence" ADD CONSTRAINT "EvenementPresence_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementPresence" ADD CONSTRAINT "EvenementPresence_presenceId_egliseId_fkey" FOREIGN KEY ("presenceId", "egliseId") REFERENCES "Presence"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_presenceId_egliseId_fkey" FOREIGN KEY ("presenceId", "egliseId") REFERENCES "Presence"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_presenceId_egliseId_fkey" FOREIGN KEY ("presenceId", "egliseId") REFERENCES "Presence"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppelTelephonique" ADD CONSTRAINT "AppelTelephonique_enfantId_egliseId_fkey" FOREIGN KEY ("enfantId", "egliseId") REFERENCES "Enfant"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_sessionId_egliseId_fkey" FOREIGN KEY ("sessionId", "egliseId") REFERENCES "Session"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_enfantId_egliseId_fkey" FOREIGN KEY ("enfantId", "egliseId") REFERENCES "Enfant"("id", "egliseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parametre" ADD CONSTRAINT "Parametre_egliseId_fkey" FOREIGN KEY ("egliseId") REFERENCES "Eglise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
