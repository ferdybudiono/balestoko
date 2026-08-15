import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Logout: hapus cookie session. */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
