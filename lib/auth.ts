/**
 * Autentikasi ringan tanpa dependency eksternal.
 * - Password di-hash pakai scrypt (crypto bawaan Node).
 * - Session berupa token bertanda-tangan HMAC-SHA256, disimpan di cookie httpOnly.
 *
 * SERVER-ONLY: modul ini memakai `crypto` Node & `next/headers`.
 */

import crypto from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "bt_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 hari

let warnedAuthSecretFallback = false;

/**
 * Kunci HMAC penanda tangan sesi.
 *
 * Urutan resolusi ini HARUS sama dengan yang ada di `middleware.ts`, kalau
 * berbeda cookie yang diterbitkan di sini akan ditolak middleware.
 */
function getSecret(): string {
  const explicit = process.env.AUTH_SECRET;
  if (explicit) return explicit;

  // Fallback ke service role key dipertahankan agar sesi yang sudah terbit
  // tidak langsung batal. Bukan praktik yang baik: merotasi kunci database
  // ikut memaksa semua user login ulang, dan satu rahasia dipakai dua tujuan.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fallback) {
    if (!warnedAuthSecretFallback) {
      warnedAuthSecretFallback = true;
      console.warn(
        "[auth] AUTH_SECRET belum di-set — memakai SUPABASE_SERVICE_ROLE_KEY sebagai kunci HMAC. " +
          "Set AUTH_SECRET agar rotasi kunci database tidak membatalkan seluruh sesi login."
      );
    }
    return fallback;
  }

  // Konstanta di bawah ada di dalam repo publik: siapa pun bisa memalsukan
  // cookie sesi untuk email mana pun. Hanya boleh dipakai saat development.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET (atau SUPABASE_SERVICE_ROLE_KEY) wajib di-set di produksi untuk menandatangani sesi login."
    );
  }
  return "dev-insecure-secret-change-me";
}

// ---------------- PASSWORD ----------------

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

/** Buat token session untuk sebuah email. */
export function signSession(email: string): string {
  const payload = JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
  const payloadB64 = base64url(payload);
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verifikasi token; kembalikan email bila valid & belum kedaluwarsa, selain itu null. */
export function verifySession(token?: string | null): string | null {
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
    return String(payload.email);
  } catch {
    return null;
  }
}

// ---------------- COOKIE HELPERS ----------------

export async function setSessionCookie(email: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(email), {
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

/** Email user yang sedang login berdasarkan cookie session, atau null. */
export async function getSessionEmail(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
