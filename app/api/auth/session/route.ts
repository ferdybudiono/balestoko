import { NextResponse } from "next/server";
import { getSessionActor } from "@/lib/auth";

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
 *
 * `email` tetap berisi email TOKO (seperti sebelum fitur anggota tim ada) supaya
 * pemanggil lama tidak berubah perilaku; identitas orangnya ada di `actorEmail`.
 */
export async function GET() {
  const actor = await getSessionActor();
  return NextResponse.json({
    email: actor?.storeEmail || null,
    actorEmail: actor?.email || null,
    isMember: actor?.isMember === true
  });
}
