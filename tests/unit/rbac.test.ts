import { describe, expect, it } from "vitest";
import { ACTIONS, ActionInterdite, exigerDroit, peut } from "@/lib/rbac";

describe("droits par rôle (cahier §4)", () => {
  it("l'administrateur peut tout dans son église, sauf l'écran d'appel technique", () => {
    for (const action of ACTIONS.filter((a) => a !== "ecran.voir")) {
      expect(peut(["ADMIN"], action), action).toBe(true);
    }
    expect(peut(["ADMIN"], "ecran.voir")).toBe(false);
  });

  it.each([
    ["ACCUEIL", "checkin", true],
    ["ACCUEIL", "checkout", true],
    ["ACCUEIL", "familles.gerer", true],
    ["ACCUEIL", "classe.forcer", false],
    ["ACCUEIL", "comptes.gerer", false],
    ["RESPONSABLE", "sessions.gerer", true],
    ["RESPONSABLE", "classe.forcer", true],
    ["RESPONSABLE", "audit.voir", true],
    ["RESPONSABLE", "checkout", false],
    ["RESPONSABLE", "familles.gerer", true],
    ["RESPONSABLE", "eglise.parametrer", false],
    ["RESPONSABLE", "classes.gerer", true],
    ["ACCUEIL", "classes.gerer", false],
    ["ACCUEIL", "eglise.parametrer", false],
    ["MONITEUR", "enfant.confirmerEnSalle", true],
    ["MONITEUR", "infirmerie.envoyer", true],
    ["MONITEUR", "checkout", false],
    ["MONITEUR", "familles.gerer", false],
    ["INFIRMERIE", "infirmerie.gerer", true],
    ["INFIRMERIE", "alertes.voir", true],
    ["INFIRMERIE", "checkin", false],
    ["ECRAN", "ecran.voir", true],
    ["ECRAN", "tableau.direct", false],
    ["ECRAN", "alertes.voir", false],
  ] as const)("%s → %s : %s", (role, action, attendu) => {
    expect(peut([role], action)).toBe(attendu);
  });

  it("cumule les droits de plusieurs rôles", () => {
    expect(peut(["MONITEUR", "ACCUEIL"], "checkout")).toBe(true);
    expect(peut(["MONITEUR", "ACCUEIL"], "classe.forcer")).toBe(false);
  });

  it("sans rôle, rien n'est permis", () => {
    for (const action of ACTIONS) expect(peut([], action)).toBe(false);
  });

  it("exigerDroit lève une erreur explicite", () => {
    expect(() => exigerDroit({ roles: ["MONITEUR"] }, "checkout")).toThrow(ActionInterdite);
    expect(() => exigerDroit({ roles: ["ACCUEIL"] }, "checkout")).not.toThrow();
  });
});
