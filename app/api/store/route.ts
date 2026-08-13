import { NextResponse } from "next/server";
import { getStoreByEmail, upsertStore, getAllConversations, getProductsByStoreId } from "@/lib/supabase";
import { getFonnteDeviceStatus } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store Configuration API (GET store settings, conversations, and Fonnte status; POST update store config)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email") || "demo@balestoko.com";

  try {
    let store = await getStoreByEmail(email);
    if (!store) {
      // Buat default demo store jika belum ada
      const created = await upsertStore({
        email,
        store_name: "Toko Online Saya",
        is_paid: true,
        origin_subdistrict_id: "3171010",
        origin_city_name: "Jakarta Pusat",
        ai_prompt_system: "Kamu adalah CS AI yang ramah dan membantu pembeli mengecek ongkir Mengantar dan membeli produk.",
        greeting_message: "Halo! Selamat datang di toko kami 👋 Ada yang bisa kami bantu mengenai produk atau cek ongkir ke kota Kakak?"
      });
      if (created.data) store = created.data;
    }

    let fonnteStatus: { status: boolean; device?: string; reason?: string } = {
      status: false,
      device: "DISCONNECTED",
      reason: "Token Fonnte belum di-set"
    };
    if (store?.fonnte_token) {
      fonnteStatus = await getFonnteDeviceStatus(store.fonnte_token);
    }

    const conversations = store?.id ? await getAllConversations(store.id) : [];
    const products = store?.id ? await getProductsByStoreId(store.id) : [];

    return NextResponse.json({
      store,
      fonnteStatus,
      conversations,
      products
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email = "demo@balestoko.com", ...settings } = body;

    const result = await upsertStore({
      email,
      ...settings
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Gagal menyimpan konfigurasi toko." }, { status: 500 });
    }

    return NextResponse.json({ success: true, store: result.data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
