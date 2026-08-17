import { processAICustomerService, type AIProcessResult } from "@/lib/ai";
import { sendFonnteMessage } from "@/lib/fonnte";
import {
  getConversation,
  getProductsByStoreId,
  saveConversationMessage,
  type StoreRecord
} from "@/lib/supabase";

/**
 * Mesin balasan otomatis — dipakai bersama oleh webhook Fonnte (pesan asli
 * pembeli) dan endpoint uji coba dari dashboard, supaya logikanya tidak
 * bercabang dua.
 */

export interface AutoReplyOutcome {
  replyText: string;
  intent: AIProcessResult["intent"];
  detectedCity?: string;
  /** Balasan benar-benar terkirim lewat WhatsApp (bukan hanya tersimpan). */
  delivered: boolean;
  deliveryError?: string;
}

// ── Pembatas laju ────────────────────────────────────────────────────────
// Tiap pesan masuk memicu panggilan Gemini + kirim WhatsApp berbayar, jadi
// satu pengirim yang membanjiri (atau loop balasan antar-bot) harus dibendung.
// Peta in-memory: cukup untuk satu instance serverless; pembatas lintas-region
// butuh Redis, tapi ini sudah memblokir kasus banjir yang nyata.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_SENDER = 8;
const rateBuckets = new Map<string, number[]>();

/** Buang kunci kedaluwarsa agar peta tidak tumbuh tanpa batas. */
function sweepRateBuckets(now: number): void {
  if (rateBuckets.size < 500) return;
  for (const [key, hits] of rateBuckets) {
    if (hits.every((t) => now - t > RATE_WINDOW_MS)) rateBuckets.delete(key);
  }
}

export function checkRateLimit(storeId: string, sender: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweepRateBuckets(now);
  const key = `${storeId}:${sender}`;
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_PER_SENDER) {
    const oldest = hits[0];
    return { ok: false, retryAfterSec: Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000) };
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Olah satu pesan masuk: AI menyusun balasan, balasan dikirim ke pengirim,
 * lalu percakapan disimpan.
 */
export async function runAutoReply(params: {
  store: StoreRecord;
  sender: string;
  messageText: string;
  /**
   * DEVICE token yang harus dipakai mengirim balasan — yaitu device yang
   * menerima pesan itu, supaya balasan keluar dari nomor yang sama dengan yang
   * dihubungi pembeli. Kosong = balasan hanya disusun & disimpan.
   */
  deviceToken?: string | null;
  /** false = hanya susun balasan, jangan kirim lewat WhatsApp. */
  send?: boolean;
}): Promise<AutoReplyOutcome> {
  const { store, sender, messageText, deviceToken, send = true } = params;
  const storeId = store.id || "";

  const [products, conversation] = await Promise.all([
    storeId ? getProductsByStoreId(storeId) : Promise.resolve([]),
    storeId ? getConversation(storeId, sender) : Promise.resolve(null)
  ]);

  const aiResult = await processAICustomerService({
    messageText,
    storeName: store.store_name || "Toko Bot WA CS AI",
    aiPromptSystem: store.ai_prompt_system,
    greetingMessage: store.greeting_message,
    originSubdistrictId: store.origin_subdistrict_id || "3171010",
    originCityName: store.origin_city_name || "Jakarta Pusat",
    mengantarApiKey: store.mengantar_api_key,
    defaultWeight: store.default_weight || 1000,
    products,
    chatHistory: conversation?.messages || []
  });

  let delivered = false;
  let deliveryError: string | undefined;

  if (send) {
    // JANGAN jatuh ke FONNTE_TOKEN (account token) di sini: di deployment
    // multi-tenant token itu bisa mengirim lewat device toko lain, jadi balasan
    // pembeli berpotensi keluar dari nomor yang bukan miliknya.
    const token = deviceToken || null;
    if (token) {
      const sent = await sendFonnteMessage({ target: sender, message: aiResult.replyText, token });
      delivered = sent.success;
      if (!sent.success) {
        deliveryError = sent.error;
        console.warn("[auto-reply] gagal mengirim balasan:", sent.error);
      }
    } else {
      deliveryError = "Device WhatsApp toko belum terhubung.";
      console.log("[auto-reply] tanpa token device, balasan tidak dikirim:", aiResult.replyText);
    }
  }

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

  return {
    replyText: aiResult.replyText,
    intent: aiResult.intent,
    detectedCity: aiResult.detectedCity,
    delivered,
    deliveryError
  };
}
