import type { MembreAffectable } from "@/server/moniteurs-session";

type ClasseAvecMoniteurs = { classeId: string; nom: string; moniteurs: { membreId: string }[] };

export type OptionAjout = { membreId: string; libelle: string; renfort: boolean };

/**
 * People the RESPONSABLE can add to a class: never those already in it; for those in another
 * class, the option says so, since adding them makes them leave it. A member without the
 * MONITEUR role joins as a reinforcement.
 */
export function optionsAjout(
  membres: readonly MembreAffectable[],
  classes: readonly ClasseAvecMoniteurs[],
  classeId: string,
): OptionAjout[] {
  const classeDe = new Map(
    classes.flatMap((c) => c.moniteurs.map((m) => [m.membreId, c] as const)),
  );
  return membres
    .filter((m) => classeDe.get(m.membreId)?.classeId !== classeId)
    .map((m) => {
      const ailleurs = classeDe.get(m.membreId);
      const nom = m.moniteur ? m.nom : `${m.nom} (renfort)`;
      return {
        membreId: m.membreId,
        libelle: ailleurs ? `${nom}, dans ${ailleurs.nom}` : nom,
        renfort: !m.moniteur,
      };
    });
}
