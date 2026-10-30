import { describe, expect, it } from "vitest";
import {
  DELAI_VERROUILLAGE_MS,
  INTERVALLE_ENREGISTREMENT_MS,
  doitEnregistrerActivite,
  estVerrouillee,
} from "@/lib/activite";
import { analyserIdentifiant, normaliserTelephone } from "@/lib/identifiant";
import {
  DUREE_BLOCAGE_PIN_MS,
  ETAT_PIN_INITIAL,
  MAX_ECHECS_PIN,
  apresEchecPin,
  formatPinValide,
  pinBloque,
} from "@/lib/pin";

const T0 = new Date("2026-10-18T08:00:00Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);

describe("identifiant de connexion", () => {
  it.each([
    ["Kofi.Agbo@Exemple.org ", { type: "email", valeur: "kofi.agbo@exemple.org" }],
    ["+229 01 97 00 00 00", { type: "telephone", valeur: "+2290197000000" }],
    ["01 97 00 00 00", { type: "telephone", valeur: "+2290197000000" }],
    ["97 00 00 00", { type: "telephone", valeur: "+22997000000" }],
    ["00229 0197000000", { type: "telephone", valeur: "+2290197000000" }],
  ])("reconnaît %s", (saisie, attendu) => {
    expect(analyserIdentifiant(saisie)).toEqual(attendu);
  });

  it.each(["", "kofi@", "abc", "12345"])("refuse %s", (saisie) => {
    expect(analyserIdentifiant(saisie)).toBeNull();
  });

  it("ne transforme pas un numéro international déjà normalisé", () => {
    expect(normaliserTelephone("+33612345678")).toBe("+33612345678");
  });
});

describe("verrouillage après inactivité", () => {
  it("verrouille à 15 minutes sans activité, pas avant", () => {
    expect(estVerrouillee(T0, plus(DELAI_VERROUILLAGE_MS - 1))).toBe(false);
    expect(estVerrouillee(T0, plus(DELAI_VERROUILLAGE_MS))).toBe(true);
    expect(estVerrouillee(null, T0)).toBe(false);
  });

  it("n'enregistre l'activité qu'une fois par minute au plus", () => {
    expect(doitEnregistrerActivite(null, T0)).toBe(true);
    expect(doitEnregistrerActivite(T0, plus(INTERVALLE_ENREGISTREMENT_MS - 1))).toBe(false);
    expect(doitEnregistrerActivite(T0, plus(INTERVALLE_ENREGISTREMENT_MS))).toBe(true);
  });
});

describe("code PIN", () => {
  it.each(["482913", "205871"])("accepte %s", (pin) => {
    expect(formatPinValide(pin)).toBe(true);
  });

  it.each(["12345", "1234567", "12a456", "000000", "123456", "654321", "890123"])(
    "refuse %s",
    (pin) => {
      expect(formatPinValide(pin)).toBe(false);
    },
  );

  it(`bloque après ${MAX_ECHECS_PIN} échecs, pendant 15 minutes`, () => {
    let etat = ETAT_PIN_INITIAL;
    for (let i = 1; i < MAX_ECHECS_PIN; i++) {
      etat = apresEchecPin(etat, T0);
      expect(pinBloque(etat, T0)).toBe(false);
    }
    etat = apresEchecPin(etat, T0);
    expect(etat.pinEchecs).toBe(MAX_ECHECS_PIN);
    expect(pinBloque(etat, plus(DUREE_BLOCAGE_PIN_MS - 1))).toBe(true);
    expect(pinBloque(etat, plus(DUREE_BLOCAGE_PIN_MS))).toBe(false);
  });
});
