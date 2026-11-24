"use client";

import { MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { appelerAction } from "@/lib/appel-action";
import type { CanalAppel } from "@/lib/appels";
import { formaterTelephone, lienTelephone, lienWhatsApp } from "@/lib/telephone";
import type { ContactUrgence } from "@/server/urgence";
import { journaliserAppelUrgence } from "./[id]/actions";

/**
 * Call links of the Urgence button (cahier §7.9, ADR 0019). A touch opens the call at once
 * (an emergency never waits for the network) and logs it in parallel; a failed log is said
 * plainly ("Appel non journalisé"), never hidden. Only stored E.164 numbers get a link.
 */
export function LiensUrgence({
  presenceId,
  contacts,
  onJournalise,
}: {
  presenceId: string;
  contacts: ContactUrgence[];
  /** Called once the call is logged (the card refreshes its journal). */
  onJournalise?: () => void;
}) {
  const [avertissement, setAvertissement] = useState<string | null>(null);

  const journaliser = (contact: ContactUrgence, numero: string, canal: CanalAppel) => {
    setAvertissement(null);
    // Not awaited: the link's default action (tel: or wa.me) goes on immediately.
    void appelerAction(() => journaliserAppelUrgence({ presenceId, numero, canal })).then(
      (resultat) => {
        if (resultat.ok) onJournalise?.();
        else
          setAvertissement(
            `Appel non journalisé (${contact.prenom}) : ${resultat.erreur} Signalez l'appel au responsable.`,
          );
      },
    );
  };

  const appelables = contacts.filter((c) => c.telephones.length > 0 || c.whatsapp);
  if (appelables.length === 0) {
    return (
      <p className="m-0 font-bold text-alerte">
        Aucun numéro enregistré pour cette famille : prévenez le responsable.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {avertissement ? (
        <p role="alert" className="m-0 font-bold text-alerte">
          {avertissement}
        </p>
      ) : null}
      <ul aria-label="Contacts de la famille" className="m-0 grid list-none gap-3 p-0">
        {appelables.map((contact) => (
          <li
            key={contact.cle}
            aria-label={`${contact.prenom} ${contact.nom}`}
            className="grid gap-2 rounded-md bg-blanc px-4 py-3 shadow-card"
          >
            <p className="m-0">
              <span className="font-bold">
                {contact.prenom} {contact.nom}
              </span>{" "}
              <span className="text-texte-doux">
                · {contact.lien}
                {contact.principal ? " · contact principal" : ""}
                {contact.qualite === "autorise" ? " · personne autorisée" : ""}
              </span>
            </p>
            <div className="flex flex-wrap gap-3">
              {contact.telephones.map((numero) =>
                lienTelephone(numero) ? (
                  <Button key={numero} asChild variant="sombre">
                    <a
                      href={lienTelephone(numero)!}
                      aria-label={`Appeler ${contact.prenom} au ${formaterTelephone(numero)}`}
                      onClick={() => journaliser(contact, numero, "tel")}
                    >
                      <Phone aria-hidden />
                      {formaterTelephone(numero)}
                    </a>
                  </Button>
                ) : null,
              )}
              {contact.whatsapp && lienWhatsApp(contact.whatsapp) ? (
                <Button asChild variant="ghost">
                  <a
                    href={lienWhatsApp(contact.whatsapp)!}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Écrire à ${contact.prenom} sur WhatsApp`}
                    onClick={() => journaliser(contact, contact.whatsapp!, "whatsapp")}
                  >
                    <MessageCircle aria-hidden />
                    WhatsApp
                  </a>
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
