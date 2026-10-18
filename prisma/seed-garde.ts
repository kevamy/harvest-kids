/**
 * Guard of the demonstration seed. A local database (development, CI) is always
 * allowed. Any other database (Neon test environment) requires HK_SEED_DEMO=autorise
 * and a chosen SEED_MOT_DE_PASSE: the repository is public, so the default
 * demonstration password must never protect a reachable deployment.
 * Production never runs the seed: the Docker image does not contain it.
 */
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type DecisionSeed = { autorise: true } | { autorise: false; raison: string };

export function autorisationSeed(env: Record<string, string | undefined>): DecisionSeed {
  let hote: string;
  try {
    hote = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    return { autorise: false, raison: "DATABASE_URL est absente ou invalide." };
  }
  if (HOTES_LOCAUX.has(hote)) return { autorise: true };

  if (env.HK_SEED_DEMO !== "autorise") {
    return {
      autorise: false,
      raison:
        "Base distante : le seed de démonstration exige HK_SEED_DEMO=autorise (environnement de test uniquement).",
    };
  }
  if (!env.SEED_MOT_DE_PASSE || env.SEED_MOT_DE_PASSE.length < 12) {
    return {
      autorise: false,
      raison:
        "Base distante : choisissez SEED_MOT_DE_PASSE (12 caractères au moins) ; le mot de passe par défaut est public.",
    };
  }
  return { autorise: true };
}
