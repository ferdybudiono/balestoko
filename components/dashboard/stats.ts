/**
 * Perhitungan metrik dashboard — fungsi murni, dihitung dari data yang SUDAH
 * di-fetch (`conversations` + `products`). Tidak perlu endpoint statistik baru.
 *
 * Semua metrik di sini harus bisa dipertanggungjawabkan dari data mentah:
 * jangan menambah angka "estimasi" yang tidak benar-benar terukur.
 */

import { monthStartMs } from "@/lib/packages";
import type { Conversation, Product } from "./types";

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
}

const DAY_MS = 86_400_000;

/** Kunci tanggal LOKAL (bukan UTC) supaya "hari ini" sesuai zona waktu user. */
function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function computeStats(conversations: Conversation[], products: Product[]): DashboardStats {
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
    }
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
    productsMissingWeight: products.filter((p) => !Number(p.weight) || Number(p.weight) <= 0).length
  };
}
