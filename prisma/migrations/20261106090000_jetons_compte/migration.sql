-- Harvest Kids — lot 1, étape 8 : comptes et rôles (ADR 0014).
-- Liens d'activation d'un compte et de réinitialisation d'un mot de passe. Table de plateforme,
-- hors RLS (comme User et Membre) : la page d'activation est publique et ne connaît pas
-- l'église. Seule l'empreinte SHA-256 du jeton est stockée. L'échéance n'a pas de valeur par
-- défaut : le service la pose en SQL selon le type (now() + 7 jours ou 24 heures).
-- Les droits de hk_app viennent des droits par défaut posés par la migration rls.

-- CreateEnum
CREATE TYPE "TypeJetonCompte" AS ENUM ('ACTIVATION', 'REINITIALISATION');

-- CreateTable
CREATE TABLE "JetonCompte" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "egliseId" TEXT NOT NULL,
    "type" "TypeJetonCompte" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "consommeLe" TIMESTAMP(3),
    "revoqueLe" TIMESTAMP(3),
    "creePar" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JetonCompte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JetonCompte_tokenHash_key" ON "JetonCompte"("tokenHash");

-- CreateIndex
CREATE INDEX "JetonCompte_userId_type_idx" ON "JetonCompte"("userId", "type");

-- AddForeignKey
ALTER TABLE "JetonCompte" ADD CONSTRAINT "JetonCompte_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
