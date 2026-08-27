/**
 * AI Assistant Engine for WhatsApp Customer Service
 * Integrates Gemini API / OpenAI API with fallback Intelligent Rule-Based Engine
 * Handles Buyer Greeting -> Location Extraction -> Mengantar Ongkir Calculation -> Conversational Chat
 */

import { calculateMengantarOngkir, searchMengantarLocation, RateSource, ShippingOption } from "./mengantar";
import { LocalCourierConfig, courierLabel, normalizeActiveCouriers } from "./couriers";
import {
  AI_TONE_INSTRUCTIONS,
  AiTone,
  OrderDraft,
  OrderDraftLine,
  PaymentAccount,
  PaymentSettings,
  QuoteOption,
  buildOngkirReply,
  buildOrderConfirmReply,
  countDraftUnits,
  formatOrderSummary,
  formatStockNotice,
  formatWeight,
  mergeQuoteOptions,
  normalizeAiTone,
  normalizePaymentAccounts
} from "./reply-format";
import {
  buildIdentityAsk,
  buildSlotAck,
  detectSlotAsk,
  extractCustomerAddress,
  extractCustomerName,
  extractShippingCityQuery,
  isOrderCommit
} from "./customer-slots";

export type { OrderDraft, OrderDraftLine } from "./reply-format";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface AIProcessParams {
  messageText: string;
  storeName: string;
  aiPromptSystem?: string;
  greetingMessage?: string;
  originSubdistrictId?: string;
  originCityName?: string;
  mengantarApiKey?: string;
  /** Berat default (gram) dari pengaturan toko; dipakai bila berat produk tidak diketahui. */
  defaultWeight?: number;
  products?: Array<{
    id?: string | null;
    name: string;
    price: number;
    weight: number;
    description?: string;
    stock?: number | null;
    image_url?: string | null;
  }>;
  chatHistory?: ChatMessage[];
  /**
   * Berapa pesan terakhir dari `chatHistory` yang boleh ikut ke prompt AI.
   * `0` (default) = AI tanpa memori: tiap pesan dinilai berdiri sendiri.
   *
   * Nilainya berasal dari paket toko (`aiContextMessagesForPackage`). Riwayat
   * tetap dikirim ke fungsi ini apa pun paketnya karena dipakai mendeteksi
   * sapaan pertama — yang dibatasi hanya apa yang dilihat model.
   */
  aiContextMessages?: number;
  /** Ekspedisi yang dilayani toko. Kosong/undefined = semua ekspedisi. */
  activeCouriers?: string[] | null;
  /** Opsi kurir toko sendiri (bukan dari Mengantar). */
  localCourier?: LocalCourierConfig | null;
  /** Rekening/e-wallet tujuan transfer (maks 3). */
  paymentAccounts?: PaymentAccount[] | null;
  /** COD tersedia atau tidak. */
  codEnabled?: boolean;
  /** Catatan pembayaran bebas dari pemilik toko. */
  paymentNote?: string | null;
  /** Nada bicara balasan AI. */
  aiTone?: string | null;
  /** Sertakan penjumlahan produk + ongkir pada balasan ongkir. */
  includeTotal?: boolean;
  /** Sertakan blok instruksi pembayaran pada balasan ongkir. */
  includePayment?: boolean;
  /**
   * Nama & alamat pembeli yang SUDAH terekam dari chat sebelumnya.
   *
   * Dikirim terpisah dari `chatHistory` dengan sengaja: paket Starter punya
   * `aiContextMessages: 0` (model tidak melihat riwayat sama sekali), jadi kalau
   * slot ini hanya bergantung pada memori model, fiturnya diam-diam cuma jalan di
   * Pro. Nilai ini datang dari kolom database, jadi berlaku di semua paket.
   */
  knownCustomerName?: string | null;
  knownCustomerAddress?: string | null;
  /**
   * Kota/kecamatan tujuan yang sudah pernah dihitung di percakapan ini.
   *
   * Dipakai sebagai cadangan terakhir saat pembeli menyatakan memesan tanpa
   * menyebut tujuan lagi dan alamat lengkapnya belum ada. Karena asalnya dari
   * pencarian lokasi kurir yang berhasil sebelumnya, tujuan ini sudah terbukti
   * ada — bukan tebakan baru.
   */
  knownDestinationCity?: string | null;
  /**
   * Matikan penulisan ulang oleh AI untuk pemanggilan INI saja.
   *
   * Dipakai pratinjau dashboard: pemilik toko bisa melihat isi balasan yang
   * dihitung sistem tanpa memanggil model sama sekali (instan & tanpa biaya),
   * lalu meminta versi finalnya secara terpisah saat ingin menilai gaya bicara.
   */
  disableAiNarration?: boolean;
  /**
   * Balasan bot terakhir — dipakai memetakan jawaban singkat pembeli ("Budi",
   * "Jl. Merdeka 10 …") ke slot yang memang sedang ditanyakan.
   */
  lastAssistantMessage?: string | null;
}

export interface AIProcessResult {
  replyText: string;
  /**
   * `FALLBACK` = pesan pembeli TIDAK terjawab oleh salah satu jalur di atas dan
   * dijawab dengan kalimat umum "akan diteruskan ke penjual".
   *
   * Sengaja jadi intent tersendiri, bukan digabung ke `GENERAL_CHAT`: inilah satu-
   * satunya cara pemilik toko bisa melihat daftar pertanyaan yang bot-nya tidak
   * bisa jawab. Tanpa ini, kegagalan bot terlihat identik dengan obrolan santai.
   */
  intent: "GREETING" | "ONGKIR_CHECK" | "PRODUCT_INQUIRY" | "GENERAL_CHAT" | "ORDER" | "FALLBACK";
  shippingDetails?: ShippingOption[];
  detectedCity?: string;
  /** `mock` = tarif simulasi (lokasi asal toko belum valid), bukan tarif kurir asli. */
  rateSource?: RateSource;
  /** Berat (gram) yang dipakai menghitung ongkir — berguna untuk audit tarif. */
  shippingWeightGram?: number;
  /** Nama/alamat yang BARU terbaca dari pesan ini (`null` = tidak ada). */
  capturedName?: string | null;
  capturedAddress?: string | null;
  /** Produk & jumlah yang disebut pembeli — dipakai mencatat pesanan. */
  orderDraft?: OrderDraft;
  /** `true` bila pesan ini memang niat memesan, bukan sekadar bertanya. */
  orderCommit?: boolean;
  /**
   * Ada produk HABIS di antara yang disebut pembeli.
   *
   * Pemanggil memakai ini untuk TIDAK mencatat pesanan: mencatat pesanan barang
   * kosong berarti daftar pesanan toko berisi barang yang tidak mungkin dikirim.
   */
  stockBlocked?: boolean;
  /** URL foto produk yang dikutip — dikirim sebagai media bersama balasan. */
  mediaUrls?: string[];
  /** `true` bila kalimat akhir ditulis AI; `false` = format bawaan sistem. */
  aiNarrated?: boolean;
  /** Kenapa tulisan AI tidak dipakai (lihat `AITrace.reason`). */
  aiFallbackReason?: AITrace["reason"];
  /** Angka asing yang membuat tulisan AI ditolak. */
  aiRejectedNumber?: string;
}

type ProductLike = {
  id?: string | null;
  name: string;
  price: number;
  weight: number;
  description?: string;
  /**
   * Stok tersisa. `undefined`/`null` = toko tidak memakai pencatatan stok, yang
   * berarti SELALU tersedia. Membedakan ini dari `0` itu wajib: memperlakukan
   * kolom kosong sebagai habis akan membuat seluruh katalog toko lama mendadak
   * dijawab "stok habis".
   */
  stock?: number | null;
  image_url?: string | null;
};

/** Stok yang dianggap "tinggal sedikit" — di bawah ini pembeli diberi tahu. */
const LOW_STOCK_THRESHOLD = 5;

/**
 * Stok efektif sebuah produk, atau `null` bila toko tidak memakai stok.
 *
 * Satu-satunya tempat aturan "kolom kosong = tak terbatas" ditegakkan, supaya
 * prompt AI, pencocokan pesanan, dan balasan stok tidak bisa berbeda pendapat.
 */
function stockOf(p: ProductLike | undefined | null): number | null {
  if (!p) return null;
  const raw = p.stock;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/** Di atas ini hampir pasti salah parse, dan kurir memang beda skema tarif. */
const MAX_SHIPPING_WEIGHT_GRAM = 50_000;
/**
 * Batas jumlah unit yang diakui dari satu penyebutan produk.
 *
 * Dinaikkan dari 20 saat satuan borongan didukung: "10 lusin" = 120 potong itu
 * pesanan grosir yang wajar, dan memotongnya ke 20 berarti mengutip subtotal &
 * ongkir yang jauh lebih murah dari yang seharusnya. Batasnya tetap ada supaya
 * satu salah baca tidak melahirkan pesanan ribuan potong.
 */
const MAX_UNITS_PER_PRODUCT = 200;

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Pembacaan jumlah barang ──────────────────────────────────────────────
//
// Pembeli Indonesia menulis jumlah dengan banyak cara: "2 kaos", "kaos x3",
// "kaos 3 pcs", "dua kaos", "selusin kaos", "2 lusin kaos". Sebelumnya hanya
// bentuk berangka yang terbaca, jadi "dua kaos" tercatat 1 potong — pesanan
// yang salah jumlah sejak awal, dan ongkirnya ikut salah.

/** Kata satuan barang (bukan satuan ukuran). */
const UNIT_NOUN = "pcs|pes|pc|buah|biji|unit|potong|helai|lembar|bungkus|botol|kaleng|pack|pak|set|pasang|batang|roll";

/** Satuan borongan: pengalinya jelas dan dipakai sehari-hari di grosir. */
const BULK_UNIT = "lusin|kodi";
const BULK_MULTIPLIER: Record<string, number> = { lusin: 12, kodi: 20 };

/**
 * Satuan UKURAN — angka di depannya bukan jumlah barang.
 *
 * Ini gerbang yang menjaga "kaos 2 kg", "sirup 500 ml", dan "budget 200 rb"
 * tidak terbaca sebagai jumlah unit. Diurut dari yang terpanjang supaya
 * "kilogram" tidak tertelan oleh alternatif "kilo".
 */
const MEASURE_UNIT =
  "kilogram|kilo|gram|meter|liter|persen|juta|ribu|inch|ons|ltr|rb|jt|kg|gr|cm|mm|ml|g|k|m|l";

/** Angka yang ditulis sebagai kata. */
const WORD_NUMBERS: Record<string, number> = {
  satu: 1,
  sebuah: 1,
  sepotong: 1,
  sebiji: 1,
  sepasang: 2,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  selusin: 12,
  sekodi: 20
};

/** "dua belas" → 12, "tiga puluh" → 30. */
function compoundWordNumber(text: string): number | null {
  const m = /\b(dua|tiga|empat|lima|enam|tujuh|delapan|sembilan)\s+(belas|puluh)\s*$/.exec(text);
  if (!m) return null;
  const base = WORD_NUMBERS[m[1]];
  return m[2] === "belas" ? 10 + base : base * 10;
}

/** Jumlah dari teks SEBELUM nama produk: "2 kaos", "3 pcs kaos", "dua lusin kaos". */
function unitsFromBefore(before: string): number | null {
  // Borongan didahulukan: "2 lusin " harus terbaca 24, bukan 2.
  const bulkDigit = new RegExp(`(?:^|\\D)(\\d{1,2})\\s*(${BULK_UNIT})\\s*$`).exec(before);
  if (bulkDigit) return Number(bulkDigit[1]) * BULK_MULTIPLIER[bulkDigit[2]];

  const bulkWord = new RegExp(`\\b([a-z]+)\\s+(${BULK_UNIT})\\s*$`).exec(before);
  if (bulkWord && WORD_NUMBERS[bulkWord[1]] !== undefined) {
    return WORD_NUMBERS[bulkWord[1]] * BULK_MULTIPLIER[bulkWord[2]];
  }

  // `(?:^|\D)` menjaga agar "kaos 250 gram" tidak dibaca 25 unit.
  const digit = new RegExp(`(?:^|\\D)(\\d{1,2})\\s*(?:${UNIT_NOUN}|x)?\\s*$`).exec(before);
  if (digit) return Number(digit[1]);

  const compound = compoundWordNumber(before);
  if (compound !== null) return compound;

  const word = new RegExp(`\\b([a-z]+)\\s*(?:${UNIT_NOUN})?\\s*$`).exec(before);
  if (word && WORD_NUMBERS[word[1]] !== undefined) return WORD_NUMBERS[word[1]];

  return null;
}

/** Jumlah dari teks SESUDAH nama produk: "kaos 2", "kaos x3", "kaos 2 lusin". */
function unitsFromAfter(after: string): number | null {
  const bulkDigit = new RegExp(`^\\s*(?:x|sebanyak)?\\s*(\\d{1,2})\\s*(${BULK_UNIT})\\b`).exec(after);
  if (bulkDigit) return Number(bulkDigit[1]) * BULK_MULTIPLIER[bulkDigit[2]];

  const bulkWord = new RegExp(`^\\s*(?:sebanyak\\s*)?([a-z]+)\\s+(${BULK_UNIT})\\b`).exec(after);
  if (bulkWord && WORD_NUMBERS[bulkWord[1]] !== undefined) {
    return WORD_NUMBERS[bulkWord[1]] * BULK_MULTIPLIER[bulkWord[2]];
  }

  const digit = /^\s*(?:x|sebanyak)?\s*(\d{1,2})(?!\d)([\s\S]*)$/.exec(after);
  if (digit) {
    // Angka yang diikuti satuan ukuran bukan jumlah barang.
    if (new RegExp(`^\\s*(?:${MEASURE_UNIT})\\b`).test(digit[2])) return null;
    return Number(digit[1]);
  }

  const word = new RegExp(`^\\s*(?:sebanyak\\s*)?([a-z]+)\\s*(?:${UNIT_NOUN})?\\b`).exec(after);
  if (word && WORD_NUMBERS[word[1]] !== undefined) return WORD_NUMBERS[word[1]];

  return null;
}

/**
 * Jumlah unit yang disebut di sekitar nama produk.
 *
 * Tidak yakin → 1, karena menebak terlalu banyak berarti mengutip subtotal dan
 * ongkir lebih mahal dari seharusnya. Jendela 24 karakter (dulu 14) supaya frasa
 * seperti "sebanyak dua lusin " masih terbaca utuh.
 */
function unitsMentioned(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return 1;
  const before = haystack.slice(Math.max(0, idx - 24), idx);
  const after = haystack.slice(idx + needle.length, idx + needle.length + 24);

  const raw = unitsFromBefore(before) ?? unitsFromAfter(after);
  if (raw === null || !Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(Math.round(raw), MAX_UNITS_PER_PRODUCT);
}

/**
 * Kata yang terlalu umum untuk dipakai sebagai penanda produk. Tanpa daftar ini,
 * produk bernama "Paket Hemat" akan ikut terpesan setiap kali pembeli menulis
 * "paket saya kapan sampai".
 */
const MATCH_STOPWORDS = new Set([
  "ongkir", "kirim", "kirimkan", "harga", "berapa", "total", "bayar", "cod",
  "transfer", "pesan", "order", "beli", "mau", "dong", "kak", "min", "tolong",
  "gram", "kilo", "kota", "kecamatan", "alamat", "stok", "ready", "warna",
  "ukuran", "size", "buah", "pcs", "unit", "biji", "dan", "plus", "paket"
]);

/** Token nama produk yang cukup berarti untuk dicocokkan. */
function productTokens(name: string): string[] {
  return normalizeForMatch(name)
    .split(" ")
    .filter((t) => t.length >= 3 && !MATCH_STOPWORDS.has(t));
}

/**
 * Baca pesan pembeli menjadi draf pesanan: produk apa, berapa unit, berapa
 * subtotalnya, dan berapa berat paketnya.
 *
 * Dulu fungsi ini (`resolveShippingWeight`) hanya menghitung berat, dan hanya
 * cocok bila nama produk muncul UTUH di pesan. Pembeli sungguhan menulis
 * "2 polos lengan panjang" untuk "Kaos Polos Lengan Panjang", jadi pencocokannya
 * dibuat berlapis — tapi setiap lapis hanya diterima kalau hasilnya TIDAK
 * ambigu:
 *
 * 1. Nama lengkap muncul sebagai substring.
 * 2. SEMUA token nama produk muncul di pesan, urutan bebas.
 * 3. Satu token ≥4 karakter yang dimiliki TEPAT SATU produk.
 * 4. Token yang dimiliki lebih dari satu produk → masuk `ambiguous`, tidak
 *    dipilih. Toko dengan "Kaos Polos" dan "Kaos Raglan" tidak boleh ditebak
 *    dari kata "kaos"; salah tebak berarti mengutip harga dan berat produk yang
 *    bukan dimaksud pembeli.
 */
export function resolveOrderDraft(
  message: string,
  products: ProductLike[] = [],
  defaultWeight?: number
): OrderDraft {
  const fallback = defaultWeight && defaultWeight > 0 ? defaultWeight : 1000;
  const haystack = normalizeForMatch(message);
  const blank: OrderDraft = {
    lines: [],
    subtotal: 0,
    totalUnits: 0,
    weightGram: fallback,
    weightSource: "default",
    ambiguous: []
  };
  if (!haystack || products.length === 0) return blank;

  // index produk → kata di pesan yang dipakai menghitung jumlah unit.
  const hits = new Map<number, string>();
  const ambiguous = new Set<string>();

  // Lapis 1 & 2.
  products.forEach((p, idx) => {
    const full = normalizeForMatch(p?.name || "");
    // Nama sangat pendek ("XL", "A") terlalu mudah cocok dengan kata biasa.
    if (full.length < 3) return;

    if (haystack.includes(full)) {
      hits.set(idx, full);
      return;
    }

    const tokens = productTokens(p?.name || "");
    if (tokens.length === 0) return;
    if (tokens.every((t) => haystack.includes(t))) {
      // Jangkar unit = token yang muncul paling awal di pesan, supaya
      // "2 polos lengan panjang" terbaca 2 unit, bukan 1.
      const anchor = tokens.reduce(
        (best, t) => (haystack.indexOf(t) < haystack.indexOf(best) ? t : best),
        tokens[0]
      );
      hits.set(idx, anchor);
    }
  });

  // Token yang sudah "terpakai" oleh produk yang cocok di lapis 1/2. Tanpa ini,
  // "2 kaos polos" di toko dengan "Kaos Polos" + "Kaos Raglan" akan ikut
  // memesan Kaos Raglan lewat token "kaos" yang tersisa.
  const consumed = new Set<string>();
  for (const idx of hits.keys()) {
    for (const t of productTokens(products[idx]?.name || "")) consumed.add(t);
  }

  // Siapa saja pemilik tiap token — dasar lapis 3 & 4.
  const owners = new Map<string, number[]>();
  products.forEach((p, idx) => {
    for (const t of productTokens(p?.name || "")) {
      if (t.length < 4) continue;
      const list = owners.get(t);
      if (list) {
        if (!list.includes(idx)) list.push(idx);
      } else {
        owners.set(t, [idx]);
      }
    }
  });

  // Lapis 3 & 4 SENGAJA tidak digerbangi "belum ada yang cocok": pembeli bisa
  // menyebut dua produk sekaligus — satu dengan nama lengkap, satu dengan
  // sepotong nama saja ("2 kaos polos + 1 topi").
  for (const [token, idxs] of owners) {
    if (consumed.has(token) || !haystack.includes(token)) continue;
    if (idxs.length === 1) {
      if (!hits.has(idxs[0])) hits.set(idxs[0], token);
    } else {
      for (const i of idxs) {
        if (!hits.has(i)) ambiguous.add(products[i]?.name || "");
      }
    }
  }

  const ambiguousList = [...ambiguous].filter(Boolean);
  if (hits.size === 0) return { ...blank, ambiguous: ambiguousList };

  const lines: OrderDraftLine[] = [];
  let subtotal = 0;
  let totalWeight = 0;
  let weightValid = true;
  const outOfStock: string[] = [];
  const insufficient: Array<{ name: string; requested: number; stock: number }> = [];

  // Urut menurut katalog supaya balasan ke pembeli selalu berurutan sama.
  for (const [idx, anchor] of [...hits.entries()].sort((a, b) => a[0] - b[0])) {
    const p = products[idx];
    const units = unitsMentioned(haystack, anchor);
    const rawWeight = Number(p?.weight);
    const rawPrice = Number(p?.price);
    const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0;
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;

    // Berat yang tidak valid TIDAK lagi membuang produknya. Sebelumnya satu data
    // berat kosong menghapus harga produk itu dari total juga — pembeli dikutip
    // lebih murah dari yang seharusnya. Sekarang harganya tetap dihitung dan
    // hanya berat paket yang jatuh ke asumsi toko.
    if (weight <= 0) weightValid = false;

    // Stok DICATAT, bukan dipakai membuang baris: pembeli tetap harus melihat
    // bahwa produk yang ia sebut sudah terbaca — yang berubah adalah balasannya
    // berterus terang dan pesanannya tidak dicatat sebagai transaksi.
    const stock = stockOf(p);
    let shortfall: number | undefined;
    if (stock === 0) {
      outOfStock.push(p.name);
    } else if (stock !== null && units > stock) {
      shortfall = units - stock;
      insufficient.push({ name: p.name, requested: units, stock });
    }

    const lineTotal = price * units;
    lines.push({
      name: p.name,
      id: p.id ?? null,
      units,
      weight,
      price,
      lineTotal,
      ...(stock === null ? {} : { stock }),
      ...(shortfall ? { shortfall } : {})
    });
    subtotal += lineTotal;
    totalWeight += weight * units;
  }

  const weightOk = weightValid && totalWeight > 0;
  return {
    lines,
    subtotal,
    // Σ units — dipakai balasan untuk menyebut "Total barang: n pcs".
    totalUnits: countDraftUnits(lines),
    weightGram: weightOk ? Math.min(totalWeight, MAX_SHIPPING_WEIGHT_GRAM) : fallback,
    weightSource: weightOk ? "matched" : "default",
    ambiguous: ambiguousList,
    outOfStock,
    insufficient
  };
}

/** Ada produk yang habis / kurang stok di draft ini? */
export function draftHasStockIssue(draft: OrderDraft | undefined | null): boolean {
  if (!draft) return false;
  return (draft.outOfStock?.length || 0) > 0 || (draft.insufficient?.length || 0) > 0;
}

/** Ada produk yang benar-benar HABIS (bukan cuma kurang)? Pesanan tidak boleh dicatat. */
export function draftHasSoldOut(draft: OrderDraft | undefined | null): boolean {
  return (draft?.outOfStock?.length || 0) > 0;
}

/**
 * Panggil Gemini Generative AI API jika GEMINI_API_KEY di-set.
 * Model bisa diatur lewat ENV GEMINI_MODEL (default: gemini-2.5-flash).
 * Catatan: gemini-1.5-flash & gemini-2.0-flash sudah di-shutdown Google.
 */
async function generateGeminiReply(prompt: string, apiKey: string): Promise<string | null> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
        cache: "no-store"
      }
    );

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
      console.warn("[ai] Gemini merespons tanpa teks:", JSON.stringify(data).slice(0, 500));
    } else {
      const errBody = await res.text();
      console.warn(
        `[ai] Gemini API error ${res.status} (model=${model}):`,
        errBody.slice(0, 500)
      );
    }
  } catch (err) {
    console.warn("[ai] Gemini API call failed:", err);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pagar angka untuk balasan yang disusun AI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Di bawah nilai ini sebuah angka bukan klaim uang: jumlah unit ("2 pcs"),
 * estimasi hari ("2-3 hari"), atau ukuran. Angka sekecil itu tidak perlu
 * dicocokkan ke data toko.
 */
const MONEY_SCALE_MIN = 1000;

/**
 * Angka berskala uang yang benar-benar tertulis di sebuah teks.
 *
 * Penulisan Indonesia dipakai apa adanya: titik = pemisah ribuan
 * ("180.000" → 180000), koma = desimal ("1,2" → 1.2).
 */
function extractMoneyClaims(text: string): Array<{ raw: string; value: number }> {
  const out: Array<{ raw: string; value: number }> = [];
  for (const m of text.matchAll(/\d[\d.,]*/g)) {
    const raw = m[0];
    const normalized = raw.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const value = Number(normalized);
    if (Number.isFinite(value) && value >= MONEY_SCALE_MIN) {
      out.push({ raw, value: Math.round(value) });
    }
  }
  return out;
}

/** Kumpulan angka yang SAH dikutip sebuah balasan. */
interface NumberGuard {
  /** Nilai rupiah & berat yang dihitung sistem. */
  amounts: Set<number>;
  /** Deretan digit yang bukan uang tapi sah dikutip (nomor rekening/HP). */
  digitStrings: Set<string>;
}

function emptyGuard(): NumberGuard {
  return { amounts: new Set<number>(), digitStrings: new Set<string>() };
}

/** Nomor rekening/e-wallet sah dikutip walau bentuknya deretan digit panjang. */
function allowPaymentDigits(guard: NumberGuard, payment: PaymentSettings): void {
  for (const a of payment.accounts) {
    const digits = a.number.replace(/\D/g, "");
    if (digits) guard.digitStrings.add(digits);
  }
}

/**
 * Izinkan angka yang berasal dari teks yang BUKAN karangan model: instruksi
 * pemilik toko, catatan pembayaran, pesan pembeli sendiri, dan riwayat chat.
 *
 * Tanpa ini pagar angka jadi terlalu galak dan justru merugikan: pemilik toko
 * yang menulis "minimal order Rp 50.000" di instruksinya akan melihat balasan
 * AI-nya dibuang terus-menerus, dan mengulang angka yang baru saja ditulis
 * pembeli ("budget 200rb") pun dianggap pelanggaran. Yang ingin dicegah pagar
 * ini adalah angka yang muncul dari ketiadaan — bukan angka yang memang sudah
 * ada di percakapan.
 */
function allowTextNumbers(guard: NumberGuard, text?: string | null): void {
  const src = (text || "").trim();
  if (!src) return;
  for (const claim of extractMoneyClaims(src)) {
    guard.amounts.add(claim.value);
    const digits = claim.raw.replace(/\D/g, "");
    if (digits) guard.digitStrings.add(digits);
  }
}

/**
 * Apakah balasan ini hanya memakai angka yang memang dihitung sistem?
 *
 * Ini pagar yang membuat AI boleh menyusun kalimat soal harga, ongkir, dan
 * total tanpa risiko mengarang angka. Model tidak "diminta jujur" lalu
 * dipercaya — hasilnya DIPERIKSA, dan balasan yang menyelipkan angka rupiah
 * yang tidak ada dasarnya dibuang, bukan dikirim ke pembeli.
 *
 * Sengaja ketat: satu angka asing → seluruh balasan ditolak dan versi
 * deterministik yang dipakai. Kehilangan gaya bahasa AI jauh lebih murah
 * daripada mengutip harga yang salah ke pembeli.
 */
function replyKeepsNumbersHonest(
  text: string,
  guard: NumberGuard
): { ok: true } | { ok: false; offender: string } {
  for (const claim of extractMoneyClaims(text)) {
    const digits = claim.raw.replace(/\D/g, "");
    if (guard.digitStrings.has(digits)) continue;
    if (guard.amounts.has(claim.value)) continue;
    return { ok: false, offender: claim.raw };
  }
  return { ok: true };
}

/**
 * Catatan singkat tentang bagaimana satu balasan dihasilkan.
 *
 * ADA UNTUK APA: pemilik toko perlu tahu apakah kalimat yang dilihatnya di
 * pratinjau benar-benar tulisan AI, atau format bawaan sistem karena tulisan AI
 * ditolak pemeriksaan angka. Tanpa penanda ini, pratinjau "balasan final" bisa
 * menyesatkan — pemilik toko mengira sudah melihat gaya bicara AI padahal yang
 * tampil adalah format cadangan.
 */
export interface AITrace {
  /** `true` bila teks akhir memang tulisan model, bukan format deterministik. */
  narrated: boolean;
  /**
   * Kenapa tulisan model tidak dipakai.
   * `no-key` GEMINI_API_KEY belum di-set · `no-reply` model tidak membalas ·
   * `bad-numbers` balasan model memuat angka tanpa dasar · `deterministic`
   * jalur ini memang tidak melibatkan model (mis. pesan sapaan toko).
   */
  reason?: "no-key" | "no-reply" | "bad-numbers" | "deterministic";
  /** Angka asing yang membuat tulisan model ditolak — untuk ditampilkan ke pemilik toko. */
  offender?: string;
}

/**
 * Minta Gemini menuliskan ulang sebuah balasan, lalu pakai hasilnya HANYA bila
 * angkanya lolos pemeriksaan. Gagal apa pun (API mati, balasan kosong, angka
 * asing) → balasan deterministik yang sudah disiapkan pemanggil.
 *
 * Urutannya penting: versi deterministik dihitung LEBIH DULU dan selalu ada,
 * jadi jalur AI tidak pernah menjadi titik tunggal kegagalan bot.
 */
async function narrateWithGemini(params: {
  apiKey: string;
  prompt: string;
  fallback: string;
  guard: NumberGuard;
  label: string;
  /** Diisi di tempat supaya pemanggil bisa tahu hasilnya dipakai atau dibuang. */
  trace?: AITrace;
}): Promise<string> {
  const { apiKey, prompt, fallback, guard, label, trace } = params;

  const draftText = await generateGeminiReply(prompt, apiKey);
  if (!draftText) {
    console.warn(`[ai] ${label}: Gemini tidak membalas — pakai format deterministik.`);
    if (trace) {
      trace.narrated = false;
      trace.reason = "no-reply";
    }
    return fallback;
  }

  const verdict = replyKeepsNumbersHonest(draftText, guard);
  if (!verdict.ok) {
    console.warn(
      `[ai] ${label}: balasan Gemini memuat angka tanpa dasar ("${verdict.offender}") — dibuang, pakai format deterministik.`
    );
    if (trace) {
      trace.narrated = false;
      trace.reason = "bad-numbers";
      trace.offender = verdict.offender;
    }
    return fallback;
  }

  if (trace) {
    trace.narrated = true;
    trace.reason = undefined;
    trace.offender = undefined;
  }
  return draftText;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Konteks toko untuk model
// ─────────────────────────────────────────────────────────────────────────────

interface StoreVoice {
  storeName: string;
  instructions?: string;
  tone: AiTone;
  originCityName: string;
  activeGroups: string[];
  payment: PaymentSettings;
  includePayment: boolean;
  historyStr: string;
  /** Nama & alamat pembeli yang sudah terekam (boleh dari pesan ini). */
  customerName?: string | null;
  customerAddress?: string | null;
}

/**
 * Blok pembuka prompt yang sama untuk SEMUA jalur balasan AI.
 *
 * Disatukan supaya "Instruksi khusus untuk AI CS" dan nada bicara dari tab
 * Pengaturan Toko berlaku di mana pun AI ikut menyusun kalimat — dulu keduanya
 * hanya sampai ke jalur obrolan umum, jadi justru balasan terpenting (harga,
 * ongkir, total) tidak pernah mengikuti instruksi pemilik toko.
 */
function renderStoreVoice(v: StoreVoice): string {
  const lines: string[] = [];

  lines.push(`Kamu adalah Customer Service WhatsApp untuk toko "${v.storeName}".`);
  lines.push(`Barang dikirim dari: ${v.originCityName}.`);
  lines.push(`Nada bicara: ${AI_TONE_INSTRUCTIONS[v.tone]}`);

  if (v.instructions && v.instructions.trim()) {
    lines.push(
      `
INSTRUKSI PEMILIK TOKO (prioritas tertinggi selain aturan angka di bawah):
${v.instructions.trim()}`
    );
  }

  if (v.activeGroups.length > 0) {
    lines.push(
      `Ekspedisi yang dilayani toko: ${v.activeGroups
        .map((c) => courierLabel(c))
        .join(", ")}. Jangan menawarkan ekspedisi di luar daftar itu.`
    );
  }

  if (v.includePayment) {
    const summary = [
      ...v.payment.accounts.map(
        (a) => `${a.type === "ewallet" ? "" : "Transfer "}${a.name} ${a.number}${a.holder ? ` (a.n. ${a.holder})` : ""}`
      ),
      v.payment.codEnabled ? "COD (bayar di tempat)" : ""
    ]
      .filter(Boolean)
      .join("; ");
    if (summary) lines.push(`Metode pembayaran yang tersedia: ${summary}.`);
    const note = (v.payment.note || "").trim();
    if (note) lines.push(`Catatan pembayaran dari toko: ${note}`);
  }

  if (v.historyStr) {
    lines.push(
      `
Riwayat percakapan sebelumnya dengan pembeli ini (terlama ke terbaru):
${v.historyStr}

Gunakan riwayat itu sebagai konteks: jangan menyapa ulang seperti pesan
pertama, jangan menanyakan hal yang sudah dijawab pembeli, dan rujuk produk
atau kota yang sudah disebut bila pembeli memakai kata seperti "itu"/"tadi".`
    );
  }

  // Data pembeli yang sudah tercatat. Ini yang membuat bot berhenti menanyakan
  // hal yang sudah dijawab — keluhan paling wajar terhadap CS otomatis — bahkan
  // di paket yang tidak mengirim riwayat chat ke model.
  const identity: string[] = [];
  if (v.customerName) identity.push(`- Nama pembeli: ${v.customerName}`);
  if (v.customerAddress) identity.push(`- Alamat kirim: ${v.customerAddress}`);
  if (identity.length > 0) {
    lines.push(
      `
DATA PEMBELI YANG SUDAH TERCATAT:
${identity.join("\n")}

Sapa pembeli dengan namanya bila wajar, dan JANGAN menanyakan data yang sudah
tercatat di atas.`
    );
  }

  return lines.join("\n");
}

/** Aturan angka yang berlaku di setiap jalur AI. */
const NUMBER_RULES = `ATURAN ANGKA — WAJIB DIPATUHI:
- Angka rupiah HANYA boleh disalin dari DATA di atas. Jangan menghitung ulang,
  jangan membulatkan, jangan memperkirakan, dan jangan mengarang.
- Jangan menyebut angka rupiah yang tidak ada di DATA, sekecil apa pun.
- Kalau pembeli menanyakan sesuatu yang angkanya tidak ada di DATA, katakan
  akan dicek dahulu — jangan menyebut angka apa pun.`;

/**
 * Rincian pesanan sebagai DATA untuk model: jumlah unit, harga satuan, dan
 * subtotal per baris. Ini yang membuat AI bisa menjawab "2 kaos berapa?"
 * dengan angka yang benar alih-alih menolak menjawab.
 */
function renderOrderFacts(draft: OrderDraft, guard: NumberGuard): string {
  if (draft.lines.length === 0) return "";

  const rows = draft.lines.map((l) => {
    guard.amounts.add(l.price);
    guard.amounts.add(l.lineTotal);
    const unit = l.price > 0 ? `Rp ${l.price.toLocaleString("id-ID")}` : "harga belum ada";
    const total = l.lineTotal > 0 ? `Rp ${l.lineTotal.toLocaleString("id-ID")}` : "belum bisa dihitung";
    return `- ${l.name}: ${l.units} × ${unit} = ${total}`;
  });

  guard.amounts.add(draft.subtotal);
  guard.amounts.add(draft.weightGram);

  // Jumlah barang didaftarkan juga: pada pesanan grosir (mis. 10 lusin = 120)
  // angkanya bisa melewati MONEY_SCALE_MIN, dan tanpa ini pagar angka akan
  // menolak tulisan model yang sebetulnya benar.
  const units = draft.totalUnits > 0 ? draft.totalUnits : countDraftUnits(draft.lines);
  guard.amounts.add(units);

  return `Produk yang disebut pembeli:
${rows.join("\n")}
Total barang: ${units} pcs
Subtotal produk: Rp ${draft.subtotal.toLocaleString("id-ID")}
Berat paket: ${formatWeight(draft.weightGram)}${
    draft.weightSource === "default" ? " (perkiraan, bukan dari data produk)" : ""
  }`;
}

/** Katalog sebagai DATA, sekaligus mendaftarkan harganya ke pagar angka. */
function renderCatalogFacts(products: ProductLike[], guard: NumberGuard): string {
  if (products.length === 0) return "Belum ada katalog produk.";
  return products
    .map((p) => {
      const price = Number(p.price);
      if (Number.isFinite(price) && price > 0) guard.amounts.add(Math.round(price));
      const weight = Number(p.weight);
      if (Number.isFinite(weight) && weight > 0) guard.amounts.add(Math.round(weight));

      // Status stok masuk ke FAKTA, bukan cuma ke pemeriksaan pesanan: pembeli
      // yang bertanya "ready?" harus dijawab benar tanpa menyebut jumlah unit,
      // dan model tidak boleh mengarang ketersediaan yang tidak diketahuinya.
      const stock = stockOf(p);
      let availability = "";
      if (stock === 0) {
        availability = " · STOK HABIS (jangan terima pesanan produk ini)";
      } else if (stock !== null && stock <= LOW_STOCK_THRESHOLD) {
        guard.amounts.add(stock);
        availability = ` · sisa ${stock} pcs`;
      }

      return `- ${p.name}: Rp ${price.toLocaleString("id-ID")} · ${p.weight} gram${
        p.description ? ` · ${p.description}` : ""
      }${availability}`;
    })
    .join("\n");
}

/**
 * Ongkir per ekspedisi (dan total bayarnya) sebagai DATA.
 *
 * Total dihitung DI SINI, bukan oleh model. Model hanya menyalin — itulah yang
 * membuat "harga barang + ongkir = total bayar" bisa dijawab dengan lancar
 * tanpa membuka peluang salah hitung.
 */
function renderQuoteFacts(
  options: QuoteOption[],
  subtotal: number,
  withTotal: boolean,
  guard: NumberGuard
): string {
  if (options.length === 0) return "Tidak ada layanan kurir yang tersedia ke tujuan itu.";

  return options
    .map((o) => {
      if (o.askForRate) {
        return `- ${o.courier_name} (${o.service_name}): ongkir menyesuaikan jarak, angkanya BELUM ada`;
      }
      const cost = Math.round(o.cost);
      guard.amounts.add(cost);
      let line = `- ${o.courier_name} (${o.service_name}): ongkir Rp ${cost.toLocaleString("id-ID")}`;
      if (o.etd) line += `, estimasi ${o.etd}`;
      if (withTotal && subtotal > 0) {
        const total = subtotal + cost;
        guard.amounts.add(total);
        line += `, total bayar Rp ${total.toLocaleString("id-ID")}`;
      }
      if (o.belowMinimumWeight) line += ` (kena tarif minimum karena paket terlalu ringan)`;
      return line;
    })
    .join("\n");
}

/**
 * Bungkus balasan deterministik menjadi tugas "tulis ulang" untuk model.
 *
 * Isi balasan sudah lengkap dan angkanya sudah benar sebelum model dipanggil;
 * model hanya mengatur ulang bahasanya mengikuti instruksi & nada toko. Ini
 * membalik urutan yang lazim (model mengarang lalu diperiksa) menjadi: sistem
 * yang menentukan fakta, model yang menentukan gaya.
 */
function rewriteTask(deterministic: string): string {
  return `BALASAN VERSI SISTEM (isi dan seluruh angkanya sudah benar):
"""
${deterministic}
"""

Tugasmu: sampaikan ULANG isi balasan di atas dengan bahasa dan nada toko
seperti diminta di awal, mengikuti instruksi pemilik toko bila ada.
- Semua informasi penting harus tetap tersampaikan: rincian pesanan, ongkir
  tiap ekspedisi, total bayar, dan cara pembayaran (bila ada di atas).
- Semua angka disalin PERSIS, termasuk pemisah ribuan. Jangan menambah,
  mengurangi, membulatkan, atau menghitung ulang.
- Tulis untuk WhatsApp: gunakan *tebal* satu bintang, bukan markdown **, dan
  jangan memakai tabel.
- Balas hanya dengan teks pesannya, tanpa kalimat pengantar apa pun.`;
}

/**
 * Instruksi tambahan supaya model IKUT memancing data pembeli yang belum ada,
 * dan mengakui data yang baru tercatat.
 *
 * Teksnya sudah disusun deterministik (tanpa angka), jadi menyuruh model
 * menyampaikannya tidak membuka celah baru pada pemeriksaan angka.
 */
function identityTask(ask: string, ack: string): string {
  const lines: string[] = [];
  if (ack) {
    lines.push(`- Sebutkan lebih dulu bahwa data pembeli sudah dicatat, seperti: "${ack}"`);
  }
  if (ask) {
    lines.push(
      `- WAJIB tutup pesan dengan menanyakan data yang belum ada. Inti kalimatnya: "${ask}"`,
      `  Pertanyaan ini tidak boleh dihilangkan atau diganti topik.`
    );
  }
  return lines.length > 0 ? `\n${lines.join("\n")}` : "";
}

/**
 * Gabungkan balasan deterministik dengan pengakuan & pancingan data pembeli.
 * Dipakai sebagai fallback bila AI mati atau balasannya ditolak pagar angka.
 */
function withIdentitySuffix(reply: string, ack: string, ask: string): string {
  return [reply, ack, ask].filter((s) => s && s.trim()).join("\n\n");
}

/**
 * Proses pesan pembeli yang masuk melalui WhatsApp.
 *
 * Pembungkus tipis di atas `runCustomerService`: ia menyiapkan satu `AITrace`,
 * meneruskannya ke jalur mana pun yang dipakai, lalu menempelkan hasilnya ke
 * nilai kembalian. Dibungkus alih-alih menambah field di ~10 titik `return`
 * supaya penandanya tidak mungkin lupa dipasang di salah satu jalur.
 */
export async function processAICustomerService(params: AIProcessParams): Promise<AIProcessResult> {
  const trace: AITrace = {
    narrated: false,
    // Jalur yang memang tidak melibatkan model (pesan sapaan toko, atau
    // pratinjau yang sengaja mematikan AI) berhenti di nilai awal ini; kalau
    // kuncinya belum di-set, itu yang dilaporkan.
    reason: params.disableAiNarration || process.env.GEMINI_API_KEY ? "deterministic" : "no-key"
  };

  const result = await runCustomerService(params, trace);

  // ── Pemberitahuan stok ditempel DI LUAR jalur model ─────────────────────
  //
  // Sengaja di sini, bukan di dalam prompt tiap jalur: kalimat "stok habis" tidak
  // boleh bergantung pada kepatuhan model. Model yang mengabaikannya satu kali
  // saja berarti toko menerima uang untuk barang yang tidak ada. Ditempel di
  // ATAS balasan supaya pembeli membacanya sebelum angka total bayar.
  const notice = formatStockNotice(result.orderDraft || { lines: [], subtotal: 0, totalUnits: 0, weightGram: 0, weightSource: "default", ambiguous: [] });
  const replyText = notice ? `${notice}\n\n${result.replyText}` : result.replyText;

  // Foto produk yang benar-benar disebut pembeli — bukan seluruh katalog. Mengirim
  // sepuluh gambar sekaligus ke WhatsApp membuat chat tidak terbaca dan tagihan
  // media Fonnte membengkak tanpa menambah kejelasan.
  const mediaUrls = collectDraftImages(result.orderDraft, params.products);

  return {
    ...result,
    replyText,
    stockBlocked: draftHasSoldOut(result.orderDraft),
    mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
    aiNarrated: trace.narrated,
    aiFallbackReason: trace.narrated ? undefined : trace.reason,
    aiRejectedNumber: trace.narrated ? undefined : trace.offender
  };
}

/**
 * URL foto produk yang dikutip balasan ini (maksimal `MAX_MEDIA_PER_REPLY`).
 *
 * Dicocokkan dari draf pesanan, jadi hanya produk yang MEMANG disebut pembeli
 * yang fotonya terkirim. Duplikat dibuang: dua baris pesanan bisa menunjuk produk
 * yang sama setelah pembeli memperbaiki jumlahnya.
 */
const MAX_MEDIA_PER_REPLY = 3;

function collectDraftImages(
  draft: OrderDraft | undefined,
  products: AIProcessParams["products"]
): string[] {
  if (!draft || draft.lines.length === 0 || !products || products.length === 0) return [];

  const byName = new Map<string, string>();
  for (const p of products) {
    const url = (p.image_url || "").trim();
    if (url) byName.set(normalizeForMatch(p.name || ""), url);
  }
  if (byName.size === 0) return [];

  const out: string[] = [];
  for (const line of draft.lines) {
    const url = byName.get(normalizeForMatch(line.name || ""));
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= MAX_MEDIA_PER_REPLY) break;
  }
  return out;
}

async function runCustomerService(params: AIProcessParams, trace: AITrace): Promise<AIProcessResult> {
  const {
    messageText,
    storeName,
    aiPromptSystem,
    greetingMessage,
    originSubdistrictId = "3171010",
    originCityName = "Jakarta Pusat",
    mengantarApiKey,
    defaultWeight = 1000,
    products = [],
    chatHistory = [],
    aiContextMessages = 0,
    activeCouriers,
    localCourier,
    paymentAccounts,
    codEnabled = false,
    paymentNote,
    aiTone,
    includeTotal = true,
    includePayment = true,
    knownCustomerName,
    knownCustomerAddress,
    knownDestinationCity,
    disableAiNarration = false,
    lastAssistantMessage
  } = params;

  const tone: AiTone = normalizeAiTone(aiTone);
  const payment: PaymentSettings = {
    accounts: normalizePaymentAccounts(paymentAccounts),
    codEnabled: codEnabled === true,
    note: paymentNote || ""
  };
  // Kosong = semua ekspedisi. Dinormalkan di sini supaya nilai lama seperti
  // `jnt` tetap dikenali dan penyaringannya konsisten dengan dashboard.
  const activeGroups = normalizeActiveCouriers(activeCouriers);

  const rawMessage = messageText.trim();
  const lowerMsg = rawMessage.toLowerCase();

  // Pratinjau "isi balasan" mematikan jalur model dengan sengaja: seluruh kode
  // di bawah sudah memakai `geminiApiKey` sebagai penentu, jadi cukup satu baris.
  const geminiApiKey = disableAiNarration ? undefined : process.env.GEMINI_API_KEY;
  if (!geminiApiKey && !disableAiNarration) {
    console.warn("[ai] GEMINI_API_KEY belum di-set — balasan dipakai apa adanya dari format deterministik.");
  }

  // Riwayat percakapan — hanya untuk paket yang berhak (Pro). Tanpa blok ini
  // model tidak tahu apa pun yang sudah dibicarakan, jadi pembeli yang bertanya
  // "yang tadi itu berapa?" akan dibalas seolah pesan pertama. Dipotong dari
  // BELAKANG supaya yang terbaru selalu ikut, dan tiap isi pesan dipangkas agar
  // satu pesan panjang tidak menelan seluruh konteks.
  const contextTurns = Math.max(0, Math.floor(aiContextMessages));
  const recent = contextTurns > 0 ? chatHistory.slice(-contextTurns) : [];
  const historyStr = recent
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Pembeli" : "CS"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  // ── Slot identitas pembeli (nama & alamat) ────────────────────────────────
  //
  // Dibaca DETERMINISTIK dari pesan, bukan dititipkan ke model: nama & alamat
  // yang keliru terekam akan dipakai mengirim barang. Lihat lib/customer-slots.ts.
  const expecting = detectSlotAsk(lastAssistantMessage);
  const capturedName = extractCustomerName(rawMessage, expecting);
  const capturedAddress = extractCustomerAddress(rawMessage, expecting);

  const knownName = (capturedName || knownCustomerName || "").trim() || null;
  const knownAddress = (capturedAddress || knownCustomerAddress || "").trim() || null;
  const missingSlots = { name: !knownName, address: !knownAddress };
  const identityAsk = buildIdentityAsk(missingSlots);
  // Di jalur yang pembelinya belum tentu memesan (katalog, obrolan umum) hanya
  // NAMA yang dipancing. Meminta alamat lengkap kepada orang yang baru bertanya
  // "ada apa saja?" terasa memaksa dan sering membuat chat ditinggalkan.
  const nameAsk = buildIdentityAsk({ name: missingSlots.name, address: false });
  const slotAck = buildSlotAck({ name: capturedName, address: capturedAddress });

  const orderCommit = isOrderCommit(rawMessage);

  /**
   * Draf pesanan — produk yang DISEBUT pembeli beserta jumlahnya.
   *
   * Dihitung SEKALI di sini, bukan lagi di masing-masing jalur balasan. Dulu
   * jalur ongkir dan jalur pesanan menghitungnya sendiri-sendiri, sehingga
   * "pesan 2 kaos, kirim ke Coblong" hanya bisa masuk salah satu jalur: yang
   * satu tahu jumlah barangnya tapi tidak menghitung ongkir, yang lain
   * sebaliknya. Dengan satu draf, kedua angka bisa muncul di balasan yang sama —
   * inilah "jumlah barang + ongkirnya" yang diminta pemilik toko.
   */
  const draft = resolveOrderDraft(rawMessage, products, defaultWeight);
  /** Pesanan sungguhan: niat memesan DAN ada produk yang benar-benar cocok. */
  const commitWithLines = orderCommit && draft.lines.length > 0;

  // Identitas & aturan toko, dipakai SEMUA jalur balasan AI di bawah.
  const voiceText = renderStoreVoice({
    storeName,
    instructions: aiPromptSystem,
    tone,
    originCityName,
    activeGroups,
    payment,
    includePayment,
    historyStr,
    customerName: knownName,
    customerAddress: knownAddress
  });

  /** Pagar angka dasar: apa pun yang sudah ada di percakapan & pengaturan toko. */
  const baseGuard = (): NumberGuard => {
    const guard = emptyGuard();
    allowPaymentDigits(guard, payment);
    allowTextNumbers(guard, aiPromptSystem);
    allowTextNumbers(guard, payment.note);
    allowTextNumbers(guard, greetingMessage);
    allowTextNumbers(guard, rawMessage);
    allowTextNumbers(guard, historyStr);
    // Alamat pembeli memuat nomor rumah & kode pos yang besarnya bisa terbaca
    // sebagai angka rupiah. Tanpa dua baris ini, balasan yang mengulang alamat
    // (justru yang paling berguna untuk dikonfirmasi) akan ditolak pagar angka.
    allowTextNumbers(guard, knownName);
    allowTextNumbers(guard, knownAddress);
    return guard;
  };

  // 0. Pesanan yang memuat barang HABIS ditolak lebih dulu dari jalur mana pun.
  //
  //    Diletakkan di paling atas dengan sengaja: kalau pembeli menyebut kota tujuan
  //    sekaligus, jalur ongkir di bawah akan menjawab dengan tarif dan total bayar
  //    untuk barang yang tidak mungkin dikirim. Menghitung ongkir barang kosong
  //    bukan cuma sia-sia, tapi terbaca sebagai pesanan yang sudah diterima.
  //
  //    Sengaja deterministik (model tidak dipanggil): ini satu-satunya balasan yang
  //    isinya penolakan, dan penulisan ulang yang terlalu ramah bisa berubah rasa
  //    menjadi persetujuan. Pemanggil juga tidak akan mencatat pesanannya karena
  //    `stockBlocked` — jadi balasan dan basis data sepakat.
  if (commitWithLines && draftHasSoldOut(draft)) {
    const availableNames = draft.lines.filter((l) => l.stock !== 0).map((l) => l.name);
    const soldOutReply =
      `Mohon maaf Kak, ada barang yang stoknya sedang habis, jadi pesanannya belum kami catat dulu 🙏\n\n` +
      (availableNames.length > 0
        ? `Yang masih tersedia: ${availableNames.join(", ")}.\nMau kami proses yang tersedia saja, atau ditunggu sampai stoknya masuk?`
        : `Boleh pilih produk lain, atau mau kami kabari begitu stoknya masuk lagi?`);

    return {
      replyText: withIdentitySuffix(soldOutReply, slotAck, nameAsk),
      // Tetap ORDER + orderCommit: niat memesannya nyata, dan pemilik toko perlu
      // melihatnya sebagai permintaan yang hilang karena stok — bukan obrolan biasa.
      intent: "ORDER",
      capturedName,
      capturedAddress,
      orderDraft: draft,
      orderCommit: true
    };
  }

  // 1. Deteksi Kata Kunci Ongkir / Kota / Alamat
  const isOngkirQuery =
    lowerMsg.includes("ongkir") ||
    lowerMsg.includes("kirim") ||
    lowerMsg.includes("biaya pengiriman") ||
    lowerMsg.includes("tarif") ||
    lowerMsg.includes("kecamatan") ||
    lowerMsg.includes("kota");

  const isProductQuery =
    lowerMsg.includes("harga") ||
    lowerMsg.includes("produk") ||
    lowerMsg.includes("jual") ||
    lowerMsg.includes("barang") ||
    lowerMsg.includes("stok") ||
    lowerMsg.includes("rincian") ||
    lowerMsg.includes("katalog");

  // Sapaan: pesan pertama, "ping" khas WA ("p"/"pp"), atau diawali kata sapaan.
  // (Dulu memakai startsWith("p") yang keliru menyapa pesan seperti "produk apa".)
  const greetingWords = [
    "halo", "hallo", "hai", "hi", "hei", "assalam", "pagi", "siang",
    "sore", "malam", "selamat", "permisi", "spam"
  ];
  const firstWord = lowerMsg.split(/\s+/)[0] || "";
  const isPing = lowerMsg === "p" || lowerMsg === "pp";
  const isGreetingQuery =
    chatHistory.length === 0 ||
    isPing ||
    greetingWords.some((w) => firstWord === w || lowerMsg.startsWith(w + " "));

  // Eksplorasi Kota/Kecamatan dari teks pesan
  let targetLocationQuery = "";
  const cityPatterns = [
    /(?:ke|di|tujuan|daerah|kota|kecamatan)\s+([a-zA-Z\s]{3,20})/i,
    /ongkir\s+([a-zA-Z\s]{3,20})/i,
    /kirim\s+(?:ke\s+)?([a-zA-Z\s]{3,20})/i
  ];

  for (const pat of cityPatterns) {
    const match = rawMessage.match(pat);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (!["berapa", "dong", "ya", "kak", "min", "tolong"].includes(candidate.toLowerCase())) {
        targetLocationQuery = candidate;
        break;
      }
    }
  }

  /**
   * Tujuan pengiriman yang akan dicari ke Mengantar.
   *
   * Tiga sumber, dari yang paling dipercaya: (1) tujuan yang disebut di pesan
   * ini, (2) kecamatan/kota yang tersimpan di alamat lengkap pembeli, (3) tujuan
   * yang sudah pernah berhasil dihitung di percakapan ini. Sumber 2 & 3 yang
   * membuat "oke pesan 2 kaos" — tanpa menyebut kota lagi — tetap bisa dibalas
   * lengkap dengan ongkir, alih-alih menanyakan alamat yang sudah dikirim
   * pembeli beberapa pesan sebelumnya.
   */
  const destQuery =
    targetLocationQuery ||
    extractShippingCityQuery(knownAddress) ||
    (knownDestinationCity || "").split(",")[0].trim();
  const destFromMessage = !!targetLocationQuery;
  const wantsOngkir = isOngkirQuery || !!targetLocationQuery;

  /**
   * Tujuan yang benar-benar dipakai menghitung tarif.
   *
   * `searchMengantarLocation` SELALU mengembalikan hasil — kalau tidak ketemu ia
   * mengarang lokasi dengan id "99999…" dan `source: "mock"`. Untuk tujuan yang
   * disebut langsung di pesan, hasil karangan itu tetap dipakai (pembeli memang
   * menyebut tempat itu, dan balasannya jelas ditandai perkiraan). Tapi untuk
   * tujuan yang hanya DITEBAK dari alamat atau catatan percakapan, hanya lokasi
   * yang sungguh dikenali kurir yang boleh dipakai — mengarang tarif ke tempat
   * yang tidak pernah disebut pembeli jauh lebih buruk daripada sekadar tidak
   * menyebut ongkir.
   */
  let resolvedDest: { id: string; name: string; source: RateSource } | null = null;
  // Pencarian lokasi hanya dijalankan bila hasilnya akan dipakai: jalur ongkir,
  // atau pesanan sungguhan yang tujuannya sudah diketahui.
  if (destQuery && (wantsOngkir || commitWithLines)) {
    const { locations, source: locSource } = await searchMengantarLocation(destQuery, mengantarApiKey);
    const loc = locations[0];
    if (loc && (destFromMessage || locSource === "live")) {
      resolvedDest = {
        id: loc.id,
        name: `${loc.subdistrict_name}, ${loc.city_name}`,
        source: locSource
      };
    }
  }

  // Jalur ongkir dibuka juga untuk pesanan yang tujuannya sudah diketahui, walau
  // pembeli tidak menyebut kata "ongkir" sama sekali. Sebaliknya, pesanan yang
  // tujuannya TIDAK bisa dipastikan tidak masuk sini — ia jatuh ke jalur
  // konfirmasi pesanan di bawah, yang tidak menyebut angka ongkir sama sekali.
  if (wantsOngkir || resolvedDest) {
    if (!resolvedDest) {
      // Menanyakan ongkir tanpa menyebut kota. Ongkirnya belum bisa dihitung,
      // tapi subtotal produknya sudah bisa — jadi pembeli tetap dapat sesuatu
      // yang berguna sambil dimintai kota tujuan.
      const ask =
        `Tentu Kak! Untuk mengecek tarif ongkir dari toko kami (*${originCityName}*), ` +
        `boleh minta informasi nama *Kecamatan* atau *Kota* tujuan pengirimannya Kak? 🚚`;
      const fallback = draft.lines.length > 0 ? `${formatOrderSummary(draft)}\n\n${ask}` : ask;

      // Sengaja TIDAK menanyakan nama/alamat di sini: jalur ini sudah punya satu
      // pertanyaan (kota tujuan), dan dua pertanyaan sekaligus membuat pembeli
      // menjawab salah satunya saja.
      if (!geminiApiKey) {
        return {
          replyText: fallback,
          intent: "ONGKIR_CHECK",
          capturedName,
          capturedAddress,
          orderDraft: draft,
          orderCommit
        };
      }

      const guard = baseGuard();
      const orderFacts = renderOrderFacts(draft, guard);
      const replyText = await narrateWithGemini({
        apiKey: geminiApiKey,
        guard,
        fallback,
        label: "ongkir-tanpa-tujuan",
        trace,
        prompt: `${voiceText}

DATA:
${orderFacts || "Pembeli belum menyebut produk tertentu."}
Ongkir dan total bayar BELUM bisa dihitung karena kecamatan/kota tujuan belum diketahui.

${NUMBER_RULES}
- Jangan menyebut angka ongkir maupun total bayar sama sekali; angkanya belum ada.

Pesan pembeli: "${rawMessage}"

Tugasmu: minta nama kecamatan atau kota tujuan pengiriman supaya sistem bisa
menghitung ongkirnya. Kalau DATA memuat rincian produk, sebutkan dulu rincian
dan subtotalnya. Tulis untuk WhatsApp (*tebal* satu bintang), tanpa kalimat
pengantar.`
      });

      return {
        replyText,
        intent: "ONGKIR_CHECK",
        capturedName,
        capturedAddress,
        orderDraft: draft,
        orderCommit
      };
    }

    // Tujuan sudah pasti — hitung tarifnya.
    const destName = resolvedDest!.name;
    const destId = resolvedDest!.id;
    const locSource = resolvedDest!.source;

    const { rates, source: rateSource } = await calculateMengantarOngkir({
      originSubdistrictId,
      destinationSubdistrictId: destId,
      weightGram: draft.weightGram,
      couriers: activeGroups,
      apiKey: mengantarApiKey
    });

    // Kalau pencarian lokasi saja sudah jatuh ke mock, tarifnya pasti bukan live.
    const effectiveSource: RateSource = locSource === "mock" ? "mock" : rateSource;

    // Versi deterministik dihitung LEBIH DULU dan selalu lengkap: rincian
    // pesanan, ongkir per ekspedisi, total bayar, cara bayar. Ini yang dikirim
    // kalau AI tidak tersedia atau balasannya tidak lolos pemeriksaan angka.
    const deterministic = buildOngkirReply({
      draft,
      rates,
      localCourier,
      destinationName: destName,
      originCityName,
      source: effectiveSource,
      payment,
      includeTotal,
      includePayment,
      courierFilterActive: activeGroups.length > 0,
      // Data penerima dibacakan ulang HANYA pada balasan yang menutup pesanan.
      // Pada pertanyaan ongkir biasa, orang yang baru menanyakan tarif belum
      // tentu memesan — membacakan nama & alamatnya di situ terasa seperti
      // pesanan yang tiba-tiba sudah jadi.
      customerName: commitWithLines ? knownName : undefined,
      customerAddress: commitWithLines ? knownAddress : undefined
    });

    // Pembeli sudah menyebut tujuan: ini saat paling wajar meminta nama & alamat
    // lengkap — data yang memang dibutuhkan untuk memproses pesanan.
    const detWithIdentity = withIdentitySuffix(deterministic, slotAck, identityAsk);

    let replyText = detWithIdentity;

    if (geminiApiKey) {
      const guard = baseGuard();
      const orderFacts = renderOrderFacts(draft, guard);
      const { shown, hidden } = mergeQuoteOptions(rates, localCourier);
      const withTotal = includeTotal && draft.lines.length > 0;
      const quoteFacts = renderQuoteFacts(shown, draft.subtotal, withTotal, guard);

      replyText = await narrateWithGemini({
        apiKey: geminiApiKey,
        guard,
        fallback: detWithIdentity,
        label: "ongkir",
        trace,
        prompt: `${voiceText}

DATA — dihitung sistem, bukan olehmu:
${orderFacts ? `${orderFacts}\n` : ""}Tujuan pengiriman: ${destName}
Ongkir per ekspedisi${withTotal ? " beserta total bayarnya" : ""}:
${quoteFacts}${
          hidden > 0 ? `\nMasih ada ${hidden} pilihan ekspedisi lain yang tidak ditampilkan.` : ""
        }${
          effectiveSource === "mock"
            ? "\nCATATAN: tarif di atas masih PERKIRAAN, bukan tarif kurir pasti. Sampaikan itu ke pembeli."
            : ""
        }${
          draft.ambiguous.length > 0
            ? `\nPRODUK AMBIGU: pembeli menyebut sesuatu yang cocok dengan beberapa produk (${draft.ambiguous.join(
                ", "
              )}). Tanyakan yang mana sebelum memastikan pesanan.`
            : ""
        }

${NUMBER_RULES}

Pesan pembeli: "${rawMessage}"

${rewriteTask(deterministic)}${identityTask(identityAsk, slotAck)}`
      });
    }

    return {
      replyText,
      // Pesanan yang sekaligus mendapat ongkir tetap dicatat sebagai PESANAN,
      // bukan sebagai pertanyaan tarif — kalau tidak, pesanan yang paling
      // lengkap (produk + jumlah + tujuan sekaligus) justru tidak masuk daftar
      // pesanan toko.
      intent: commitWithLines ? "ORDER" : "ONGKIR_CHECK",
      shippingDetails: rates,
      detectedCity: destName,
      rateSource: effectiveSource,
      shippingWeightGram: draft.weightGram,
      capturedName,
      capturedAddress,
      orderDraft: draft,
      orderCommit
    };
  }

  // 2. Pembeli MEMESAN — bukan sekadar bertanya.
  //
  //    Diperiksa sebelum jalur katalog supaya "oke pesan 2 kaos" dibalas sebagai
  //    konfirmasi pesanan (rincian + data penerima + cara bayar), bukan sebagai
  //    daftar katalog. Syaratnya ada produk yang benar-benar cocok: niat memesan
  //    tanpa produk yang jelas ("mau beli dong") lebih baik jatuh ke jalur
  //    katalog/obrolan yang akan menanyakan produknya dulu.
  //
  //    Yang sampai ke sini adalah pesanan yang tujuan kirimnya BELUM bisa
  //    dipastikan — pesanan yang tujuannya sudah jelas dibalas lengkap dengan
  //    ongkir di jalur di atas.
  if (commitWithLines) {

    // Ongkir belum bisa dihitung, jadi tujuannya yang dipancing. Kalau alamatnya
    // sendiri belum ada, `identityAsk` sudah menanyakan itu — bertanya dua hal
    // sekaligus membuat pembeli menjawab salah satunya saja.
    const destinationAsk =
      identityAsk || !knownAddress
        ? ""
        : "Boleh konfirmasi *Kecamatan* dan *Kota* tujuannya ya Kak, biar ongkirnya kami hitung dengan tepat 🚚";
    const ask = identityAsk || destinationAsk;

    const deterministic = buildOrderConfirmReply({
      draft,
      customerName: knownName,
      customerAddress: knownAddress,
      payment,
      includePayment,
      identityAsk: ask,
      ack: slotAck
    });

    if (!geminiApiKey) {
      return {
        replyText: deterministic,
        intent: "ORDER",
        capturedName,
        capturedAddress,
        orderDraft: draft,
        orderCommit: true
      };
    }

    const guard = baseGuard();
    const orderFacts = renderOrderFacts(draft, guard);

    const replyText = await narrateWithGemini({
      apiKey: geminiApiKey,
      guard,
      fallback: deterministic,
      label: "pesanan",
      trace,
      prompt: `${voiceText}

DATA — dihitung sistem, bukan olehmu:
${orderFacts}
Ongkir belum dihitung; angkanya BELUM ada.${
        draft.ambiguous.length > 0
          ? `\nPRODUK AMBIGU: yang disebut pembeli cocok dengan beberapa produk (${draft.ambiguous.join(
              ", "
            )}). Tanyakan yang mana.`
          : ""
      }

${NUMBER_RULES}
- Jangan menyebut angka ongkir maupun total bayar; angkanya belum ada.

Pesan pembeli: "${rawMessage}"

${rewriteTask(deterministic)}${identityTask(ask, slotAck)}`
    });

    return {
      replyText,
      intent: "ORDER",
      capturedName,
      capturedAddress,
      orderDraft: draft,
      orderCommit: true
    };
  }

  // 3. Deteksi Pertanyaan Produk / Katalog (didahulukan dari sapaan agar
  //    pertanyaan eksplisit seperti "harga produk?" langsung dibalas katalog).
  if (isProductQuery && products.length > 0) {
    let prodText = `🛍️ *Katalog Produk - ${storeName}*\n\n`;
    products.forEach((p, idx) => {
      const stock = stockOf(p);
      prodText += `${idx + 1}. *${p.name}*${stock === 0 ? " — _stok habis_" : ""}\n`;
      prodText += `   💰 Rp ${p.price.toLocaleString("id-ID")}\n`;
      prodText += `   ⚖️ Berat: ${p.weight} gram\n`;
      // Sisa stok hanya ditampilkan saat menipis. Menulis "sisa 480 pcs" pada
      // barang yang menumpuk tidak menolong pembeli, sedangkan "sisa 2 pcs"
      // adalah alasan untuk memesan sekarang.
      if (stock !== null && stock > 0 && stock <= LOW_STOCK_THRESHOLD) {
        prodText += `   📦 Sisa ${stock} pcs\n`;
      }
      if (p.description) prodText += `   📝 ${p.description}\n`;
      prodText += `\n`;
    });
    prodText += `Mau pesan produk yang mana Kak? Bisa sekalian sebutkan lokasi kota untuk langsung kami hitungkan ongkirnya ya! 🚚`;

    const prodWithIdentity = withIdentitySuffix(prodText, slotAck, nameAsk);

    // Draf pesanan (dihitung sekali di atas) ikut dikirim supaya "harga 2 kaos
    // berapa?" dijawab dengan hitungannya, bukan dengan seluruh katalog yang
    // harus dihitung sendiri oleh pembeli.

    if (!geminiApiKey) {
      return {
        replyText: prodWithIdentity,
        intent: "PRODUCT_INQUIRY",
        capturedName,
        capturedAddress,
        orderDraft: draft,
        orderCommit
      };
    }

    const guard = baseGuard();
    const catalogFacts = renderCatalogFacts(products, guard);
    const orderFacts = renderOrderFacts(draft, guard);

    const replyText = await narrateWithGemini({
      apiKey: geminiApiKey,
      guard,
      fallback: prodWithIdentity,
      label: "katalog",
      trace,
      prompt: `${voiceText}

DATA — katalog produk toko:
${catalogFacts}
${orderFacts ? `\n${orderFacts}\n` : ""}${
        draft.ambiguous.length > 0
          ? `\nPRODUK AMBIGU: yang disebut pembeli cocok dengan beberapa produk (${draft.ambiguous.join(
              ", "
            )}). Tanyakan yang mana.\n`
          : ""
      }
Ongkir dan total bayar belum bisa dihitung sampai pembeli menyebut kecamatan/kota tujuan.

${NUMBER_RULES}
- Jangan menyebut angka ongkir maupun total bayar; angkanya belum ada.

Pesan pembeli: "${rawMessage}"

Tugasmu: jawab pertanyaan pembeli soal produk/harga memakai DATA di atas.
- Kalau pembeli menyebut produk dan jumlahnya, sebutkan rincian dan subtotalnya.
- Kalau pertanyaannya umum ("ada apa saja?"), sebutkan produknya beserta harga.
- Tutup dengan menawarkan pengecekan ongkir bila pembeli menyebut kota tujuan.
- Tulis untuk WhatsApp (*tebal* satu bintang), tanpa tabel dan tanpa kalimat
  pengantar.${identityTask(nameAsk, slotAck)}`
    });

    return {
      replyText,
      intent: "PRODUCT_INQUIRY",
      capturedName,
      capturedAddress,
      orderDraft: draft,
      orderCommit
    };
  }

  // 4. Jika Pesan adalah Sapaan Awal
  //
  //    Sengaja TIDAK memancing nama/alamat: sapaan pertama bukan tempat meminta
  //    data pribadi, dan teks sapaan milik pemilik toko tidak boleh disisipi.
  if (isGreetingQuery) {
    // Sapaan yang ditulis sendiri pemilik toko dikirim APA ADANYA. Itu teks yang
    // dia karang dan setujui; menyuruh AI "memperbaiki"-nya justru mengubah
    // sesuatu yang tidak diminta diubah.
    if (greetingMessage && greetingMessage.trim()) {
      return {
        replyText: greetingMessage,
        intent: "GREETING",
        capturedName,
        capturedAddress,
        orderCommit
      };
    }

    const defaultGreeting = `Halo! Selamat datang di *${storeName}* 👋 Ada yang bisa kami bantu mengenai produk kami atau mau langsung cek tarif ongkir ke lokasi Kakak?`;
    if (!geminiApiKey) {
      return {
        replyText: defaultGreeting,
        intent: "GREETING",
        capturedName,
        capturedAddress,
        orderCommit
      };
    }

    const guard = baseGuard();
    const catalogFacts = renderCatalogFacts(products, guard);
    const replyText = await narrateWithGemini({
      apiKey: geminiApiKey,
      guard,
      fallback: defaultGreeting,
      label: "sapaan",
      trace,
      prompt: `${voiceText}

DATA — katalog produk toko:
${catalogFacts}

${NUMBER_RULES}
- Ini pesan sapaan. Jangan menyebut angka rupiah kecuali pembeli menanyakannya.

Pesan pembeli: "${rawMessage}"

Tugasmu: balas sebagai sapaan pembuka yang singkat — sambut pembeli, sebutkan
nama toko, dan tawarkan bantuan soal produk atau pengecekan ongkir. Maksimal
tiga kalimat. Tulis untuk WhatsApp (*tebal* satu bintang), tanpa kalimat
pengantar.`
    });

    return {
      replyText,
      intent: "GREETING",
      capturedName,
      capturedAddress,
      orderCommit
    };
  }

  // 5. Obrolan umum — AI menyusun jawabannya, dengan katalog & draf pesanan
  //    sebagai satu-satunya sumber angka.
  const fallbackReply =
    `Terima kasih sudah menghubungi *${storeName}*! 😊\n\n` +
    `Pesan Kakak sudah kami terima. Kami siap membantu pertanyaan seputar produk maupun pengecekan tarif ongkos kirim (ongkir) kurir ke seluruh wilayah Indonesia.\n\n` +
    `Boleh diinfokan nama kota/kecamatan tujuan Kakak agar langsung kami bantu cek tarif ongkirnya? 📍`;

  const generalFallback = withIdentitySuffix(fallbackReply, slotAck, nameAsk);

  // ── Kapan sebuah pesan dihitung "tidak terjawab" ────────────────────────
  //
  // Balasan di atas adalah kalimat umum "pesan Kakak sudah kami terima" — pembeli
  // tidak mendapat jawaban, hanya tanda terima. Itu ditandai FALLBACK, bukan
  // GENERAL_CHAT, supaya pemilik toko bisa melihat daftar pertanyaan yang bot-nya
  // gagal jawab; tanpa pembeda ini kegagalan bot terlihat identik dengan obrolan
  // santai dan tidak akan pernah diperbaiki.
  //
  // Yang menyelamatkan pesan dari label itu ada dua: sistem menangkap sesuatu yang
  // konkret (produk, produk ambigu, nama, alamat), ATAU model berhasil menulis
  // jawaban sendiri — dalam kedua hal itu pembeli menerima balasan yang benar-benar
  // menanggapi pesannya.
  const understoodSomething =
    draft.lines.length > 0 ||
    draft.ambiguous.length > 0 ||
    Boolean(capturedName) ||
    Boolean(capturedAddress);

  if (!geminiApiKey) {
    return {
      replyText: generalFallback,
      intent: understoodSomething ? "GENERAL_CHAT" : "FALLBACK",
      capturedName,
      capturedAddress,
      orderDraft: draft,
      orderCommit
    };
  }

  const guard = baseGuard();
  const catalogFacts = renderCatalogFacts(products, guard);
  const orderFacts = renderOrderFacts(draft, guard);

  const replyText = await narrateWithGemini({
    apiKey: geminiApiKey,
    guard,
    fallback: generalFallback,
    label: "obrolan",
    trace,
    prompt: `${voiceText}

DATA — katalog produk toko:
${catalogFacts}
${orderFacts ? `\n${orderFacts}\n` : ""}${
      draft.ambiguous.length > 0
        ? `\nPRODUK AMBIGU: yang disebut pembeli cocok dengan beberapa produk (${draft.ambiguous.join(
            ", "
          )}). Tanyakan yang mana.\n`
        : ""
    }
${NUMBER_RULES}
- Ongkir dan total bayar TIDAK ADA di DATA dan tidak boleh ditebak. Kalau
  pembeli menanyakannya, minta nama kecamatan/kota tujuan supaya sistem yang
  menghitung — jangan menyebut angka ongkir apa pun.

Pesan pembeli: "${rawMessage}"

Tugasmu: balas sebagai Customer Service WhatsApp yang solutif.
- Kalau pembeli menyebut produk dan jumlahnya, sebutkan rincian dan subtotalnya
  dari DATA.
- Ajak mengecek ongkir atau melanjutkan pesanan bila relevan.
- Tulis untuk WhatsApp (*tebal* satu bintang), tanpa tabel dan tanpa kalimat
  pengantar.${identityTask(nameAsk, slotAck)}`
  });

  return {
    replyText,
    intent: trace.narrated || understoodSomething ? "GENERAL_CHAT" : "FALLBACK",
    capturedName,
    capturedAddress,
    orderDraft: draft,
    orderCommit
  };
}
