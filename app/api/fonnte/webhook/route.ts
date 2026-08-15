import { NextResponse } from "next/server";
import { getStoreByFonnteToken, getProductsByStoreId, getConversation, saveConversationMessage, isStoreActive } from "@/lib/supabase";
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
  const deviceToken = String(body.device || req.headers.get("authorization") || "");

  // Abaikan event status / pesan kosong / pesan broadcast keluar
  if (!sender || !messageText || messageText.trim() === "") {
    return NextResponse.json({ status: "ignored", reason: "Message or sender empty" });
  }

  try {
    // 1. Cari toko berdasarkan token Fonnte (device token) — WAJIB cocok.
    const store = await getStoreByFonnteToken(deviceToken);

    // Token device tidak dikenal → abaikan. Jangan salah-arahkan pesan ke toko lain.
    if (!store) {
      console.warn("[fonnte webhook] device token tidak dikenal, pesan diabaikan.");
      return NextResponse.json({ status: "ignored", reason: "Unknown device token" });
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
      products,
      chatHistory: conversation?.messages || []
    });

    // 4. Kirim balasan WhatsApp ke pembeli lewat Fonnte
    const activeFonnteToken = store.fonnte_token || deviceToken || process.env.FONNTE_TOKEN;
    if (activeFonnteToken) {
      await sendFonnteMessage({
        target: sender,
        message: aiResult.replyText,
        token: activeFonnteToken
      });
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
