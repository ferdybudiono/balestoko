import { NextResponse } from "next/server";
import { bumpRateLimit, getStoreByEmail, normalizeEmail, upsertStore } from "@/lib/supabase";
import { hashPassword, passwordChangedAt, verifyPassword } from "@/lib/auth";
import { MIN_PASSWORD, minPasswordError } from "@/lib/password-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maksimal percobaan OTP salah sebelum OTP-nya DIBATALKAN sama sekali.
 *
 * OTP hanya 6 digit (1 juta kemungkinan) dan berlaku 10 menit. Tanpa batas ini,
 * satu skrip bisa mencoba puluhan ribu kombinasi dalam masa berlaku itu dan
 * mengambil alih akun tanpa pernah menyentuh password aslinya.
 */
const MAX_OTP_ATTEMPTS = 5;

/** Batas kasar per IP, supaya penyerang tidak cukup berganti-ganti email. */
const CONFIRM_MAX_PER_IP_PER_HOUR = 30;
const HOUR_SECONDS = 3600;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Konfirmasi reset password: verifikasi OTP + set kata sandi baru.
 * OTP dicek terhadap hash tersimpan & belum kedaluwarsa.
 */
export async function POST(req: Request) {
  let body: { email?: string; otp?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const otp = (body.otp || "").trim();
  const newPassword = body.newPassword || "";

  if (!email || !otp) {
    return NextResponse.json({ error: "Email dan kode OTP wajib diisi." }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD) {
    return NextResponse.json({ error: minPasswordError("Kata sandi baru") }, { status: 400 });
  }

  const byIp = await bumpRateLimit(`reset-confirm:ip:${clientIp(req)}`, HOUR_SECONDS, CONFIRM_MAX_PER_IP_PER_HOUR);
  if (!byIp.allowed) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan. Coba lagi nanti." },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfterSec) } }
    );
  }

  const store = await getStoreByEmail(email);
  const GENERIC = "Kode OTP salah atau sudah kedaluwarsa.";

  if (!store || !store.reset_otp_hash || !store.reset_otp_expires) {
    return NextResponse.json({ error: GENERIC }, { status: 400 });
  }

  // Jatah percobaan sudah habis → OTP ini mati, minta kirim ulang. Dicek sebelum
  // verifikasi supaya percobaan ke-6 pun tidak pernah dinilai.
  const attempts = store.reset_otp_attempts ?? 0;
  if (attempts >= MAX_OTP_ATTEMPTS) {
    await upsertStore({ email, reset_otp_hash: null, reset_otp_expires: null });
    return NextResponse.json(
      { error: "Terlalu banyak percobaan kode. Minta kode OTP baru." },
      { status: 429 }
    );
  }

  const expired = new Date(store.reset_otp_expires).getTime() < Date.now();
  if (expired || !verifyPassword(otp, store.reset_otp_hash)) {
    if (!expired) {
      const next = attempts + 1;
      // Percobaan terakhir langsung membatalkan OTP-nya, bukan hanya menaikkan
      // hitungan — supaya tidak ada jendela satu percobaan gratis lagi.
      await upsertStore({
        email,
        reset_otp_attempts: next,
        ...(next >= MAX_OTP_ATTEMPTS ? { reset_otp_hash: null, reset_otp_expires: null } : {}),
      });
    }
    return NextResponse.json({ error: GENERIC }, { status: 400 });
  }

  // Set password baru, hapus OTP supaya sekali pakai, dan catat waktu perubahan.
  //
  // `password_changed_at` inilah yang membuat reset benar-benar berarti: semua
  // cookie sesi yang terbit sebelum waktu ini ditolak `getSessionEmail()`. Tanpa
  // itu, korban pengambilalihan akun bisa mengganti password tapi penyerang tetap
  // login sampai TTL 7 hari habis.
  const result = await upsertStore({
    email,
    password_hash: hashPassword(newPassword),
    password_changed_at: passwordChangedAt(),
    reset_otp_hash: null,
    reset_otp_expires: null,
    reset_otp_attempts: 0,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Gagal menyimpan kata sandi baru." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: "Kata sandi berhasil diperbarui. Semua sesi lain sudah dikeluarkan. Silakan login.",
  });
}
