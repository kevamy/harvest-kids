import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import {
  ENTETE_RAFRAICHISSEMENT_AUTO,
  doitEnregistrerActivite,
  estVerrouillee,
} from "@/lib/activite";
import { getAuth } from "@/lib/auth";
import { noterActiviteSession } from "@/server/plateforme/sessions";

export type SessionCourante = {
  sessionId: string;
  userId: string;
  nom: string;
  superAdmin: boolean;
  /** Church chosen at sign-in; always re-checked against Membre by getTenantDb(). */
  egliseActiveId: string | null;
  /** 15 minutes without user activity: the PIN must be entered again. */
  verrouillee: boolean;
  appareil: string | null;
};

type ChampsSession = { egliseActiveId?: string | null; derniereActivite?: Date | string | null };
type ChampsUser = { superAdmin?: boolean | null };

/**
 * Current authenticated session (deduplicated within a request).
 *
 * User activity is recorded at most once per minute. Automatic refreshes of live
 * screens (option or header sent by useLiveQuery) never count as activity, so a
 * tablet left on a live screen still locks after 15 minutes.
 */
export const getSessionCourante = cache(
  async (options: { rafraichissementAuto?: boolean } = {}): Promise<SessionCourante | null> => {
    const entetes = await headers();
    const resultat = await getAuth().api.getSession({ headers: entetes });
    if (!resultat) return null;

    const session = resultat.session as typeof resultat.session & ChampsSession;
    const user = resultat.user as typeof resultat.user & ChampsUser;
    const maintenant = new Date();
    const derniere = session.derniereActivite ? new Date(session.derniereActivite) : null;
    const verrouillee = estVerrouillee(derniere, maintenant);
    const automatique =
      options.rafraichissementAuto === true || entetes.get(ENTETE_RAFRAICHISSEMENT_AUTO) === "1";

    // A locked session records nothing: only the PIN unlocks it.
    if (!verrouillee && !automatique && doitEnregistrerActivite(derniere, maintenant)) {
      await noterActiviteSession(session.id, maintenant);
    }

    return {
      sessionId: session.id,
      userId: user.id,
      nom: user.name,
      superAdmin: user.superAdmin === true,
      egliseActiveId: session.egliseActiveId ?? null,
      verrouillee,
      appareil: session.userAgent ? session.userAgent.slice(0, 200) : null,
    };
  },
);
