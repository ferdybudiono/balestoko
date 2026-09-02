/**
 * Autentikasi ringan tanpa dependency eksternal.
 * - Password di-hash pakai scrypt (crypto bawaan Node).
 * - Session berupa token bertanda-tangan HMAC-SHA256, disimpan di cookie httpOnly.
 *
 * SERVER-ONLY: modul ini memakai `crypto` Node & `next/headers`.
 */

import crypto from "crypto";
import { cookies } from "next/headers";
import { getStoreAuthMeta, getStoreMemberByEmail } from "@/lib/supabase";
import {
  DEV_SESSION_SECRET,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  resolveSessionSecret
} from "@/lib/session-constants";

// Nama cookie & umur sesi tinggal di `lib/session-constants.ts` supaya Edge
// middleware memakai nilai yang SAMA, bukan salinan yang bisa melenceng.
// Diekspor ulang di sini karena route yang sudah ada mengimpornya dari modul ini.
export { SESSION_COOKIE };

let warnedAuthSecretFallback = false;

/**
 * Kunci HMAC penanda tangan sesi.
 *
 * Urutan resolusinya ada di `resolveSessionSecret()` — satu tempat, dipakai
 * bersama `middleware.ts`. Yang berbeda di sini hanyalah reaksi terhadap
 * "tidak ada rahasia": melempar di produksi, karena menerbitkan cookie dengan
 * kunci yang ada di dalam repo sama dengan tidak menandatanganinya sama sekali.
 */
function getSecret(): string {
  const secret = resolveSessionSecret();

  if (secret) {
    if (!process.env.AUTH_SECRET && !warnedAuthSecretFallback) {
      warnedAuthSecretFallback = true;
      console.warn(
        "[auth] AUTH_SECRET belum di-set — memakai SUPABASE_SERVICE_ROLE_KEY sebagai kunci HMAC. " +
          "Set AUTH_SECRET agar rotasi kunci database tidak membatalkan seluruh sesi login."
      );
    }
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET (atau SUPABASE_SERVICE_ROLE_KEY) wajib di-set di produksi untuk menandatangani sesi login."
    );
  }
  return DEV_SESSION_SECRET;
}

// ---------------- PASSWORD ----------------

/**
 * Nilai yang harus DITULIS ke `password_changed_at` setiap kali kata sandi berubah.
 *
 * Sengaja SATU DETIK di masa lalu, dan itu bukan kecerobohan. Pencabutan sesi
 * memakai perbandingan `payload.iat <= changedSec` (lihat `getSessionActor`), dan
 * `iat` sebuah token hanya punya presisi detik. Kalau `password_changed_at`
 * ditulis "sekarang", cookie baru yang diterbitkan pada detik yang SAMA akan
 * memenuhi `iat === changedSec` — jadi user yang baru saja berhasil mengganti
 * kata sandinya langsung dikeluarkan dari sesinya sendiri.
 *
 * Menggeser satu detik ke belakang membuat `iat` token baru selalu lebih besar,
 * tanpa melonggarkan pencabutan: token lama yang terbit pada detik yang sama
 * dengan perubahan tetap ditolak.
 */
export function passwordChangedAt(): string {
  return new Date(Date.now() - 1000).toISOString();
}

/** Hash password → format: scrypt$<saltHex>$<hashHex> */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Verifikasi password terhadap hash tersimpan (timing-safe). */
export function verifyPassword(password: string, stored?: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------- SESSION TOKEN ----------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payloadB64: string): string {
  return base64url(crypto.createHmac("sha256", getSecret()).update(payloadB64).digest());
}

/**
 * Buat token session untuk sebuah email.
 *
 * `storeEmail` diisi HANYA untuk login anggota tim (`store_members`): `email`
 * tetap identitas orang yang login, sedangkan `store` menunjuk email pemilik toko
 * yang datanya dia akses. Dua field, bukan satu, supaya menghapus satu anggota
 * bisa mencabut aksesnya tanpa menyentuh akun pemilik — dan supaya catatan login
 * terakhir tetap menunjuk orang yang benar.
 */
export function signSession(email: string, storeEmail?: string): string {
  const nowSec = Math.floor(Date.now() / 1000);
  // `iat` (waktu terbit) dipakai untuk mencabut sesi: sesi yang terbit sebelum
  // `stores.password_changed_at` ditolak, jadi ganti/reset password benar-benar
  // mengeluarkan siapa pun yang sedang memakai akun itu.
  const payload = JSON.stringify({
    email,
    // Dihilangkan saat sama dengan `email` supaya token pemilik toko tetap
    // berbentuk sama persis seperti sebelum fitur ini ada.
    ...(storeEmail && storeEmail !== email ? { store: storeEmail } : {}),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS
  });
  const payloadB64 = base64url(payload);
  return `${payloadB64}.${sign(payloadB64)}`;
}

export interface SessionPayload {
  email: string;
  /**
   * Email PEMILIK toko yang datanya diakses. `null` = yang login adalah pemilik
   * toko itu sendiri (bentuk token lama, dan mayoritas sesi).
   */
  store: string | null;
  /** Waktu terbit (epoch detik). `0` untuk token lama yang belum punya field ini. */
  iat: number;
}

/**
 * Verifikasi tanda tangan + kedaluwarsa token, kembalikan isinya.
 * TIDAK memeriksa pencabutan — itu tugas `getSessionEmail()` yang punya akses DB.
 */
export function verifySessionPayload(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!payload.email || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      email: String(payload.email),
      store: payload.store ? String(payload.store) : null,
      iat: typeof payload.iat === "number" ? payload.iat : 0
    };
  } catch {
    return null;
  }
}

/**
 * Verifikasi token; kembalikan email ORANG yang login (bukan email toko).
 *
 * Untuk akses data pakai `getSessionEmail()` — pada sesi anggota tim keduanya
 * berbeda, dan yang menentukan data toko mana yang dibuka adalah yang kedua.
 */
export function verifySession(token?: string | null): string | null {
  return verifySessionPayload(token)?.email ?? null;
}

// ---------------- COOKIE HELPERS ----------------

/**
 * Terbitkan cookie sesi.
 *
 * `storeEmail` hanya diisi saat yang login adalah anggota tim; tanpa itu email
 * yang sama dipakai untuk identitas dan untuk akses data (kasus pemilik toko).
 */
export async function setSessionCookie(email: string, storeEmail?: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(email, storeEmail), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Siapa yang login & toko mana yang dia akses. */
export interface SessionActor {
  /** Email orang yang login (anggota tim atau pemilik). */
  email: string;
  /** Email pemilik toko yang datanya diakses. */
  storeEmail: string;
  /** `true` = login lewat `store_members`, bukan akun pemilik. */
  isMember: boolean;
}

/**
 * Email TOKO yang datanya boleh diakses sesi ini, atau null.
 *
 * Selain memeriksa tanda tangan & kedaluwarsa cookie, fungsi ini menolak sesi
 * yang diterbitkan SEBELUM password akun terakhir berubah. Tanpa itu, reset
 * password tidak mencabut apa pun: cookie yang sudah dipegang penyerang tetap
 * sah sampai TTL 7 hari habis, jadi korban pengambilalihan akun tidak punya cara
 * mengusirnya.
 *
 * Yang dikembalikan adalah email PEMILIK toko, juga saat yang login anggota tim.
 * Itu disengaja: seluruh route memakai nilai ini untuk `getStoreByEmail()`, jadi
 * anggota tim membaca data toko yang sama tanpa satu pun route perlu diubah.
 * Konsekuensinya juga disengaja dan harus diingat: anggota tim punya akses yang
 * sama luas dengan pemilik, KECUALI pengelolaan anggota (lihat `/api/members`,
 * yang memeriksa `isMember`). Yang dibeli fitur ini adalah kredensial terpisah
 * yang bisa dicabut satu per satu — bukan pembatasan peran.
 *
 * Biayanya satu query ringan (satu kolom, lewat indeks email) per request
 * terautentikasi, dua untuk sesi anggota tim. Sengaja tidak di-memoize lewat
 * `cache()` React supaya perilakunya sama di Route Handler maupun Server Component.
 *
 * Gagal-TERBUKA saat query gagal: pemeriksaan ini lapisan tambahan, dan
 * memaksa semua user logout karena satu blip database bukan pertukaran yang baik.
 */
export async function getSessionEmail(): Promise<string | null> {
  return (await getSessionActor())?.storeEmail ?? null;
}

export async function getSessionActor(): Promise<SessionActor | null> {
  const store = await cookies();
  const payload = verifySessionPayload(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const storeEmail = payload.store || payload.email;
  const isMember = !!payload.store;

  // Sesi anggota tim: barisnya harus MASIH ADA. Menghapus anggota adalah satu-satunya
  // cara pemilik toko mencabut akses seseorang, jadi pemeriksaan ini yang membuat
  // tombol "hapus" benar-benar berarti — tanpa itu cookie-nya tetap sah 7 hari.
  if (isMember) {
    const member = await getStoreMemberByEmail(payload.email);
    if (!member) return null;
    if (member.password_changed_at) {
      const changedSec = Math.floor(new Date(member.password_changed_at).getTime() / 1000);
      if (Number.isFinite(changedSec) && payload.iat <= changedSec) return null;
    }
  }

  const meta = await getStoreAuthMeta(storeEmail);
  // query gagal → jangan paksa logout; akun belum ada (mis. baru checkout) → lewat.
  if (meta === undefined || meta === null) return { email: payload.email, storeEmail, isMember };

  if (meta.password_changed_at) {
    const changedSec = Math.floor(new Date(meta.password_changed_at).getTime() / 1000);
    // `iat === 0` = token terbitan versi lama (sebelum field ini ada). Token itu
    // tidak bisa dibuktikan lebih baru dari perubahan password, jadi ditolak.
    if (Number.isFinite(changedSec) && payload.iat <= changedSec) return null;
  }

  return { email: payload.email, storeEmail, isMember };
}
