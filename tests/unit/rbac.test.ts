import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ActionInterdite,
  droitsPresence,
  droitsSalle,
  exigerDroit,
  peut,
} from "@/lib/rbac";

/** Expected rights on a presence card, in the order of droitsPresence. */
const droits = (
  voir: boolean,
  appeler: boolean,
  envoyer: boolean,
  gerer: boolean,
  declarer: boolean,
) => ({ voir, appeler, envoyer, gerer, declarer });

describe("droits par rôle (cahier §4)", () => {
  it("l'administrateur peut tout dans son église", () => {
    for (const action of ACTIONS) expect(peut(["ADMIN"], action), action).toBe(true);
  });

  it("le rôle ECRAN n'a aucun droit : l'écran d'appel est un appareil appairé (ADR 0018)", () => {
    for (const action of ACTIONS) expect(peut(["ECRAN"], action), action).toBe(false);
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

  it.each([
    // Every child of the church; the reception desk neither sends, receives nor declares.
    [["ACCUEIL"], false, droits(true, true, false, false, false)],
    [["INFIRMERIE"], false, droits(true, true, true, true, true)],
    [["RESPONSABLE"], false, droits(true, true, true, true, true)],
    [["ADMIN"], false, droits(true, true, true, true, true)],
    // A MONITEUR: the children of the class they are assigned to, only; sends, never receives.
    [["MONITEUR"], true, droits(true, true, true, false, true)],
    [["MONITEUR"], false, droits(false, false, false, false, false)],
    [["ECRAN"], false, droits(false, false, false, false, false)],
  ] as const)("fiche de présence : %j, affecté %s → %j", (roles, affecte, attendu) => {
    expect(droitsPresence(roles, affecte)).toEqual(attendu);
  });

  it("exigerDroit lève une erreur explicite", () => {
    expect(() => exigerDroit({ roles: ["MONITEUR"] }, "checkout")).toThrow(ActionInterdite);
    expect(() => exigerDroit({ roles: ["ACCUEIL"] }, "checkout")).not.toThrow();
  });
});
