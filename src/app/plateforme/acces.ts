import { notFound } from "next/navigation";
import { getSessionCourante, type SessionCourante } from "@/lib/session";

/**
 * Page-level guard: a layout never protects a page (they render in parallel).
 * Anyone but a super-administrator gets a 404. A locked session gets null: the
 * layout then shows the lock message and the page renders nothing.
 */
export async function sessionPagePlateforme(): Promise<SessionCourante | null> {
  const session = await getSessionCourante();
  if (!session?.superAdmin) notFound();
  return session.verrouillee ? null : session;
}
