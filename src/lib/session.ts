import "server-only";

export type SessionCourante = {
  sessionId: string;
  userId: string;
  /** Church chosen at sign-in; always re-checked against Membre by getTenantDb(). */
  egliseActiveId: string | null;
};

/**
 * Current authenticated session. Authentication (Better Auth) is wired in step 5;
 * until then there is no session and every church access is refused.
 */
export async function getSessionCourante(): Promise<SessionCourante | null> {
  return null;
}
