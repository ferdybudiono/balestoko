import { NextResponse } from "next/server";
import crypto from "crypto";
import { bumpRateLimit, getPrimaryStoreDevice, getStoreByEmail, upsertStore } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { sendFonnteMessage } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_TTL_MINUTES = 10;

/** Maksimal permintaan OTP per email per jam. */
const REQUEST_MAX_PER_HOUR = 5;
/** Maksimal permintaan OTP per alamat IP per jam (menghambat penyapuan email). */
const REQUEST_MAX_PER_IP_PER_HOUR = 20;
const HOUR_SECONDS = 3600;

/** IP pemanggil di belakang proxy Vercel. */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Minta OTP reset password. OTP dikirim via WhatsApp ke nomor terdaftar toko
 * memakai DEVICE token milik toko itu sendiri (store.fonnte_token) — device yang
 * sebelumnya dibuat dari Account Token SaaS saat toko menghubungkan WhatsApp.
 *
 * Tidak ada device token pengirim global di ENV: setiap toko mengirim OTP-nya
 * lewat device WhatsApp-nya sendiri (cocok untuk model SaaS multi-tenant).
 * Konsekuensinya, reset via WhatsApp hanya tersedia bila toko sudah pernah
 * menghubungkan device WhatsApp-nya.
 *
 * Respons SELALU generik & IDENTIK, apa pun yang terjadi di belakang: tidak ada
 * petunjuk nomor, tidak ada perbedaan pesan, dan jalur "email tidak ada" tidak
 * lebih cepat mencolok daripada jalur normal. Membocorkan email mana yang
 * terdaftar berarti menyerahkan daftar pelanggan ke siapa pun yang mau menebak.
 */
export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const email = (body.email || "").trim();
  const GENERIC = {
    success: true,
    message:
      "Jika email terdaftar dan WhatsApp-nya sudah terhubung, kode OTP telah dikirim " +
      "ke nomor WhatsApp yang terdaftar pada akun tersebut.",
  };

  if (!email) {
    return NextResponse.json({ error: "Email wajib diisi." }, { status: 400 });
  }

  // Batasi per IP lebih dulu — ini yang membendung penyapuan banyak email
  // sekaligus. Ditegakkan di database supaya berlaku lintas instance serverless.
  const byIp = await bumpRateLimit(`reset-req:ip:${clientIp(req)}`, HOUR_SECONDS, REQUEST_MAX_PER_IP_PER_HOUR);
  if (!byIp.allowed) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan reset. Coba lagi nanti." },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfterSec) } }
    );
  }

  // Batas per email: mencegah satu akun dibanjiri OTP (biaya kirim WA + gangguan
  // ke pemilik toko). Dijalankan sebelum lookup, jadi tidak membocorkan apa pun.
  const byEmail = await bumpRateLimit(
    `reset-req:email:${email.toLowerCase()}`,
    HOUR_SECONDS,
    REQUEST_MAX_PER_HOUR
  );
  if (!byEmail.allowed) {
    // Tetap balasan generik: kalau di sini bunyinya berbeda dari jalur normal,
    // penyerang tahu email itu ada hanya dengan menembaknya 6 kali.
    return NextResponse.json(GENERIC);
  }

  const store = await getStoreByEmail(email);

  // OTP dikirim lewat device UTAMA toko. `store.fonnte_token` dipakai sebagai
  // cadangan karena kolom itu adalah cermin device utama (dan satu-satunya sumber
  // pada data yang belum termigrasi ke `store_devices`).
  const primaryToken = store
    ? (await getPrimaryStoreDevice(store))?.fonnte_token || store.fonnte_token || ""
    : "";

  // Tidak ada akun / belum menghubungkan device WhatsApp → tetap balas generik
  // (anti-enumerasi). Tanpa device token milik toko, OTP tidak bisa dikirim.
  if (!store || !store.customer_phone || !primaryToken) {
    if (store && !primaryToken) {
      console.warn(
        "[reset] Toko belum menghubungkan WhatsApp — OTP tidak dapat dikirim."
      );
    }
    return NextResponse.json(GENERIC);
  }

  // Buat OTP 6 digit, simpan hash-nya (bukan OTP mentah) + kedaluwarsa.
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  await upsertStore({
    email,
    reset_otp_hash: hashPassword(otp),
    reset_otp_expires: expires,
    // OTP baru = jatah percobaan baru. Tanpa reset ini, satu akun yang pernah
    // kena batas percobaan tidak akan pernah bisa reset password lagi.
    reset_otp_attempts: 0,
  });

  // Kirim OTP lewat device WhatsApp milik toko itu sendiri, ke nomor terdaftarnya.
  const message =
    `🔐 Kode reset kata sandi BalesToko.ai Anda: *${otp}*\n\n` +
    `Berlaku ${OTP_TTL_MINUTES} menit. Jangan bagikan kode ini kepada siapa pun. ` +
    `Abaikan pesan ini bila Anda tidak meminta reset.`;
  const sent = await sendFonnteMessage({
    target: store.customer_phone,
    message,
    token: primaryToken,
  });
  if (!sent.success) {
    console.warn("[reset] Gagal mengirim OTP via device toko:", sent.error);
  }

  return NextResponse.json(GENERIC);
}
