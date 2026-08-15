import { NextResponse } from "next/server";
import { getStoreByEmail, upsertStore } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const email = (body.email || "").trim();
  const otp = (body.otp || "").trim();
  const newPassword = body.newPassword || "";

  if (!email || !otp) {
    return NextResponse.json({ error: "Email dan kode OTP wajib diisi." }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "Kata sandi baru minimal 6 karakter." }, { status: 400 });
  }

  const store = await getStoreByEmail(email);
  const GENERIC = "Kode OTP salah atau sudah kedaluwarsa.";

  if (!store || !store.reset_otp_hash || !store.reset_otp_expires) {
    return NextResponse.json({ error: GENERIC }, { status: 400 });
  }

  const expired = new Date(store.reset_otp_expires).getTime() < Date.now();
  if (expired || !verifyPassword(otp, store.reset_otp_hash)) {
    return NextResponse.json({ error: GENERIC }, { status: 400 });
  }

  // Set password baru & hapus OTP supaya sekali pakai.
  const result = await upsertStore({
    email,
    password_hash: hashPassword(newPassword),
    reset_otp_hash: null,
    reset_otp_expires: null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Gagal menyimpan kata sandi baru." }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: "Kata sandi berhasil diperbarui. Silakan login." });
}
