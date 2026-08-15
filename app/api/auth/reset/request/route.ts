import { NextResponse } from "next/server";
import crypto from "crypto";
import { getStoreByEmail, upsertStore } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { sendFonnteMessage } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_TTL_MINUTES = 10;

/** Sembunyikan sebagian nomor untuk ditampilkan: 6281234xxxx89. */
function maskPhone(phone: string): string {
  if (phone.length <= 6) return "••••";
  return `${phone.slice(0, 5)}••••${phone.slice(-2)}`;
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
 * Respons SELALU generik supaya tidak membocorkan apakah email terdaftar.
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
    message: "Jika email terdaftar, kode OTP telah dikirim ke WhatsApp yang terdaftar.",
  };

  if (!email) {
    return NextResponse.json({ error: "Email wajib diisi." }, { status: 400 });
  }

  const store = await getStoreByEmail(email);

  // Tidak ada akun / belum menghubungkan device WhatsApp → tetap balas generik
  // (anti-enumerasi). Tanpa device token milik toko, OTP tidak bisa dikirim.
  if (!store || !store.customer_phone || !store.fonnte_token) {
    if (store && !store.fonnte_token) {
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
  });

  // Kirim OTP lewat device WhatsApp milik toko itu sendiri, ke nomor terdaftarnya.
  const message =
    `🔐 Kode reset kata sandi BalesToko.ai Anda: *${otp}*\n\n` +
    `Berlaku ${OTP_TTL_MINUTES} menit. Jangan bagikan kode ini kepada siapa pun. ` +
    `Abaikan pesan ini bila Anda tidak meminta reset.`;
  const sent = await sendFonnteMessage({
    target: store.customer_phone,
    message,
    token: store.fonnte_token,
  });
  if (!sent.success) {
    console.warn("[reset] Gagal mengirim OTP via device toko:", sent.error);
  }

  return NextResponse.json({ ...GENERIC, phoneHint: maskPhone(store.customer_phone) });
}
