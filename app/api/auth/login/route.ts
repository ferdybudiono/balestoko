import { NextResponse } from "next/server";
import {
  bumpRateLimit,
  getStoreByEmail,
  getStoreById,
  getStoreMemberByEmail,
  storeActivityState,
  touchStoreMemberLogin
} from "@/lib/supabase";
import { normalizeEmail } from "@/lib/supabase";
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

  // Huruf besar/kecil TIDAK boleh membedakan akun. Sebelum normalisasi ini,
  // pemilik yang mendaftar sebagai `Budi@Gmail.com` lalu login `budi@gmail.com`
  // selalu ditolak 401 — tanpa pesan yang menjelaskan kenapa, dan tanpa cara
  // memperbaikinya sendiri.
  const email = normalizeEmail(body.email);
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
    `login:email:${email}`,
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

  // Jalur CADANGAN: anggota tim (`store_members`). Dicoba hanya bila email itu
  // bukan akun pemilik toko, jadi perilaku login pemilik tidak berubah sedikit pun
  // — termasuk pada database yang tabel anggotanya belum ada (`getStoreMemberByEmail`
  // mengembalikan null, dan hasilnya tetap "email atau kata sandi salah").
  if (!store || !store.password_hash) {
    const member = await getStoreMemberByEmail(email);
    if (!member || !member.password_hash || !verifyPassword(password, member.password_hash)) {
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    const owner = await getStoreById(member.store_id);
    if (!owner?.email) {
      // Anggota tanpa toko induk (toko terhapus): jangan terbitkan sesi yang
      // menunjuk ke ruang kosong.
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    if (member.id) await touchStoreMemberLogin(member.id);
    await setSessionCookie(member.email, owner.email);

    const memberState = storeActivityState(owner);
    return NextResponse.json({
      success: true,
      email: member.email,
      // Toko yang diakses — dashboard menampilkannya supaya anggota tim tahu
      // sedang membuka toko siapa.
      storeEmail: owner.email,
      isMember: true,
      role: member.role === "admin" ? "admin" : "staff",
      state: memberState,
      active: memberState === "active" || memberState === "trial"
    });
  }

  if (!verifyPassword(password, store.password_hash)) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  await setSessionCookie(email);

  const state = storeActivityState(store);
  return NextResponse.json({
    success: true,
    email,
    storeEmail: email,
    isMember: false,
    state,
    active: state === "active" || state === "trial",
  });
}
