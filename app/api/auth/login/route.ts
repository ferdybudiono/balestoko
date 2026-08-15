import { NextResponse } from "next/server";
import { getStoreByEmail, isStoreActive } from "@/lib/supabase";
import { verifyPassword, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Login toko: verifikasi email + password terhadap tabel `stores`,
 * lalu set cookie session httpOnly bila berhasil.
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

  const store = await getStoreByEmail(email);

  // Pesan generik agar tidak membocorkan apakah email terdaftar.
  const GENERIC = "Email atau kata sandi salah.";

  if (!store || !store.password_hash) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Verifikasi password DULU (sebelum bocorkan status akun) untuk hindari enumerasi.
  if (!verifyPassword(password, store.password_hash)) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Password benar, tapi akun harus aktif: sudah bayar ATAU trial belum kedaluwarsa.
  if (!isStoreActive(store)) {
    const trialExpired = !!store.trial_ends_at;
    return NextResponse.json(
      {
        error: trialExpired
          ? "Masa uji coba Anda telah berakhir. Silakan berlangganan untuk melanjutkan."
          : "Akun belum aktif. Selesaikan pembayaran terlebih dahulu, lalu coba lagi.",
      },
      { status: 403 }
    );
  }

  await setSessionCookie(email);
  return NextResponse.json({ success: true, email });
}
