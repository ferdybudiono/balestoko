import { NextResponse } from "next/server";
import { getStoreByEmail, upsertStore } from "@/lib/supabase";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { formatFonntePhone } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRIAL_DAYS = 7;

/**
 * Pendaftaran UJI COBA 7 HARI tanpa pembayaran.
 * Membuat akun toko dengan `trial_ends_at = now + 7 hari`, lalu langsung
 * memberi session supaya user bisa mencoba dashboard.
 */
export async function POST(req: Request) {
  let body: {
    name?: string;
    whatsapp?: string;
    email?: string;
    storeName?: string;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const storeName = (body.storeName || "").trim();
  const password = body.password || "";
  const whatsapp = body.whatsapp || "";

  if (name.length < 3) {
    return NextResponse.json({ error: "Nama lengkap wajib diisi (min. 3 karakter)." }, { status: 400 });
  }
  if (whatsapp.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "Nomor WhatsApp tidak valid." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Email tidak valid." }, { status: 400 });
  }
  if (storeName.length < 2) {
    return NextResponse.json({ error: "Nama toko wajib diisi." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Kata sandi minimal 6 karakter." }, { status: 400 });
  }

  // Email harus baru. Jika sudah ada toko (trial/berbayar) → arahkan login.
  const existing = await getStoreByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "Email sudah terdaftar. Silakan login." },
      { status: 409 }
    );
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await upsertStore({
    email,
    store_name: storeName,
    customer_name: name,
    customer_phone: formatFonntePhone(whatsapp),
    password_hash: hashPassword(password),
    is_paid: false,
    trial_ends_at: trialEndsAt,
    // Trial diberi akses setara paket Pro supaya bisa mencoba semua fitur.
    package_id: "pro",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.skipped ? "Database belum dikonfigurasi." : result.error || "Gagal membuat akun uji coba." },
      { status: 500 }
    );
  }

  await setSessionCookie(email);
  return NextResponse.json({ success: true, email, trial_ends_at: trialEndsAt });
}
