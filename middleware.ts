import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "bt_session";

/**
 * Verifikasi tanda tangan token session pakai Web Crypto (kompatibel Edge runtime).
 * Token: base64url(payload).base64url(hmacSHA256(payload)).
 */
async function verifyToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
    const expected = Buffer.from(mac).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (expected !== sig) return false;

    const json = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return typeof json.exp === "number" && json.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-insecure-secret-change-me";
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!(await verifyToken(token, secret))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"]
};
