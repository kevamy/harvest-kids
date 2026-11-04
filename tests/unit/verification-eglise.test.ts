import { describe, expect, it } from "vitest";
import { RequeteHorsEglise, verifierArgumentsEglise } from "@/lib/tenant";

const A = "eglise_a";
const B = "eglise_b";
const refuse = (args: unknown) =>
  expect(() => verifierArgumentsEglise(args, A)).toThrow(RequeteHorsEglise);
const accepte = (args: unknown) => expect(() => verifierArgumentsEglise(args, A)).not.toThrow();

describe("barrière applicative : parcours récursif des arguments (ADR 0002)", () => {
  it("accepte une requête sans église ou qui nomme seulement l'église active", () => {
    accepte(undefined);
    accepte({ where: { nom: "X" } });
    accepte({ where: { egliseId: A } });
    accepte({ where: { egliseId: { equals: A } } });
    accepte({ where: { egliseId: { in: [A] } } });
    accepte({ data: { egliseId: { set: A } } });
    accepte({ where: { egliseId_cle: { egliseId: A, cle: "cartes.mode" } } });
  });

  it("refuse une autre église en tête de where ou de data", () => {
    refuse({ where: { egliseId: B } });
    refuse({ data: { egliseId: B } });
    refuse({ data: [{ egliseId: A }, { egliseId: B }] });
    refuse({ create: { egliseId: B }, update: {} });
    refuse({ create: {}, update: { egliseId: B } });
  });

  it("refuse une autre église dans une clé unique composée, quelle qu'elle soit", () => {
    refuse({ where: { egliseId_cle: { egliseId: B, cle: "cartes.mode" } } });
    refuse({ where: { egliseId_matricule: { egliseId: B, matricule: "HK-0001" } } });
    refuse({ where: { une_cle_future: { egliseId: B, autre: 1 } } });
    refuse({ cursor: { id_egliseId: { id: "x", egliseId: B } } });
  });

  it("refuse une autre église dans un filtre ou une écriture imbriqués sur une relation", () => {
    refuse({ where: { famille: { is: { egliseId: B } } } });
    refuse({ where: { enfants: { some: { AND: [{ nom: "X" }, { egliseId: B }] } } } });
    refuse({ where: { OR: [{ nom: "X" }, { NOT: { egliseId: B } }] } });
    refuse({ data: { enfants: { create: [{ prenom: "X", egliseId: B }] } } });
    refuse({ data: { cartes: { connect: { id_egliseId: { id: "c", egliseId: B } } } } });
    refuse({
      data: {
        cartes: {
          connectOrCreate: {
            where: { id_egliseId: { id: "c", egliseId: B } },
            create: { tokenHash: "h" },
          },
        },
      },
    });
    refuse({ data: { enfants: { updateMany: { where: {}, data: { egliseId: B } } } } });
  });

  it("refuse tout filtre sur egliseId autre que l'égalité à l'église active", () => {
    refuse({ where: { egliseId: { not: A } } });
    refuse({ where: { egliseId: { notIn: [A] } } });
    refuse({ where: { egliseId: { in: [A, B] } } });
    refuse({ where: { egliseId: { in: [] } } });
    refuse({ where: { egliseId: { gt: "" } } });
    refuse({ where: { egliseId: { startsWith: "eglise" } } });
    refuse({ where: { egliseId: { equals: A, not: B } } });
    refuse({ where: { egliseId: null } });
    refuse({ where: { egliseId: {} } });
  });

  it("refuse la relation eglise, même pour l'église active", () => {
    refuse({ where: { eglise: { id: A } } });
    refuse({ data: { eglise: { connect: { id: A } } } });
  });

  it("ignore les projections, mais vérifie les requêtes qu'elles contiennent", () => {
    accepte({ select: { egliseId: true, eglise: true }, orderBy: { egliseId: "asc" } });
    accepte({ include: { cartes: { select: { egliseId: true } } } });
    refuse({ include: { cartes: { where: { egliseId: B } } } });
    refuse({ select: { famille: { select: { enfants: { where: { egliseId: B } } } } } });
    refuse({ select: { _count: { select: { cartes: { where: { egliseId: B } } } } } });
  });

  it("ne descend pas dans les dates ni les octets", () => {
    accepte({ data: { emiseLe: new Date(), photo: new Uint8Array([1, 2]) } });
  });
});
