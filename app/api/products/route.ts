import { NextResponse } from "next/server";
import {
  countProducts,
  insertProduct,
  updateProduct,
  deleteProduct,
  getProductsByStoreId,
  getStoreByEmail
} from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Batas wajar supaya angka konyol tidak merusak perhitungan ongkir / tampilan. */
const MAX_PRICE = 1_000_000_000; // Rp 1 miliar
const MAX_WEIGHT = 50_000; // 50 kg
const MAX_STOCK = 1_000_000;

/**
 * Batas jumlah produk per toko.
 *
 * Bukan soal ruang penyimpanan: SELURUH katalog ikut masuk ke prompt Gemini pada
 * pertanyaan produk (lihat `lib/ai.ts`). Katalog tanpa batas berarti prompt tanpa
 * batas — biaya token membengkak, balasan makin lambat, dan pada titik tertentu
 * permintaannya ditolak model. 300 sudah jauh di atas kebutuhan toko WA biasa.
 */
const MAX_PRODUCTS = 300;

/** Ambil store milik user yang sedang login, atau null. */
async function getSessionStore() {
  const email = await getSessionEmail();
  if (!email) return null;
  return getStoreByEmail(email);
}

/**
 * Validasi & normalisasi field produk dari body request.
 * `partial` = true untuk PATCH (hanya field yang dikirim yang divalidasi).
 */
function parseProductFields(
  body: Record<string, unknown>,
  partial: boolean
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const fields: Record<string, unknown> = {};

  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? "").trim();
    if (!name) return { ok: false, error: "Nama produk wajib diisi." };
    fields.name = name.slice(0, 200);
  }

  if (body.price !== undefined || !partial) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: "Harga harus berupa angka lebih besar dari 0." };
    }
    if (price > MAX_PRICE) {
      return { ok: false, error: "Harga terlalu besar." };
    }
    fields.price = Math.round(price);
  }

  if (body.weight !== undefined) {
    const weight = Number(body.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return { ok: false, error: "Berat harus berupa angka lebih besar dari 0 gram." };
    }
    if (weight > MAX_WEIGHT) {
      return { ok: false, error: `Berat maksimal ${MAX_WEIGHT / 1000} kg.` };
    }
    fields.weight = Math.round(weight);
  } else if (!partial) {
    fields.weight = 1000;
  }

  if (body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isFinite(stock) || stock < 0) {
      return { ok: false, error: "Stok tidak boleh negatif." };
    }
    fields.stock = Math.min(MAX_STOCK, Math.round(stock));
  } else if (!partial) {
    fields.stock = 100;
  }

  if (body.description !== undefined) {
    fields.description = String(body.description ?? "").trim().slice(0, 1000);
  } else if (!partial) {
    fields.description = "";
  }

  if (partial && Object.keys(fields).length === 0) {
    return { ok: false, error: "Tidak ada perubahan yang dikirim." };
  }

  return { ok: true, fields };
}

export async function GET() {
  const store = await getSessionStore();
  if (!store?.id) {
    return NextResponse.json({ products: [] });
  }
  const products = await getProductsByStoreId(store.id);
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const store = await getSessionStore();
  if (!store?.id) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parseProductFields(body, false);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Hitungan gagal (`null`) dibiarkan lewat: memblokir pemilik toko menambah
    // produk karena satu query bermasalah lebih merugikan daripada kelebihan
    // beberapa baris di atas batas.
    const existing = await countProducts(store.id);
    if (existing !== null && existing >= MAX_PRODUCTS) {
      return NextResponse.json(
        {
          error: `Katalog sudah mencapai batas ${MAX_PRODUCTS} produk. Hapus produk yang tidak dipakai lebih dulu.`
        },
        { status: 409 }
      );
    }

    // store_id dikunci ke store milik session — abaikan store_id dari client.
    const res = await insertProduct({
      store_id: store.id,
      ...parsed.fields
    } as Parameters<typeof insertProduct>[0]);

    if (!res.ok) {
      console.error("[products] insert gagal:", res.error);
      return NextResponse.json({ error: "Gagal menambah produk." }, { status: 500 });
    }

    return NextResponse.json({ success: true, product: res.data });
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const store = await getSessionStore();
  if (!store?.id) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const productId = String(body.id ?? "").trim();
    if (!productId) {
      return NextResponse.json({ error: "ID produk kosong." }, { status: 400 });
    }

    const parsed = parseProductFields(body, true);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const res = await updateProduct(productId, store.id, parsed.fields);
    if (!res.ok) {
      if (res.notFound) {
        return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
      }
      console.error("[products] update gagal:", res.error);
      return NextResponse.json({ error: "Gagal menyimpan perubahan produk." }, { status: 500 });
    }

    return NextResponse.json({ success: true, product: res.data });
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const store = await getSessionStore();
  if (!store?.id) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("id");
  if (!productId) {
    return NextResponse.json({ error: "ID Produk kosong" }, { status: 400 });
  }

  // Kepemilikan ditegakkan di query (store_id=eq.<session store>).
  const res = await deleteProduct(productId, store.id);
  if (!res.ok) {
    if (res.notFound) {
      return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
    }
    console.error("[products] delete gagal:", res.error);
    return NextResponse.json({ error: "Gagal menghapus produk." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
