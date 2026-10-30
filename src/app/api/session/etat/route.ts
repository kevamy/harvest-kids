import { NextResponse } from "next/server";
import { getSessionCourante } from "@/lib/session";

/** Lock state, polled like a live screen: never counts as activity. */
export async function GET() {
  const session = await getSessionCourante({ rafraichissementAuto: true });
  if (!session) return NextResponse.json({ connecte: false }, { status: 401 });
  return NextResponse.json(
    { connecte: true, verrouillee: session.verrouillee },
    { headers: { "Cache-Control": "no-store" } },
  );
}
