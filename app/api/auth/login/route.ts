import { NextResponse } from "next/server";
import { bumpRateLimit, getStoreByEmail, storeActivityState } from "@/lib/supabase";
import { verifyPassword, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas percobaan login. Per email supaya satu akun tidak bisa di-brute force… */
const MAX_ATTEMPTS_PER_EMAIL = 10;
/** …dan per IP supaya penyerang tidak cukup berganti-ganti email. */
const MAX_ATTEMPTS_PER_IP = 40;
const WINDOW_SECONDS = 900; // 15 menit

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Login toko: verifikasi email + password terhadap tabel `stores`,
 * lalu set cookie session httpOnly bila berhasil.
 *
 * Akun yang TIDAK aktif (trial habis / langganan lewat) tetap boleh login.
 * Ini disengaja: memperpanjang langganan butuh sesi yang terbukti memiliki email
 * itu (lihat `app/api/checkout/route.ts`), jadi memblokir login akan mengunci
 * pelanggan di luar pintu tepat ketika mereka ingin membayar. Yang dimatikan
 * untuk akun nonaktif adalah layanannya — webhook Fonnte menolak memproses pesan
 * lewat `isStoreActive`, dan dashboard menampilkan status terkunci.
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const email = (body.email || "").trim();
  const password = body.password || "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email dan kata sandi wajib diisi." }, { status: 400 });
  }

  const TOO_MANY = {
    error: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.",
  };

  const byIp = await bumpRateLimit(`login:ip:${clientIp(req)}`, WINDOW_SECONDS, MAX_ATTEMPTS_PER_IP);
  if (!byIp.allowed) {
    return NextResponse.json(TOO_MANY, {
      status: 429,
      headers: { "Retry-After": String(byIp.retryAfterSec) },
    });
  }

  const byEmail = await bumpRateLimit(
    `login:email:${email.toLowerCase()}`,
    WINDOW_SECONDS,
    MAX_ATTEMPTS_PER_EMAIL
  );
  if (!byEmail.allowed) {
    return NextResponse.json(TOO_MANY, {
      status: 429,
      headers: { "Retry-After": String(byEmail.retryAfterSec) },
    });
  }

  const store = await getStoreByEmail(email);

  // Pesan generik agar tidak membocorkan apakah email terdaftar.
  const GENERIC = "Email atau kata sandi salah.";

  if (!store || !store.password_hash) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  if (!verifyPassword(password, store.password_hash)) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  await setSessionCookie(email);

  const state = storeActivityState(store);
  return NextResponse.json({
    success: true,
    email,
    state,
    active: state === "active" || state === "trial",
  });
}
