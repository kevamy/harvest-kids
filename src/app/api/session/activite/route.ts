import { getSessionCourante } from "@/lib/session";

/**
 * Real user activity reported by the tablet (touch, keyboard), at most once per
 * minute. getSessionCourante() records it, unless the session is already locked.
 */
export async function POST() {
  const session = await getSessionCourante();
  if (!session) return new Response(null, { status: 401 });
  return new Response(null, { status: session.verrouillee ? 423 : 204 });
}
