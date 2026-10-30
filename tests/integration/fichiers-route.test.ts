/**
 * Authenticated file route /api/fichiers (RG-11, RG-15). Access is decided by the
 * session's active church and the key prefix, never by a token in the URL: a key
 * of another church, a tampered key and a missing file all answer the same 404.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleFichier } from "@/lib/fichiers";
import { creerStockageLocal } from "@/lib/storage/local";

const contexte = vi.hoisted(() => ({
  egliseId: null as string | null,
  dossier: "",
}));

vi.mock("@/lib/tenant", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...original,
    getEgliseActive: vi.fn(async () => {
      if (!contexte.egliseId) throw new original.AccesRefuse("non_authentifie");
      return { egliseId: contexte.egliseId };
    }),
  };
});

// Only stockage() is replaced: storage/local.ts imports this module itself, so the
// factory must not import it back (circular wait at load time).
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  stockage: () => creerStockageLocal(contexte.dossier),
}));

const { GET } = await import("@/app/api/fichiers/[...cle]/route");

const EGLISE_A = "eglise_a";
const EGLISE_B = "eglise_b";
const photoA = cleFichier(EGLISE_A, "photos", "enfant-a.png");
const photoB = cleFichier(EGLISE_B, "photos", "enfant-b.png");

async function demander(cle: string) {
  const reponse = await GET(new Request(`http://localhost/api/fichiers/${cle}`), {
    params: Promise.resolve({ cle: cle.split("/") }),
  });
  return { statut: reponse.status, corps: await reponse.text(), entetes: reponse.headers };
}

beforeAll(async () => {
  contexte.dossier = await mkdtemp(join(tmpdir(), "hk-route-fichiers-"));
  const stockage = creerStockageLocal(contexte.dossier);
  await stockage.put(photoA, new Uint8Array([1, 2, 3]), "image/png");
  await stockage.put(photoB, new Uint8Array([4, 5, 6]), "image/png");
});

afterAll(async () => {
  await rm(contexte.dossier, { recursive: true, force: true });
});

beforeEach(() => {
  contexte.egliseId = EGLISE_A;
});

describe("route /api/fichiers", () => {
  it("sert un fichier de l'église active, sans cache partagé", async () => {
    const { statut, entetes } = await demander(photoA);
    expect(statut).toBe(200);
    expect(entetes.get("content-type")).toBe("image/png");
    expect(entetes.get("cache-control")).toBe("private, max-age=300");
  });

  it("renvoie depuis A le même 404 pour un fichier existant de B que pour un fichier inexistant", async () => {
    const inexistant = await demander(cleFichier(EGLISE_A, "photos", "absent.png"));
    const fichierDeB = await demander(photoB);
    expect(inexistant.statut).toBe(404);
    expect(fichierDeB).toEqual(inexistant);
  });

  it("renvoie le même 404 pour une clé altérée", async () => {
    const reference = await demander(cleFichier(EGLISE_A, "photos", "absent.png"));
    for (const cle of [
      `eglises/${EGLISE_A}/../${EGLISE_B}/photos/enfant-b.png`,
      `eglises/${EGLISE_A}/photos/../../${EGLISE_B}/photos/enfant-b.png`,
      `eglises/${EGLISE_A}/secret/enfant-a.png`,
      `eglises/${EGLISE_A}/photos/enfant-a.exe`,
      `eglises/${EGLISE_A}/photos`,
      `autre/${EGLISE_A}/photos/enfant-a.png`,
    ]) {
      expect(await demander(cle), cle).toEqual(reference);
    }
  });

  it("refuse sans session valide (absente ou expirée) par un 401, sans lire le fichier", async () => {
    contexte.egliseId = null;
    const { statut, corps } = await demander(photoA);
    expect(statut).toBe(401);
    expect(corps).toBe("");
  });
});
