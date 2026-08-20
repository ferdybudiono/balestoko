import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import {
  getProductsByStoreId,
  getStoreByEmail,
  listStoreDevicesCompat,
  normalizeDeviceProductIds,
  toPublicDevice,
  updateStoreDevice
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Produk yang dijawab satu nomor WhatsApp.
 *
 *   POST { deviceId, productIds: string[] }   → `[]` = nomor umum (seluruh katalog)
 *
 * Rute terpisah, BUKAN cabang baru pada `PATCH /api/fonnte/devices`: PATCH di
 * sana adalah aksi "perbaiki penerimaan pesan" yang sama sekali tidak membaca
 * body request, dan menumpangkan makna kedua ke method yang sama membuat dua
 * tombol dashboard yang berbeda bisa saling memicu.
 *
 * Dua pemeriksaan yang tidak boleh dilepas:
 * 1. Device harus milik toko pemanggil — `updateStoreDevice` menyaring by id
 *    saja, jadi kepemilikan diverifikasi di sini lewat daftar device toko.
 * 2. Id produk harus ada di katalog toko ini. Tanpa itu, id produk toko lain bisa
 *    dititipkan ke kolom scope; walau tidak membocorkan data (katalog dibaca per
 *    toko), baris seperti itu hanya jadi sampah yang membingungkan.
 */
export async function POST(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  const store = await getStoreByEmail(email);
  if (!store?.id) {
    return NextResponse.json({ error: "Toko tidak ditemukan untuk akun ini." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) {
    return NextResponse.json({ error: "Nomor WhatsApp yang mau diatur belum dipilih." }, { status: 400 });
  }

  const [{ devices, legacy }, products] = await Promise.all([
    listStoreDevicesCompat(store),
    getProductsByStoreId(store.id)
  ]);

  if (legacy) {
    // Toko masih berjalan di jalur lama (tabel store_devices belum ada), jadi
    // tidak ada baris device yang bisa disimpan scope-nya.
    return NextResponse.json(
      { error: "Fitur ini butuh tabel nomor WhatsApp. Jalankan supabase/schema.sql versi terbaru." },
      { status: 409 }
    );
  }

  const device = devices.find((d) => d.id === deviceId);
  if (!device) {
    return NextResponse.json({ error: "Nomor tidak ditemukan di toko ini." }, { status: 404 });
  }

  const requested = normalizeDeviceProductIds(body.productIds);
  const catalogIds = new Set(products.map((p) => p.id).filter((id): id is string => !!id));
  const productIds = requested.filter((id) => catalogIds.has(id));

  const result = await updateStoreDevice(deviceId, { product_ids: productIds });
  if (!result.ok) {
    // 404/400 di sini hampir selalu berarti kolom `product_ids` belum ada.
    return NextResponse.json(
      {
        error:
          result.error ||
          "Gagal menyimpan. Pastikan supabase/schema.sql versi terbaru sudah dijalankan."
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    device: result.data ? toPublicDevice(result.data) : null,
    // Id yang dibuang karena tidak ada di katalog — dashboard boleh
    // memberitahu pemilik toko bahwa produknya sudah terhapus.
    dropped: requested.length - productIds.length
  });
}
