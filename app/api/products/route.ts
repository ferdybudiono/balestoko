import { NextResponse } from "next/server";
import { insertProduct, deleteProduct, getProductsByStoreId } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId");

  if (!storeId) {
    return NextResponse.json({ products: [] });
  }

  const products = await getProductsByStoreId(storeId);
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { store_id, name, price, weight, description, stock } = body;

    if (!store_id || !name || !price) {
      return NextResponse.json({ error: "Nama produk, toko, dan harga wajib diisi." }, { status: 400 });
    }

    const res = await insertProduct({
      store_id,
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
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("id");

  if (!productId) {
    return NextResponse.json({ error: "ID Produk kosong" }, { status: 400 });
  }

  const res = await deleteProduct(productId);
  return NextResponse.json({ success: res.ok });
}
