import { NextResponse } from "next/server";
import { insertProduct, deleteProduct, getProductsByStoreId, getStoreByEmail } from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ambil store milik user yang sedang login, atau null. */
async function getSessionStore() {
  const email = await getSessionEmail();
  if (!email) return null;
  return getStoreByEmail(email);
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
    const body = await req.json();
    const { name, price, weight, description, stock } = body;

    if (!name || !price) {
      return NextResponse.json({ error: "Nama produk dan harga wajib diisi." }, { status: 400 });
    }

    // store_id dikunci ke store milik session — abaikan store_id dari client.
    const res = await insertProduct({
      store_id: store.id,
      name: String(name).trim(),
      price: Number(price) || 0,
      weight: Number(weight) || 1000,
      description: description ? String(description).trim() : "",
      stock: Number(stock) || 100
    });

    if (!res.ok) {
      return NextResponse.json({ error: res.error || "Gagal menambah produk." }, { status: 500 });
    }

    return NextResponse.json({ success: true, product: res.data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
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

  // Pastikan produk memang milik toko session sebelum dihapus.
  const owned = await getProductsByStoreId(store.id);
  if (!owned.some((p) => p.id === productId)) {
    return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const res = await deleteProduct(productId);
  return NextResponse.json({ success: res.ok });
}
