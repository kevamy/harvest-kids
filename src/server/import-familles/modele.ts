import { BOM, ecrireCsv } from "@/lib/csv";
import { COLONNES } from "./analyse";

/** Import template: UTF-8 with BOM (Excel opens the accents correctly) and ";". */
export function modeleImport(): string {
  return BOM + ecrireCsv([COLONNES.map((c) => c.entete)], ";");
}
