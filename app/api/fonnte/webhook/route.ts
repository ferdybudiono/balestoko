import { NextResponse } from "next/server";
import { getStoreByFonnteToken, getStoreByDevicePhone, getProductsByStoreId, getConversation, saveConversationMessage, isStoreActive } from "@/lib/supabase";
import { processAICustomerService } from "@/lib/ai";
import { sendFonnteMessage } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fonnte Webhook Receiver Endpoint
 * URL untuk Fonnte Dashboard: https://DOMAIN-ANDA.vercel.app/api/fonnte/webhook
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      body = (await req.json()) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  // Fonnte payload parameters
  const sender = String(body.sender || body.from || body.phone || "");
  const messageText = String(body.message || body.text || "");
  // `device` = NOMOR device penerima (payload webhook Fonnte TIDAK memuat token).
  const deviceNumber = String(body.device || "");

  // Abaikan event status / pesan kosong / pesan broadcast keluar
  if (!sender || !messageText || messageText.trim() === "") {
    return NextResponse.json({ status: "ignored", reason: "Message or sender empty" });
  }

  try {
    // 1. Cari toko berdasarkan NOMOR device penerima (utama). Fallback ke token
    //    bila suatu konfigurasi mengirimkannya via body/header.
    let store = deviceNumber ? await getStoreByDevicePhone(deviceNumber) : null;
    if (!store) {
      const maybeToken = String(body.token || req.headers.get("authorization") || "");
      if (maybeToken) store = await getStoreByFonnteToken(maybeToken);
    }

    // Device tidak dikenal → abaikan. Jangan salah-arahkan pesan ke toko lain.
    if (!store) {
      console.warn(
        `[fonnte webhook] device tidak dikenal (device=${deviceNumber}), pesan diabaikan.`
      );
      return NextResponse.json({ status: "ignored", reason: "Unknown device" });
    }

    // Toko nonaktif (trial habis & belum bayar) → jangan proses AI (cegah pemakaian gratis).
    if (!isStoreActive(store)) {
      console.warn("[fonnte webhook] toko nonaktif / trial berakhir, pesan diabaikan.");
      return NextResponse.json({ status: "ignored", reason: "Store inactive or trial expired" });
    }

    const storeName = store.store_name || "Toko Bot WA CS AI";
    const storeId = store.id || "";
    const originSubdistrictId = store.origin_subdistrict_id || "3171010";
    const originCityName = store.origin_city_name || "Jakarta Pusat";
    const mengantarApiKey = store.mengantar_api_key;
    const defaultWeight = store.default_weight || 1000;
    const aiPromptSystem = store.ai_prompt_system;
    const greetingMessage = store.greeting_message;

    // 2. Ambil katalog produk & riwayat chat pembeli dari Supabase
    const products = storeId ? await getProductsByStoreId(storeId) : [];
    const conversation = await getConversation(storeId, sender);

    // 3. Olah pesan dengan AI CS Engine (Greeting -> Ongkir Mengantar -> Produk)
    const aiResult = await processAICustomerService({
      messageText,
      storeName,
      aiPromptSystem,
      greetingMessage,
      originSubdistrictId,
      originCityName,
      mengantarApiKey,
      defaultWeight,
      products,
      chatHistory: conversation?.messages || []
    });

    // 4. Kirim balasan WhatsApp ke pembeli lewat device token milik toko.
    const activeFonnteToken = store.fonnte_token || process.env.FONNTE_TOKEN;
    if (activeFonnteToken) {
      const sent = await sendFonnteMessage({
        target: sender,
        message: aiResult.replyText,
        token: activeFonnteToken
      });
      if (!sent.success) {
        console.warn("[fonnte webhook] gagal mengirim balasan:", sent.error);
      }
    } else {
      console.log("[fonnte webhook simulated reply]:", aiResult.replyText);
    }

    // 5. Simpan riwayat percakapan ke Supabase DB
    if (storeId) {
      await saveConversationMessage(
        storeId,
        sender,
        messageText,
        aiResult.replyText,
        aiResult.intent,
        aiResult.detectedCity
      );
    }

    return NextResponse.json({
      success: true,
      sender,
      intent: aiResult.intent,
      reply: aiResult.replyText
    });
  } catch (err) {
    console.error("[fonnte webhook error]:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
