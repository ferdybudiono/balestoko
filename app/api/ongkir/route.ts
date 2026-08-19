import { NextResponse } from "next/server";
import { searchMengantarLocation, calculateMengantarOngkir } from "@/lib/mengantar";
import { getStoreByEmail } from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint internal Cek Ongkir Mengantar API — HANYA untuk user yang login.
 *
 * Dulu endpoint ini terbuka dan menerima `apiKey` dari query/body, sehingga
 * siapa pun bisa memakainya sebagai proxy gratis ke Mengantar. Sekarang key
 * selalu diambil dari record toko milik session.
 *
 * GET  /api/ongkir?q=Bandung                        → cari lokasi
 * POST /api/ongkir { destinationId, weightGram }    → hitung tarif dari toko ini
 */
export async function GET(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  if (!q.trim()) {
    return NextResponse.json({ locations: [], source: "live" });
  }

  try {
    const store = await getStoreByEmail(email);
    const { locations, source } = await searchMengantarLocation(q, store?.mengantar_api_key);
    return NextResponse.json({ locations, source });
  } catch (err) {
    console.error("[ongkir] search gagal:", err);
    return NextResponse.json({ error: "Gagal mencari lokasi." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  try {
    const store = await getStoreByEmail(email);
    if (!store) {
      return NextResponse.json({ error: "Toko tidak ditemukan untuk akun ini." }, { status: 404 });
    }

    const body = await req.json();
    const destinationId = String(body.destinationId || "").trim();
    if (!destinationId) {
      return NextResponse.json({ error: "Lokasi tujuan wajib dipilih." }, { status: 400 });
    }

    // Origin & API key selalu dari toko session — tidak bisa di-override client.
    const originId = store.origin_subdistrict_id || "3171010";
    const weightRaw = Number(body.weightGram);
    const weightGram =
      Number.isFinite(weightRaw) && weightRaw > 0 ? Math.round(weightRaw) : store.default_weight || 1000;

    const { rates, source } = await calculateMengantarOngkir({
      originSubdistrictId: originId,
      destinationSubdistrictId: destinationId,
      weightGram,
      // Tes ongkir harus memperlihatkan APA YANG DILIHAT PEMBELI. Tanpa filter
      // ini pemilik toko akan melihat 16 ekspedisi di dashboard padahal botnya
      // hanya menawarkan yang diceklis.
      couriers: store.active_couriers,
      apiKey: store.mengantar_api_key
    });

    return NextResponse.json({
      rates,
      source,
      originCityName: store.origin_city_name || "",
      weightGram
    });
  } catch (err) {
    console.error("[ongkir] hitung tarif gagal:", err);
    return NextResponse.json({ error: "Gagal menghitung ongkir." }, { status: 500 });
  }
}
