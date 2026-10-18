import { redirect } from "next/navigation";
import { getSessionCourante } from "@/lib/session";

/** Entry point: sends each person to the right screen. */
export default async function Racine() {
  const session = await getSessionCourante();
  if (!session) redirect("/connexion");
  if (!session.egliseActiveId) redirect("/choisir-eglise");
  redirect("/accueil");
}
