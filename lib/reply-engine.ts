import { processAICustomerService, type AIProcessResult, type ChatMessage } from "@/lib/ai";
import { sendFonnteMessage } from "@/lib/fonnte";
import { notifyNewOrder, notifyOriginMissing } from "@/lib/notify";
import { aiContextMessagesForPackage, monthlyConversationLimit, monthStartMs } from "@/lib/packages";
import {
  appendBuyerMessage,
  bumpRateLimit,
  countConversationsThisMonth,
  decrementProductStock,
  getConversation,
  getOpenBuyerOrder,
  getProductsByStoreId,
  normalizeDeviceProductIds,
  recordBuyerOrder,
  saveConversationMessage,
  type BuyerOrderItem,
  type ProductRecord,
  type StoreDeviceRecord,
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
  /** Nama/alamat pembeli yang BARU terbaca dari pesan ini. */
  capturedName?: string | null;
  capturedAddress?: string | null;
  /** Pesanan pembeli dicatat/diperbarui di daftar pesanan. */
  orderRecorded?: boolean;
  /**
   * Percakapan ini sedang ditangani manusia (`ai_paused`), jadi bot sengaja diam.
   *
   * Dibedakan dari kegagalan: webhook memakai ini untuk mencatat "AI dijeda" pada
   * device, bukan "gagal membalas" — dan pemilik toko tidak dikirimi peringatan
   * untuk sesuatu yang dia sendiri nyalakan.
   */
  aiPaused?: boolean;
  /** Pesanan TIDAK dicatat karena ada barang habis di dalamnya. */
  stockBlocked?: boolean;
  /**
   * Pembeli menanyakan ongkir tapi toko belum menetapkan lokasi asal pengiriman,
   * jadi balasannya sengaja tanpa satu pun angka tarif.
   *
   * Diteruskan ke pemanggil supaya pratinjau dashboard bisa menjelaskan KENAPA
   * balasannya tidak memuat ongkir — kalau tidak, pemilik toko membacanya sebagai
   * bot yang rusak, bukan sebagai pengaturan yang belum ia isi.
   */
  originMissing?: boolean;
}

// ── Pembatas laju ────────────────────────────────────────────────────────
// Tiap pesan masuk memicu panggilan Gemini + kirim WhatsApp berbayar, jadi
// satu pengirim yang membanjiri (atau loop balasan antar-bot) harus dibendung.
//
// Penegakan UTAMA ada di database (`bump_rate_limit`), bukan di memori proses:
// satu deployment serverless berjalan di banyak instance sekaligus, jadi peta
// in-memory sebenarnya berarti "batas × jumlah instance". Peta lokal tetap
// dipertahankan sebagai jaring kedua untuk saat RPC-nya tidak tersedia (env
// belum di-set, atau `schema.sql` versi baru belum dijalankan).
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

/** Pembatas cadangan: hanya berlaku untuk instance ini. */
function checkRateLimitLocal(storeId: string, sender: string): { ok: boolean; retryAfterSec: number } {
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

export async function checkRateLimit(
  storeId: string,
  sender: string
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const verdict = await bumpRateLimit(
    `wa:${storeId}:${sender}`,
    Math.round(RATE_WINDOW_MS / 1000),
    RATE_MAX_PER_SENDER
  );
  if (verdict.enforced) {
    return { ok: verdict.allowed, retryAfterSec: verdict.retryAfterSec };
  }
  return checkRateLimitLocal(storeId, sender);
}

// ── Kuota percakapan bulanan ─────────────────────────────────────────────

export interface QuotaCheck {
  ok: boolean;
  /** Percakapan terpakai bulan ini; `null` bila hitungan tidak tersedia. */
  used: number | null;
  /** `null` = paket tanpa batas. */
  limit: number | null;
}

/**
 * Apakah pesan dari `sender` masih boleh diproses menurut kuota paket?
 *
 * Dipanggil SEBELUM `runAutoReply` karena tiap pesan yang lolos memicu biaya
 * Gemini + kirim WhatsApp. Dua keputusan penting di sini:
 *
 * 1. Pembeli yang percakapannya SUDAH aktif bulan ini selalu lolos, walau kuota
 *    sudah penuh. Kuota menghitung percakapan, bukan pesan — kalau pembeli ke-1
 *    tiba-tiba tidak dibalas di tengah tanya-jawab hanya karena pembeli ke-1000
 *    baru masuk, itu memutus percakapan yang sudah dibayar.
 * 2. Hitungan yang GAGAL (`null`) diperlakukan sebagai lolos, bukan blokir.
 *    Satu query Supabase yang error tidak boleh mematikan bot toko berbayar.
 */
export async function checkConversationQuota(
  store: StoreRecord,
  sender: string
): Promise<QuotaCheck> {
  const limit = monthlyConversationLimit(store.package_id);
  if (limit === null) return { ok: true, used: null, limit: null };

  const storeId = store.id || "";
  if (!storeId) return { ok: true, used: null, limit };

  const existing = await getConversation(storeId, sender);
  const lastTouch = existing?.updated_at ? new Date(existing.updated_at).getTime() : NaN;
  if (Number.isFinite(lastTouch) && lastTouch >= monthStartMs()) {
    return { ok: true, used: null, limit };
  }

  const used = await countConversationsThisMonth(storeId);
  if (used === null) return { ok: true, used: null, limit };
  return { ok: used < limit, used, limit };
}

/**
 * Katalog yang DIJAWAB satu nomor.
 *
 * Paket Pro punya beberapa nomor, dan pemilik toko boleh mengkhususkan satu nomor
 * untuk sebagian produk (mis. nomor grosir vs nomor ritel). Penyaringan dilakukan
 * di sini — sebelum produk masuk ke prompt AI maupun ke pencocokan pesanan —
 * supaya nomor itu tidak pernah bisa mengutip harga produk yang bukan urusannya.
 *
 * Daftar kosong = nomor umum: seluruh katalog. Begitu juga bila penyaringnya
 * menyisakan nol produk (id produk sudah dihapus): lebih baik menjawab seluruh
 * katalog daripada nomor yang mendadak bisu dan tidak tahu produk apa pun.
 */
function productsForDevice(
  products: ProductRecord[],
  device?: StoreDeviceRecord | null
): ProductRecord[] {
  const scope = normalizeDeviceProductIds(device?.product_ids);
  if (scope.length === 0) return products;
  const allowed = products.filter((p) => p.id && scope.includes(p.id));
  return allowed.length > 0 ? allowed : products;
}

/** Balasan bot terakhir dalam riwayat — penanda slot apa yang sedang ditunggu. */
function lastAssistantText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "assistant" && m.content) return m.content;
  }
  return null;
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
  /**
   * Baris device penerima. Dipakai untuk dua hal: mempersempit katalog ke produk
   * yang memang dijawab nomor ini, dan mencatat pesanan atas nama nomor tersebut.
   */
  device?: StoreDeviceRecord | null;
  /** false = hanya susun balasan, jangan kirim lewat WhatsApp. */
  send?: boolean;
}): Promise<AutoReplyOutcome> {
  const { store, sender, messageText, deviceToken, device, send = true } = params;
  const storeId = store.id || "";

  const [allProducts, conversation] = await Promise.all([
    storeId ? getProductsByStoreId(storeId) : Promise.resolve([]),
    storeId ? getConversation(storeId, sender) : Promise.resolve(null)
  ]);

  const products = productsForDevice(allProducts, device);
  const history = conversation?.messages || [];

  // ── Percakapan yang sedang diambil alih manusia ──────────────────────────
  //
  // Diperiksa SEBELUM apa pun yang berbiaya: memanggil Gemini lalu membuang
  // hasilnya berarti pemilik toko membayar token untuk balasan yang tidak pernah
  // dikirim. Pesan pembelinya tetap dicatat — kalau tidak, pemilik toko membuka
  // chat dan tidak melihat pertanyaan yang baru saja masuk.
  if (conversation?.ai_paused === true) {
    if (storeId) await appendBuyerMessage({ storeId, phone: sender, text: messageText });
    return {
      replyText: "",
      intent: "GENERAL_CHAT",
      delivered: false,
      aiPaused: true
    };
  }

  const aiResult = await processAICustomerService({
    messageText,
    storeName: store.store_name || "Toko Bot WA CS AI",
    aiPromptSystem: store.ai_prompt_system,
    greetingMessage: store.greeting_message,
    // Dikirim apa adanya, TANPA nilai bawaan. Dulu di sini ada "3171010"
    // (Gambir, Jakarta Pusat), sehingga toko yang belum mengisi lokasi asal
    // membuat bot mengarang tarif dari Jakarta dan menyebut kota asal yang salah
    // ke pembelinya. Sekarang kosongnya diteruskan utuh: `lib/ai.ts` mengenalinya
    // lewat `isMengantarId` dan membalas tanpa satu pun angka ongkir, lalu
    // menyalakan `originMissing` supaya pemiliknya dikabari.
    originSubdistrictId: store.origin_subdistrict_id,
    originCityName: store.origin_city_name,
    mengantarApiKey: store.mengantar_api_key,
    defaultWeight: store.default_weight || 1000,
    products,
    chatHistory: history,
    // Memori percakapan = fitur berbayar. Riwayatnya tetap dikirim (dipakai
    // mendeteksi sapaan pertama), tapi hanya paket Pro yang riwayatnya ikut
    // masuk ke prompt model.
    aiContextMessages: aiContextMessagesForPackage(store.package_id),
    // Pengaturan ekspedisi, pembayaran, & gaya jawaban dari tab Pengaturan Toko.
    // `?? true` untuk dua toggle terakhir: kolomnya baru, jadi baris lama yang
    // belum terisi harus tetap mendapat perilaku lengkap (total + cara bayar),
    // bukan diam-diam kehilangan blok yang tidak pernah dimatikan pemiliknya.
    activeCouriers: store.active_couriers,
    localCourier: store.local_courier,
    paymentAccounts: store.payment_accounts,
    codEnabled: store.cod_enabled === true,
    paymentNote: store.payment_note,
    aiTone: store.ai_tone,
    includeTotal: store.ai_include_total ?? true,
    includePayment: store.ai_include_payment ?? true,
    // Nama & alamat dari KOLOM percakapan, bukan dari memori model: paket Starter
    // tidak mengirim riwayat ke model sama sekali, jadi tanpa ini fitur rekam
    // identitas diam-diam hanya jalan di Pro.
    knownCustomerName: conversation?.customer_name,
    knownCustomerAddress: conversation?.customer_address,
    // Tujuan yang sudah pernah dihitung di percakapan ini — dipakai supaya
    // "oke pesan 2 kaos" tetap dibalas lengkap dengan ongkir tanpa memaksa
    // pembeli menyebut kotanya lagi.
    knownDestinationCity: conversation?.destination_city,
    lastAssistantMessage: lastAssistantText(history)
  });

  let delivered = false;
  let deliveryError: string | undefined;

  if (send) {
    // JANGAN jatuh ke FONNTE_TOKEN (account token) di sini: di deployment
    // multi-tenant token itu bisa mengirim lewat device toko lain, jadi balasan
    // pembeli berpotensi keluar dari nomor yang bukan miliknya.
    const token = deviceToken || null;
    if (token) {
      const sent = await sendFonnteMessage({
        target: sender,
        message: aiResult.replyText,
        token,
        // Foto produk yang dikutip balasan. Dikirim bersama pesan (bukan pesan
        // terpisah) supaya pembeli tidak menerima dua notifikasi untuk satu jawaban.
        urls: aiResult.mediaUrls
      });
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

  let orderRecorded = false;

  if (storeId) {
    await saveConversationMessage({
      storeId,
      phone: sender,
      userMsg: messageText,
      assistantReply: aiResult.replyText,
      intent: aiResult.intent,
      destinationCity: aiResult.detectedCity,
      customerName: aiResult.capturedName,
      customerAddress: aiResult.capturedAddress
    });

    orderRecorded = await recordOrderFromReply({
      store,
      storeId,
      deviceId: device?.id || null,
      sender,
      conversationName: conversation?.customer_name,
      conversationAddress: conversation?.customer_address,
      conversationCity: conversation?.destination_city,
      result: aiResult
    });
  }

  // Pembeli tadi menanyakan ongkir dan tidak mendapat angka. Kabari pemiliknya.
  //
  // Hanya pada jalur yang benar-benar mengirim (`send`): endpoint uji coba dari
  // dashboard dipakai justru oleh pemilik toko yang sedang membaca layarnya, jadi
  // mengiriminya WhatsApp untuk hal yang sedang ia lihat sendiri cuma kebisingan.
  //
  // `await`-nya aman: `notifyOriginMissing` tidak pernah melempar, dan balasan ke
  // pembeli sudah terkirim beberapa baris di atas — jadi tidak ada yang menunggu.
  if (aiResult.originMissing && send) {
    await notifyOriginMissing({ store });
  }

  return {
    replyText: aiResult.replyText,
    intent: aiResult.intent,
    detectedCity: aiResult.detectedCity,
    delivered,
    deliveryError,
    capturedName: aiResult.capturedName,
    capturedAddress: aiResult.capturedAddress,
    orderRecorded,
    stockBlocked: aiResult.stockBlocked === true,
    originMissing: aiResult.originMissing === true
  };
}

/**
 * Catat pesanan pembeli ke daftar pesanan toko — bila memang sudah layak dicatat.
 *
 * Aturan yang dipakai (sengaja ketat, sebab daftar pesanan yang penuh oleh orang
 * yang cuma bertanya harga jadi tidak berguna):
 *
 * - BARIS BARU hanya dibuat kalau ada produk yang jelas DAN ada tanda pembeli
 *   sungguh melanjutkan: kata memesan, tujuan pengiriman, atau alamat yang baru
 *   diberikan.
 * - Kalau pesanan pembeli ini sudah ada dan masih berjalan, pesan apa pun
 *   berikutnya boleh MEMPERBARUI-nya (nama, alamat, kota, tambahan barang) —
 *   termasuk pesan yang tidak memuat kata memesan sama sekali, karena "Jl.
 *   Merdeka 10" adalah jawaban atas pertanyaan bot, bukan pesanan baru.
 *
 * Gagal mencatat TIDAK boleh menggagalkan balasan: pembeli sudah menerima pesan
 * WhatsApp-nya, dan menggagalkan request setelah itu hanya membuat webhook Fonnte
 * mengirim ulang pesan yang sama.
 */
async function recordOrderFromReply(params: {
  store: StoreRecord;
  storeId: string;
  deviceId: string | null;
  sender: string;
  conversationName?: string | null;
  conversationAddress?: string | null;
  conversationCity?: string | null;
  result: AIProcessResult;
}): Promise<boolean> {
  const {
    store,
    storeId,
    deviceId,
    sender,
    conversationName,
    conversationAddress,
    conversationCity,
    result
  } = params;

  // Ada barang HABIS di pesanan ini → tidak dicatat sama sekali.
  //
  // Balasan ke pembeli sudah mengatakan pesanannya belum dicatat (lihat jalur
  // stok di `lib/ai.ts`), jadi mencatatnya di sini akan membuat daftar pesanan
  // toko berisi barang yang mustahil dikirim — dan bertentangan dengan apa yang
  // baru saja dijanjikan ke pembeli.
  if (result.stockBlocked === true) return false;

  const draft = result.orderDraft;
  const lines = draft?.lines?.filter((l) => l.units > 0) || [];
  const city = result.detectedCity || conversationCity || null;

  const worthCreating =
    lines.length > 0 && (result.orderCommit === true || !!result.detectedCity || !!result.capturedAddress);

  if (!worthCreating) {
    // Belum layak jadi baris baru — tapi kalau pesanannya sudah berjalan, data
    // baru dari pesan ini tetap harus menempel ke sana.
    const hasUpdate = !!(result.capturedName || result.capturedAddress || city || lines.length > 0);
    if (!hasUpdate) return false;
    const open = await getOpenBuyerOrder(storeId, sender);
    if (!open) return false;
  }

  const items: BuyerOrderItem[] = lines.map((l) => ({
    name: l.name,
    units: l.units,
    price: l.price,
    weight: l.weight,
    line_total: l.lineTotal
  }));

  const res = await recordBuyerOrder({
    store_id: storeId,
    device_id: deviceId,
    customer_phone: sender,
    // Nama & alamat gabungan: yang baru terbaca lebih diutamakan, tapi data lama
    // tetap dikirim supaya baris BARU tidak lahir tanpa identitas yang sudah
    // diketahui dari chat sebelumnya.
    customer_name: result.capturedName || conversationName || null,
    customer_address: result.capturedAddress || conversationAddress || null,
    destination_city: city,
    items,
    subtotal: draft?.subtotal || 0,
    weight_gram: draft?.weightGram || 0
  });

  if (!res.ok && !res.skipped) {
    console.warn("[auto-reply] pesanan gagal dicatat:", res.error);
  }

  // ── Stok dipotong TEPAT SEKALI per pesanan ──────────────────────────────
  //
  // Syaratnya `created === true`, bukan `ok`: baris pesanan yang sama diperbarui
  // tiap pesan lanjutan pembeli ("Budi", "Jl. Merdeka 10", "kirim besok"), jadi
  // memotong stok setiap kali `ok` akan mengosongkan gudang hanya karena pembeli
  // banyak bicara. Duplikat 409 juga bukan pembuatan baris — pemenang race-nya
  // yang sudah memotong.
  if (res.created === true && lines.length > 0) {
    const dec = await decrementProductStock(
      storeId,
      lines.map((l) => ({ id: l.id ?? null, name: l.name, units: l.units }))
    );
    if (!dec.ok && !dec.skipped) {
      console.warn("[auto-reply] stok gagal dipotong:", dec.error);
    }

    // Kabar ke pemilik toko hanya untuk pesanan BARU, dengan alasan yang sama:
    // memberi kabar tiap pembaruan berarti satu pesanan mengirim lima notifikasi.
    await notifyNewOrder({
      store,
      customerPhone: sender,
      customerName: result.capturedName || conversationName || null,
      items: lines.map((l) => ({ name: l.name, units: l.units })),
      subtotal: draft?.subtotal || 0,
      city
    });
  }

  return res.ok === true;
}
