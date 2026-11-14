import { describe, expect, it } from "vitest";
import { ACTIONS, ActionInterdite, droitsSalle, exigerDroit, peut } from "@/lib/rbac";

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
    ["RESPONSABLE", "familles.importer", true],
    ["ACCUEIL", "familles.importer", false],
    ["MONITEUR", "familles.importer", false],
    ["RESPONSABLE", "eglise.parametrer", false],
    ["RESPONSABLE", "classes.gerer", true],
    ["ACCUEIL", "classes.gerer", false],
    ["ACCUEIL", "eglise.parametrer", false],
    ["RESPONSABLE", "salle.superviser", true],
    ["MONITEUR", "salle.superviser", false],
    ["ACCUEIL", "salle.superviser", false],
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

  it.each([
    // Assigned to the class: confirms, whatever the role (monitor or reinforcement).
    [["MONITEUR"], true, { voir: true, confirmer: true, corriger: false }],
    [["ACCUEIL"], true, { voir: true, confirmer: true, corriger: false }],
    // A MONITEUR only sees the class they are assigned to.
    [["MONITEUR"], false, { voir: false, confirmer: false, corriger: false }],
    // RESPONSABLE and ADMIN not assigned: see every class, correct, never confirm.
    [["RESPONSABLE"], false, { voir: true, confirmer: false, corriger: true }],
    [["ADMIN"], false, { voir: true, confirmer: false, corriger: true }],
    [["RESPONSABLE"], true, { voir: true, confirmer: true, corriger: true }],
  ] as const)("arrivée en salle : %j, affecté %s → %j", (roles, affecte, attendu) => {
    expect(droitsSalle(roles, affecte)).toEqual(attendu);
  });

  it("exigerDroit lève une erreur explicite", () => {
    expect(() => exigerDroit({ roles: ["MONITEUR"] }, "checkout")).toThrow(ActionInterdite);
    expect(() => exigerDroit({ roles: ["ACCUEIL"] }, "checkout")).not.toThrow();
  });
});
