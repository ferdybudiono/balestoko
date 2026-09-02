import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DEV_SESSION_SECRET,
  SESSION_COOKIE,
  resolveSessionSecret,
  timingSafeEqualStrings
} from "@/lib/session-constants";

/**
 * Penjaga rute dashboard.
 *
 * SENGAJA hanya memeriksa tanda tangan + kedaluwarsa cookie, tidak menyentuh
 * database. Middleware berjalan di Edge runtime: `lib/supabase.ts`,
 * `crypto.scryptSync`, dan pencabutan sesi lewat `password_changed_at` tidak
 * tersedia di sini. Jadi lapisan ini hanya mencegah pengunjung tanpa cookie
 * melihat kerangka dashboard — bukan lapisan otorisasi.
 *
 * Penegakan yang sebenarnya ada di dua tempat yang berjalan di Node runtime:
 *   • `getSessionEmail()` di setiap route API — memverifikasi tanda tangan LAGI,
 *     lalu menolak token yang terbit sebelum password terakhir diubah;
 *   • status masa aktif dari `/api/store` — dashboard menampilkan layar terkunci
 *     dan webhook menolak memproses pesan untuk akun nonaktif.
 *
 * Artinya: JANGAN pernah menaruh satu-satunya pemeriksaan kepemilikan data di
 * file ini. Semua data toko tetap harus diambil lewat route yang memanggil
 * `getSessionEmail()`.
 */

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

    // Konstan-waktu: `expected !== sig` berhenti pada byte pertama yang berbeda,
    // dan lama pembandingannya membocorkan berapa byte awal yang sudah benar.
    if (!timingSafeEqualStrings(expected, sig)) return false;

    const json = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return typeof json.exp === "number" && json.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  // Satu sumber kebenaran dengan `getSecret()` di lib/auth.ts — kalau urutannya
  // berbeda, cookie yang diterbitkan route Node akan ditolak di sini dan semua
  // pengguna terlempar ke /login tanpa jejak yang jelas di log.
  const secret = resolveSessionSecret();

  // Tanpa rahasia, satu-satunya kunci yang tersisa adalah konstanta publik di
  // repo — cookie sesi bisa dipalsukan siapa pun. Gagal tertutup: perlakukan
  // sebagai belum login alih-alih memakai kunci yang sudah bocor.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[middleware] AUTH_SECRET belum di-set; akses dashboard ditolak.");
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return handle(req, DEV_SESSION_SECRET);
  }

  return handle(req, secret);
}

async function handle(req: NextRequest, secret: string) {
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
