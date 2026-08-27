/**
 * Perhitungan metrik dashboard — fungsi murni, dihitung dari data yang SUDAH
 * di-fetch (`conversations` + `products`). Tidak perlu endpoint statistik baru.
 *
 * Semua metrik di sini harus bisa dipertanggungjawabkan dari data mentah:
 * jangan menambah angka "estimasi" yang tidak benar-benar terukur.
 */

import { monthStartMs } from "@/lib/packages";
import { needsAttention, type BuyerOrder, type Conversation, type Product } from "./types";

export interface DayBucket {
  /** Kunci tanggal lokal YYYY-MM-DD. */
  key: string;
  /** Label sumbu-x pendek, mis. "Sab". */
  label: string;
  /** Tanggal lengkap untuk tooltip, mis. "Sabtu, 16 Agu". */
  fullLabel: string;
  count: number;
}

export interface IntentBucket {
  intent: string;
  count: number;
}

export interface DashboardStats {
  /** Jumlah percakapan (= jumlah pembeli unik yang pernah chat). */
  totalConversations: number;
  /** Total pesan masuk dari pembeli. */
  incomingMessages: number;
  /** Total balasan yang dikirim AI. */
  aiReplies: number;
  /** Pesan pembeli dalam 24 jam terakhir. */
  incoming24h: number;
  /** Percakapan yang aktif (ada pesan) dalam 7 hari terakhir. */
  activeConversations7d: number;
  /**
   * Percakapan aktif pada bulan kalender berjalan (WIB) — angka yang sama
   * dengan yang dipakai server menegakkan kuota paket, supaya meter pemakaian
   * di dashboard tidak pernah berbeda dari yang benar-benar memblokir bot.
   */
  conversationsThisMonth: number;
  /** Histogram 7 hari (termasuk hari ini) untuk pesan pembeli. */
  daily: DayBucket[];
  /** Nilai tertinggi pada histogram — dipakai untuk skala bar. */
  dailyMax: number;
  /** Sebaran topik berdasarkan `last_intent`, urut dari terbanyak. */
  intents: IntentBucket[];
  /** Kota tujuan ongkir terpopuler. */
  topDestinations: Array<{ city: string; count: number }>;
  productCount: number;
  /** Produk tanpa berat wajar → ongkir bisa salah hitung. */
  productsMissingWeight: number;
  /** Produk yang stoknya nol (toko yang memakai pencatatan stok). */
  productsOutOfStock: number;

  // ── Metrik bisnis ──────────────────────────────────────────────────────
  //
  // Sampai sini seluruh dashboard hanya mengukur AKTIVITAS BOT (jumlah pesan,
  // balasan, topik). Pemilik toko tidak pernah bisa menjawab pertanyaan yang
  // paling penting: apakah semua chat ini menghasilkan uang? Angka di bawah ini
  // yang menjawabnya, dan semuanya dihitung dari baris pesanan yang nyata.

  /** Jumlah pesanan yang tercatat. */
  orderCount: number;
  /** Pesanan yang belum selesai (status apa pun selain `done`). */
  ordersOpen: number;
  /** Pesanan yang menunggu pembayaran. */
  ordersAwaitingPayment: number;
  /** Sudah dibayar tapi belum dikirim — pekerjaan paling mendesak. */
  ordersAwaitingShipment: number;
  ordersDone: number;
  /**
   * Nilai pesanan yang SUDAH DIBAYAR (paid/shipped/done), termasuk ongkir bila
   * tercatat. Pesanan `new` tidak dihitung: itu belum uang, itu harapan.
   */
  revenuePaid: number;
  /** Nilai pesanan yang belum dibayar — potensi yang masih bisa dikejar. */
  revenuePending: number;
  /** Pesanan bulan kalender berjalan. */
  ordersThisMonth: number;
  /** Nilai pesanan terbayar bulan ini. */
  revenueThisMonth: number;
  /** Rata-rata nilai satu pesanan terbayar. */
  averageOrderValue: number;
  /**
   * Corong chat → pesanan → selesai, dalam persen (0–100).
   *
   * `chatToOrder` sengaja memakai jumlah PERCAKAPAN sebagai penyebut, bukan jumlah
   * pesan: yang diukur adalah berapa banyak pembeli yang akhirnya memesan.
   */
  chatToOrderPct: number;
  orderToDonePct: number;
  /** Percakapan yang pesan terakhirnya tidak bisa dijawab bot. */
  unansweredCount: number;
  /** Percakapan yang sedang menunggu balasan manusia. */
  needsAttentionCount: number;
}

const DAY_MS = 86_400_000;

/** Kunci tanggal LOKAL (bukan UTC) supaya "hari ini" sesuai zona waktu user. */
function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Nilai satu pesanan: subtotal barang + ongkir bila sudah tercatat.
 *
 * Ongkir ikut dihitung karena itu memang uang yang masuk ke rekening toko. Yang
 * belum tercatat tidak ditebak — dashboard tidak boleh menampilkan angka yang
 * tidak bisa ditelusuri ke barisnya.
 */
function orderValue(o: BuyerOrder): number {
  const sub = Number(o.subtotal) || 0;
  const ship = Number(o.shipping_cost) || 0;
  return sub + ship;
}

/** `true` bila pesanan ini sudah dibayar (uang sudah diterima). */
function isPaidStage(status?: string | null): boolean {
  return status === "paid" || status === "shipped" || status === "done";
}

export function computeStats(
  conversations: Conversation[],
  products: Product[],
  /**
   * Pesanan pembeli. Opsional dengan sengaja: dashboard memuat pesanan di
   * request terpisah yang bisa gagal (atau tabelnya belum dimigrasi), dan seluruh
   * panel statistik tidak boleh ikut kosong hanya karena bagian itu gagal.
   */
  buyerOrders: BuyerOrder[] = []
): DashboardStats {
  const now = Date.now();
  const cutoff24h = now - DAY_MS;
  const cutoff7d = now - 7 * DAY_MS;
  // Sama persis dengan ambang yang dipakai `countConversationsThisMonth`.
  const monthStart = monthStartMs(now);

  // Siapkan 7 keranjang harian (hari ini di paling kanan).
  const daily: DayBucket[] = [];
  const bucketIndex = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    const key = localDateKey(d);
    bucketIndex.set(key, daily.length);
    daily.push({
      key,
      label: d.toLocaleDateString("id-ID", { weekday: "short" }),
      fullLabel: d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" }),
      count: 0
    });
  }

  let incomingMessages = 0;
  let aiReplies = 0;
  let incoming24h = 0;
  let activeConversations7d = 0;
  let conversationsThisMonth = 0;
  let unansweredCount = 0;
  let needsAttentionCount = 0;

  const intentCounts = new Map<string, number>();
  const destinationCounts = new Map<string, number>();

  for (const convo of conversations) {
    const messages = Array.isArray(convo.messages) ? convo.messages : [];

    for (const msg of messages) {
      if (msg?.role === "assistant") {
        aiReplies++;
        continue;
      }
      if (msg?.role !== "user") continue;

      incomingMessages++;

      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : NaN;
      if (!Number.isFinite(ts)) continue;
      if (ts >= cutoff24h) incoming24h++;

      const idx = bucketIndex.get(localDateKey(new Date(ts)));
      if (idx !== undefined) daily[idx].count++;
    }

    // Aktif = ada aktivitas dalam 7 hari (pakai updated_at, fallback pesan terakhir).
    const lastTouchRaw =
      convo.updated_at || messages[messages.length - 1]?.timestamp || convo.created_at || null;
    const lastTouch = lastTouchRaw ? new Date(lastTouchRaw).getTime() : NaN;
    if (Number.isFinite(lastTouch) && lastTouch >= cutoff7d) activeConversations7d++;
    if (Number.isFinite(lastTouch) && lastTouch >= monthStart) conversationsThisMonth++;

    if (convo.last_intent) {
      intentCounts.set(convo.last_intent, (intentCounts.get(convo.last_intent) || 0) + 1);
      if (convo.last_intent === "FALLBACK") unansweredCount++;
    }
    if (needsAttention(convo)) needsAttentionCount++;
    if (convo.destination_city) {
      const city = convo.destination_city.trim();
      if (city) destinationCounts.set(city, (destinationCounts.get(city) || 0) + 1);
    }
  }

  const intents = Array.from(intentCounts, ([intent, count]) => ({ intent, count })).sort(
    (a, b) => b.count - a.count
  );

  const topDestinations = Array.from(destinationCounts, ([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ── Pesanan ─────────────────────────────────────────────────────────────
  let ordersAwaitingPayment = 0;
  let ordersAwaitingShipment = 0;
  let ordersDone = 0;
  let revenuePaid = 0;
  let revenuePending = 0;
  let ordersThisMonth = 0;
  let revenueThisMonth = 0;
  let paidOrderCount = 0;

  for (const order of buyerOrders) {
    const status = order.status || "new";
    const value = orderValue(order);
    const paid = isPaidStage(status);

    if (status === "new") ordersAwaitingPayment++;
    else if (status === "paid") ordersAwaitingShipment++;
    else if (status === "done") ordersDone++;

    if (paid) {
      revenuePaid += value;
      paidOrderCount++;
    } else {
      revenuePending += value;
    }

    const createdAt = order.created_at ? new Date(order.created_at).getTime() : NaN;
    if (Number.isFinite(createdAt) && createdAt >= monthStart) {
      ordersThisMonth++;
      if (paid) revenueThisMonth += value;
    }
  }

  const orderCount = buyerOrders.length;
  const pct = (part: number, whole: number): number =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;

  return {
    totalConversations: conversations.length,
    incomingMessages,
    aiReplies,
    incoming24h,
    activeConversations7d,
    conversationsThisMonth,
    daily,
    dailyMax: daily.reduce((max, d) => Math.max(max, d.count), 0),
    intents,
    topDestinations,
    productCount: products.length,
    productsMissingWeight: products.filter((p) => !Number(p.weight) || Number(p.weight) <= 0).length,
    // `stock` kosong/undefined = toko tidak memakai pencatatan stok = selalu ada.
    // Hanya angka NOL yang benar-benar berarti habis.
    productsOutOfStock: products.filter((p) => Number(p.stock) === 0).length,
    orderCount,
    ordersOpen: orderCount - ordersDone,
    ordersAwaitingPayment,
    ordersAwaitingShipment,
    ordersDone,
    revenuePaid,
    revenuePending,
    ordersThisMonth,
    revenueThisMonth,
    averageOrderValue: paidOrderCount > 0 ? Math.round(revenuePaid / paidOrderCount) : 0,
    chatToOrderPct: pct(orderCount, conversations.length),
    orderToDonePct: pct(ordersDone, orderCount),
    unansweredCount,
    needsAttentionCount
  };
}
