import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Siapa yang sedang login? Mengembalikan `{ email: null }` bila tidak ada sesi.
 *
 * Sengaja dibuat semurah mungkin — hanya verifikasi cookie + satu lookup kecil
 * untuk pencabutan sesi — supaya halaman publik (mis. modal checkout) bisa
 * menanyakannya tanpa menarik seluruh data toko lewat `/api/store`.
 *
 * Dipakai modal checkout: kalau pengunjung sudah login, formulir tidak perlu lagi
 * meminta kata sandi karena pembayaran itu PERPANJANGAN akun yang sudah ada.
 */
export async function GET() {
  const email = await getSessionEmail();
  return NextResponse.json({ email: email || null });
}
