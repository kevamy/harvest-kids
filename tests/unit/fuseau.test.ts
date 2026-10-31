import { describe, expect, it } from "vitest";
import { ajouterJours, estJourValide, jourLocal, minuitLocal } from "@/lib/fuseau";

describe("jours dans le fuseau de l'église (RG-12)", () => {
  it("lit le jour local d'un instant", () => {
    const instant = new Date("2026-10-31T23:30:00Z");
    expect(jourLocal(instant, "Africa/Porto-Novo")).toBe("2026-11-01");
    expect(jourLocal(instant, "America/New_York")).toBe("2026-10-31");
  });

  it("trouve minuit local, y compris un jour de changement d'heure", () => {
    expect(minuitLocal("2026-11-01", "Africa/Porto-Novo").toISOString()).toBe(
      "2026-10-31T23:00:00.000Z",
    );
    // Paris switches to summer time on 29 March 2026, at 2:00: midnight is still UTC+1.
    expect(minuitLocal("2026-03-29", "Europe/Paris").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(minuitLocal("2026-03-30", "Europe/Paris").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
  });

  it("ajoute des jours et vérifie les dates saisies", () => {
    expect(ajouterJours("2026-12-31", 1)).toBe("2027-01-01");
    expect(ajouterJours("2028-02-28", 1)).toBe("2028-02-29");
    expect(estJourValide("2026-02-29")).toBe(false);
    expect(estJourValide("2026-13-01")).toBe(false);
    expect(estJourValide("31/10/2026")).toBe(false);
    expect(estJourValide("2026-10-31")).toBe(true);
    expect(() => minuitLocal("2026-02-30", "Africa/Porto-Novo")).toThrow(RangeError);
  });
});
