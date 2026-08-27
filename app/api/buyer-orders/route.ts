import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import {
  deleteBuyerOrder,
  getStoreByEmail,
  isBuyerOrderStatus,
  listBuyerOrders,
  setBuyerOrderStatus,
  type BuyerOrderStatus,
  type StoreRecord
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daftar pesanan pembeli (hasil rekaman AI) + tombol "selesai".
 *
 * JANGAN dicampur dengan `/api/orders`-nya Midtrans: tabel `public.orders` adalah
 * pembayaran LANGGANAN SaaS, sedangkan ini pesanan yang pembeli toko lakukan
 * lewat WhatsApp.
 *
 * Semua operasi memakai `store.id` dari SESSION, bukan dari body, dan
 * `setBuyerOrderStatus`/`deleteBuyerOrder` ikut menyaring `store_id` di
 * PostgREST — jadi menebak id pesanan toko lain tidak menghasilkan apa pun.
 */
async function requireStore(): Promise<
  { ok: true; store: StoreRecord; storeId: string } | { ok: false; res: NextResponse }
> {
  const email = await getSessionEmail();
  if (!email) {
    return { ok: false, res: NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 }) };
  }
  const store = await getStoreByEmail(email);
  if (!store?.id) {
    return { ok: false, res: NextResponse.json({ error: "Data toko tidak ditemukan." }, { status: 404 }) };
  }
  return { ok: true, store, storeId: store.id };
}

export async function GET() {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;

  const orders = await listBuyerOrders(auth.storeId);
  return NextResponse.json({
    orders: orders || [],
    needsMigration: orders === null
  });
}

/**
 * Ubah tahap satu pesanan.
 *
 *   PATCH { id, status: "new"|"paid"|"shipped"|"done", tracking_number?, payment_proof_url?, note? }
 *
 * `done: boolean` versi lama masih diterima. Bukan demi kerapian: browser yang
 * sudah terbuka memuat JavaScript versi lama, dan menolaknya berarti tombol
 * "selesai" di tab pesanan berhenti bekerja sampai user memuat ulang halaman.
 */
export async function PATCH(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Id pesanan wajib diisi." }, { status: 400 });
  }

  let status: BuyerOrderStatus;
  if (body.status !== undefined) {
    if (!isBuyerOrderStatus(body.status)) {
      return NextResponse.json(
        { error: "Status pesanan tidak dikenal. Pilih: new, paid, shipped, atau done." },
        { status: 400 }
      );
    }
    status = body.status;
  } else {
    // Jalur lama: `done` dibaca eksplisit sebagai boolean supaya tombol bisa
    // dipakai dua arah — menandai selesai, dan membukanya kembali kalau keliru.
    status = body.done === true ? "done" : "new";
  }

  // Kolom teks opsional. String kosong dikirim sebagai `null` (bukan ""), supaya
  // menghapus nomor resi yang salah ketik benar-benar mengosongkannya.
  const optionalText = (key: string): string | null | undefined => {
    if (body[key] === undefined) return undefined;
    const v = String(body[key] || "").trim();
    return v || null;
  };

  const result = await setBuyerOrderStatus(id, auth.storeId, status, {
    tracking_number: optionalText("tracking_number"),
    payment_proof_url: optionalText("payment_proof_url"),
    note: optionalText("note")
  });
  if (!result.ok) {
    if (result.skipped) {
      return NextResponse.json(
        { error: "Tabel pesanan belum ada. Jalankan supabase/schema.sql versi terbaru." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.error || "Gagal memperbarui pesanan." }, { status: 500 });
  }

  return NextResponse.json({ success: true, order: result.data });
}

/** Hapus pesanan yang salah rekam. */
export async function DELETE(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Id pesanan wajib diisi." }, { status: 400 });
  }

  const result = await deleteBuyerOrder(id, auth.storeId);
  if (!result.ok) {
    if (result.skipped) {
      return NextResponse.json(
        { error: "Tabel pesanan belum ada. Jalankan supabase/schema.sql versi terbaru." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.error || "Gagal menghapus pesanan." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
