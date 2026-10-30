/**
 * Fictitious Beninese families for the demonstration seed (cahier §16): 20 to 40
 * families per church, guardians, children, authorised adults, family cards.
 * Any resemblance to real people is coincidental. Deterministic (seeded PRNG).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { cleFichier } from "../src/lib/fichiers";
import { empreinteJeton, genererJetonCarte } from "../src/lib/jetons";
import type { Stockage } from "../src/lib/storage";
import { attribuerMatricule } from "../src/lib/tenant";
import { silhouetteFictive } from "../src/server/plateforme/images-demo";

const PRENOMS = [
  "Ayo",
  "Sèna",
  "Koffi",
  "Afi",
  "Délali",
  "Mawuli",
  "Kossi",
  "Ablavi",
  "Codjo",
  "Rachida",
  "Fifamè",
  "Gbêtoho",
  "Houénou",
  "Akouavi",
  "Yao",
  "Grâce",
  "Prince",
  "Bénédicte",
  "Dorcas",
  "Elikem",
  "Nadège",
  "Ornella",
  "Tobi",
  "Folake",
  "Kayodé",
  "Adjoua",
  "Mahouna",
  "Sèdjro",
  "Ruth",
  "Emmanuel",
  "Josué",
  "Esther",
  "Fabrice",
  "Linda",
  "Yannick",
  "Vianney",
  "Amour",
  "Merveille",
  "Christ-Roi",
  "Dieudonné",
];
const NOMS = [
  "Agbodjan",
  "Dossou",
  "Hounkpatin",
  "Ahouandjinou",
  "Kiki",
  "Adjovi",
  "Gbaguidi",
  "Akakpo",
  "Houngbédji",
  "Zinsou",
  "Sossou",
  "Tchibozo",
  "Dansou",
  "Loko",
  "Assogba",
  "Adandé",
  "Kpodo",
  "Sagbo",
  "Hountondji",
  "Dagbéto",
  "Adéchian",
  "Amoussou",
  "Avocè",
  "Bocovo",
  "Fanou",
  "Gnonlonfoun",
  "Houessou",
  "Quenum",
  "Ahyi",
  "Codjia",
  "Dégbé",
  "Fagla",
  "Glèlè",
  "Hessou",
  "Kakpo",
  "Lalèyè",
  "Médégan",
  "Noudéhou",
  "Tokpanou",
  "Yèhouénou",
];
const ALERTES = [
  { alerte: "Allergie alimentaire", detail: "Arachide : ne rien donner à manger sans accord." },
  { alerte: "Asthme", detail: "Inhalateur dans le sac." },
  { alerte: "Épilepsie", detail: "Prévenir immédiatement l'infirmerie en cas de crise." },
  { alerte: "Traitement en cours", detail: "Traitement donné par les parents, rien sur place." },
];

/** mulberry32: small deterministic PRNG, enough for demo data. */
function generateur(graine: number) {
  let a = graine >>> 0;
  const suivant = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    entre: (min: number, max: number) => min + Math.floor(suivant() * (max - min + 1)),
    choisir: <T>(liste: readonly T[]) => liste[Math.floor(suivant() * liste.length)]!,
    probabilite: (p: number) => suivant() < p,
  };
}

function dateAvantMois(mois: number, jour: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - mois);
  d.setUTCDate(Math.min(jour, 28));
  return d;
}

type TransactionPrisma = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Runs `fn` inside one church (app.eglise_id set for the transaction). Built by
 * prisma/seed.ts, the only seed file allowed to hold the raw Prisma client.
 */
export type DansEglise = <T>(fn: (tx: TransactionPrisma) => Promise<T>) => Promise<T>;

export async function semerFamilles(
  dansEglise: DansEglise,
  egliseId: string,
  graine: number,
  stockage: Stockage,
): Promise<number> {
  const deja = await dansEglise((tx) => tx.famille.count());
  if (deja > 0) return 0;

  const hasard = generateur(graine);
  const nombre = hasard.entre(20, 40);
  let photo = 0;

  for (let f = 0; f < nombre; f++) {
    const nomFamille = NOMS[(f + graine) % NOMS.length]!;
    const avecDeuxTuteurs = hasard.probabilite(0.6);
    const tuteurs = [
      { prenom: hasard.choisir(PRENOMS), lien: "Mère", principal: true },
      ...(avecDeuxTuteurs
        ? [{ prenom: hasard.choisir(PRENOMS), lien: "Père", principal: false }]
        : []),
    ];
    const autresAutorises = hasard.probabilite(0.3)
      ? [{ prenom: hasard.choisir(PRENOMS), lien: "Grand-mère" }]
      : [];

    // Photos are uploaded before the transaction (storage is not transactional).
    const photos: string[] = [];
    for (let i = 0; i < tuteurs.length + autresAutorises.length; i++) {
      const cle = cleFichier(egliseId, "photos", `${randomUUID()}.png`);
      await stockage.put(cle, await silhouetteFictive(photo++), "image/png");
      photos.push(cle);
    }

    await dansEglise(async (tx) => {
      const consentement = dateAvantMois(hasard.entre(1, 18), hasard.entre(1, 28));
      const famille = await tx.famille.create({
        data: {
          egliseId,
          nom: nomFamille,
          consentementDonnees: consentement,
          consentementPhotos: hasard.probabilite(0.7) ? consentement : null,
          finaliseeLe: consentement,
        },
        select: { id: true },
      });

      for (const [i, t] of tuteurs.entries()) {
        const telephone = `+22901960${String(graine % 10)}${String(f).padStart(2, "0")}${i}`;
        const tuteur = await tx.tuteur.create({
          data: {
            egliseId,
            familleId: famille.id,
            prenom: t.prenom,
            nom: nomFamille,
            lien: t.lien,
            // Fictitious numbers.
            telephone,
            whatsapp: hasard.probabilite(0.8) ? telephone : null,
            principal: t.principal,
          },
          select: { id: true },
        });
        await tx.personneAutorisee.create({
          data: {
            egliseId,
            familleId: famille.id,
            tuteurId: tuteur.id,
            prenom: t.prenom,
            nom: nomFamille,
            lien: t.lien,
            photoKey: photos[i]!,
          },
        });
      }
      for (const [i, a] of autresAutorises.entries()) {
        await tx.personneAutorisee.create({
          data: {
            egliseId,
            familleId: famille.id,
            prenom: a.prenom,
            nom: nomFamille,
            lien: a.lien,
            photoKey: photos[tuteurs.length + i]!,
          },
        });
      }

      const enfants = hasard.entre(1, 4);
      for (let e = 0; e < enfants; e++) {
        const alerte = hasard.probabilite(0.15) ? hasard.choisir(ALERTES) : null;
        await tx.enfant.create({
          data: {
            egliseId,
            familleId: famille.id,
            matricule: await attribuerMatricule(tx),
            prenom: hasard.choisir(PRENOMS),
            nom: nomFamille,
            dateNaissance: dateAvantMois(hasard.entre(6, 150), hasard.entre(1, 28)),
            alertes: alerte ? [alerte.alerte] : [],
            alerteDetail: alerte?.detail ?? null,
          },
        });
      }

      // Active card; the clear token is discarded (only its fingerprint is stored, ADR 0008).
      await tx.carteFamille.create({
        data: {
          egliseId,
          familleId: famille.id,
          tokenHash: empreinteJeton(genererJetonCarte()),
          activeLe: consentement,
        },
      });
    });
  }
  return nombre;
}
