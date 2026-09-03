import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { getProductsByStoreId, getStoreByEmail, isStoreActive } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/reply-engine";
import { processAICustomerService } from "@/lib/ai";
import { normalizeActiveCouriers, normalizeLocalCourier } from "@/lib/couriers";
import { normalizeAiTone, normalizePaymentAccounts } from "@/lib/reply-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pratinjau balasan AI untuk pemilik toko.
 *
 * BEDANYA DENGAN `/api/test-reply`: endpoint itu menjalankan bot sungguhan —
 * pesannya DIKIRIM ke WhatsApp, percakapannya disimpan, dan kuota bulanan
 * terpakai. Endpoint ini tidak mengirim apa pun, tidak menyimpan percakapan, dan
 * tidak memotong kuota; ia hanya menyusun balasan lalu mengembalikan teksnya.
 * Karena itu pemilik toko bisa mencobanya berkali-kali sambil menyetel instruksi
 * AI, nada bicara, dan cara bayar — tanpa mengotori riwayat chat pembeli.
 *
 * Pengaturan boleh dikirim dari FORM YANG BELUM DISIMPAN (`settings`), supaya
 * pemilik toko bisa menilai hasil perubahannya sebelum menekan Simpan. Nilai yang
 * dikirim dinormalkan dengan helper yang sama dengan `/api/store` POST — jadi
 * body request tidak pernah menjadi jalan pintas memasukkan teks/kode mentah ke
 * prompt AI. Yang TIDAK bisa dititipkan lewat body: katalog produk (selalu dari
 * database toko ini) dan kredensial apa pun.
 */
export async function POST(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Sesi tidak valid. Silakan login ulang." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const messageText = String(body.message || "").trim().slice(0, 600);
  if (!messageText) {
    return NextResponse.json({ error: "Contoh pesan pembeli tidak boleh kosong." }, { status: 400 });
  }

  const store = await getStoreByEmail(email);
  if (!store) {
    return NextResponse.json({ error: "Data toko tidak ditemukan." }, { status: 404 });
  }
  if (!isStoreActive(store)) {
    return NextResponse.json(
      { error: "Masa aktif toko sudah berakhir. Silakan berlangganan untuk melanjutkan." },
      { status: 403 }
    );
  }

  // Pratinjau tidak memotong kuota percakapan, tapi tetap dibatasi lajunya:
  // jalur AI final memanggil Gemini, dan tombol yang diklik berulang-ulang tidak
  // boleh menjadi cara memakai API key toko tanpa batas.
  const rate = await checkRateLimit(store.id || email, "preview");
  if (!rate.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak pratinjau. Coba lagi dalam ${rate.retryAfterSec} detik.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
    );
  }

  // Pengaturan dari form yang belum disimpan; kosong = pakai yang tersimpan.
  const s = (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
    ? body.settings
    : {}) as Record<string, unknown>;

  const pickString = (key: string, fallback: string | undefined, max: number): string => {
    const v = s[key];
    return typeof v === "string" ? v.slice(0, max) : fallback || "";
  };
  const pickBool = (key: string, fallback: boolean): boolean =>
    s[key] === undefined ? fallback : s[key] === true;

  const rawWeight = Number(s.default_weight);
  const defaultWeight = Number.isFinite(rawWeight) && rawWeight > 0
    ? Math.min(50000, Math.max(100, Math.round(rawWeight)))
    : store.default_weight || 1000;

  const products = store.id ? await getProductsByStoreId(store.id) : [];

  // Kalau pemilik toko tidak menyebut tujuan di contoh pesannya, ongkir tetap
  // bisa dihitung dari alamat contoh — persis seperti yang dialami pembeli.
  const sampleName = String(body.customerName || "").trim().slice(0, 60) || null;
  const sampleAddress = String(body.customerAddress || "").trim().slice(0, 400) || null;
  const sampleCity = String(body.destinationCity || "").trim().slice(0, 80) || null;

  try {
    const result = await processAICustomerService({
      messageText,
      storeName: pickString("store_name", store.store_name, 120) || "Toko",
      aiPromptSystem: pickString("ai_prompt_system", store.ai_prompt_system, 4000),
      greetingMessage: pickString("greeting_message", store.greeting_message, 1000),
      // TANPA nilai bawaan, walaupun ini "cuma" pratinjau. Justru karena ini
      // pratinjau: gunanya memperlihatkan apa yang BENAR-BENAR diterima pembeli.
      // Dulu di sini ada "3171010"/"Jakarta Pusat", sehingga toko yang belum
      // menyetel lokasi asal melihat tarif lengkap di dashboard sementara
      // pembelinya menerima balasan tanpa angka — pratinjau yang menyesatkan
      // pemiliknya persis pada satu pengaturan yang belum ia isi.
      originSubdistrictId: pickString("origin_subdistrict_id", store.origin_subdistrict_id, 64),
      originCityName: pickString("origin_city_name", store.origin_city_name, 160),
      mengantarApiKey: store.mengantar_api_key,
      defaultWeight,
      products: products.map((p) => ({
        name: p.name,
        price: Number(p.price) || 0,
        weight: Number(p.weight) || 0,
        description: p.description || undefined
      })),
      // Pratinjau berdiri sendiri: tanpa riwayat, tanpa memori percakapan.
      chatHistory: [],
      aiContextMessages: 0,
      activeCouriers:
        s.active_couriers === undefined
          ? normalizeActiveCouriers(store.active_couriers)
          : normalizeActiveCouriers(s.active_couriers),
      localCourier:
        s.local_courier === undefined
          ? normalizeLocalCourier(store.local_courier)
          : normalizeLocalCourier(s.local_courier),
      paymentAccounts:
        s.payment_accounts === undefined
          ? normalizePaymentAccounts(store.payment_accounts)
          : normalizePaymentAccounts(s.payment_accounts),
      codEnabled: pickBool("cod_enabled", store.cod_enabled === true),
      paymentNote: pickString("payment_note", store.payment_note || "", 600),
      aiTone: s.ai_tone === undefined ? normalizeAiTone(store.ai_tone) : normalizeAiTone(s.ai_tone),
      includeTotal: pickBool("ai_include_total", store.ai_include_total ?? true),
      includePayment: pickBool("ai_include_payment", store.ai_include_payment ?? true),
      knownCustomerName: sampleName,
      knownCustomerAddress: sampleAddress,
      knownDestinationCity: sampleCity,
      // `final: true` = minta AI menuliskan ulang (inilah "balasan final" yang
      // benar-benar diterima pembeli). Tanpa itu hanya isi deterministiknya yang
      // disusun — instan, tanpa memanggil model.
      disableAiNarration: body.final !== true
    });

    return NextResponse.json({
      success: true,
      reply: result.replyText,
      intent: result.intent,
      /** `true` = kalimat di atas benar-benar tulisan AI. */
      aiNarrated: result.aiNarrated === true,
      aiFallbackReason: result.aiFallbackReason,
      aiRejectedNumber: result.aiRejectedNumber,
      detectedCity: result.detectedCity,
      rateSource: result.rateSource,
      shippingWeightGram: result.shippingWeightGram,
      // Angka yang dipakai menyusun balasan — supaya pemilik toko bisa memeriksa
      // apakah jumlah barang & subtotalnya sudah terbaca benar.
      totalUnits: result.orderDraft?.totalUnits ?? 0,
      subtotal: result.orderDraft?.subtotal ?? 0,
      matchedProducts: (result.orderDraft?.lines || []).map((l) => ({ name: l.name, units: l.units })),
      ambiguous: result.orderDraft?.ambiguous || [],
      orderCommit: result.orderCommit === true,
      // Balasannya sengaja tanpa angka ongkir karena lokasi asal belum disetel.
      // Harus ikut dikembalikan: tanpa penjelasan ini, pemilik toko melihat
      // pratinjau tanpa tarif dan menyimpulkan botnya rusak.
      originMissing: result.originMissing === true
    });
  } catch (err) {
    console.error("[store/preview-reply] gagal:", err);
    return NextResponse.json({ error: "Gagal menyusun pratinjau balasan." }, { status: 500 });
  }
}
