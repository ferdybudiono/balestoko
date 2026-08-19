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
  formatOrderSummary,
  formatWeight,
  mergeQuoteOptions,
  normalizeAiTone,
  normalizePaymentAccounts
} from "./reply-format";

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
  products?: Array<{ name: string; price: number; weight: number; description?: string }>;
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
}

export interface AIProcessResult {
  replyText: string;
  intent: "GREETING" | "ONGKIR_CHECK" | "PRODUCT_INQUIRY" | "GENERAL_CHAT";
  shippingDetails?: ShippingOption[];
  detectedCity?: string;
  /** `mock` = tarif simulasi (lokasi asal toko belum valid), bukan tarif kurir asli. */
  rateSource?: RateSource;
  /** Berat (gram) yang dipakai menghitung ongkir — berguna untuk audit tarif. */
  shippingWeightGram?: number;
}

type ProductLike = { name: string; price: number; weight: number; description?: string };

/** Di atas ini hampir pasti salah parse, dan kurir memang beda skema tarif. */
const MAX_SHIPPING_WEIGHT_GRAM = 50_000;
/** Batas jumlah unit yang diakui dari satu penyebutan produk. */
const MAX_UNITS_PER_PRODUCT = 20;

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jumlah unit yang disebut di sekitar nama produk: "2 kaos", "kaos x3",
 * "kaos 2 pcs". Tidak yakin → 1, karena menebak terlalu banyak berarti mengutip
 * ongkir lebih mahal dari seharusnya.
 */
function unitsMentioned(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return 1;
  const before = haystack.slice(Math.max(0, idx - 14), idx);
  const after = haystack.slice(idx + needle.length, idx + needle.length + 14);

  // `(?!\d)` / `(?:^|\D)` menjaga agar "kaos 250 gram" tidak dibaca 25 unit.
  const raw =
    /(?:^|\D)(\d{1,2})\s*(?:pcs|pes|buah|biji|unit|x)?\s*$/.exec(before)?.[1] ||
    /^\s*(?:x|sebanyak)?\s*(\d{1,2})(?!\d)\s*(?:pcs|pes|buah|biji|unit)?/.exec(after)?.[1];

  const n = raw ? parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_UNITS_PER_PRODUCT);
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

    const lineTotal = price * units;
    lines.push({ name: p.name, units, weight, price, lineTotal });
    subtotal += lineTotal;
    totalWeight += weight * units;
  }

  const weightOk = weightValid && totalWeight > 0;
  return {
    lines,
    subtotal,
    weightGram: weightOk ? Math.min(totalWeight, MAX_SHIPPING_WEIGHT_GRAM) : fallback,
    weightSource: weightOk ? "matched" : "default",
    ambiguous: ambiguousList
  };
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
}): Promise<string> {
  const { apiKey, prompt, fallback, guard, label } = params;

  const draftText = await generateGeminiReply(prompt, apiKey);
  if (!draftText) {
    console.warn(`[ai] ${label}: Gemini tidak membalas — pakai format deterministik.`);
    return fallback;
  }

  const verdict = replyKeepsNumbersHonest(draftText, guard);
  if (!verdict.ok) {
    console.warn(
      `[ai] ${label}: balasan Gemini memuat angka tanpa dasar ("${verdict.offender}") — dibuang, pakai format deterministik.`
    );
    return fallback;
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

  return `Produk yang disebut pembeli:
${rows.join("\n")}
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
      return `- ${p.name}: Rp ${price.toLocaleString("id-ID")} · ${p.weight} gram${
        p.description ? ` · ${p.description}` : ""
      }`;
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
 * Proses pesan pembeli yang masuk melalui WhatsApp
 */
export async function processAICustomerService(params: AIProcessParams): Promise<AIProcessResult> {
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
    includePayment = true
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

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
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

  // Identitas & aturan toko, dipakai SEMUA jalur balasan AI di bawah.
  const voiceText = renderStoreVoice({
    storeName,
    instructions: aiPromptSystem,
    tone,
    originCityName,
    activeGroups,
    payment,
    includePayment,
    historyStr
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
    return guard;
  };

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

  // Jika kata kunci ongkir ditemukan dan ada lokasi tujuan
  if (isOngkirQuery || targetLocationQuery) {
    // Draf pesanan: produk yang DISEBUT pembeli beserta jumlah & harganya, bukan
    // produk pertama di katalog. Tidak ada yang cocok → berat default toko.
    const draft = resolveOrderDraft(rawMessage, products, defaultWeight);

    if (!targetLocationQuery) {
      // Menanyakan ongkir tanpa menyebut kota. Ongkirnya belum bisa dihitung,
      // tapi subtotal produknya sudah bisa — jadi pembeli tetap dapat sesuatu
      // yang berguna sambil dimintai kota tujuan.
      const ask =
        `Tentu Kak! Untuk mengecek tarif ongkir dari toko kami (*${originCityName}*), ` +
        `boleh minta informasi nama *Kecamatan* atau *Kota* tujuan pengirimannya Kak? 🚚`;
      const fallback = draft.lines.length > 0 ? `${formatOrderSummary(draft)}\n\n${ask}` : ask;

      if (!geminiApiKey) return { replyText: fallback, intent: "ONGKIR_CHECK" };

      const guard = baseGuard();
      const orderFacts = renderOrderFacts(draft, guard);
      const replyText = await narrateWithGemini({
        apiKey: geminiApiKey,
        guard,
        fallback,
        label: "ongkir-tanpa-tujuan",
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

      return { replyText, intent: "ONGKIR_CHECK" };
    }

    // Cari lokasi di Mengantar
    const { locations, source: locSource } = await searchMengantarLocation(targetLocationQuery, mengantarApiKey);
    const destLoc = locations[0];
    const destName = destLoc ? `${destLoc.subdistrict_name}, ${destLoc.city_name}` : targetLocationQuery;
    const destId = destLoc ? destLoc.id : "3273010";

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
      courierFilterActive: activeGroups.length > 0
    });

    let replyText = deterministic;

    if (geminiApiKey) {
      const guard = baseGuard();
      const orderFacts = renderOrderFacts(draft, guard);
      const { shown, hidden } = mergeQuoteOptions(rates, localCourier);
      const withTotal = includeTotal && draft.lines.length > 0;
      const quoteFacts = renderQuoteFacts(shown, draft.subtotal, withTotal, guard);

      replyText = await narrateWithGemini({
        apiKey: geminiApiKey,
        guard,
        fallback: deterministic,
        label: "ongkir",
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

${rewriteTask(deterministic)}`
      });
    }

    return {
      replyText,
      intent: "ONGKIR_CHECK",
      shippingDetails: rates,
      detectedCity: destName,
      rateSource: effectiveSource,
      shippingWeightGram: draft.weightGram
    };
  }

  // 2. Deteksi Pertanyaan Produk / Katalog (didahulukan dari sapaan agar
  //    pertanyaan eksplisit seperti "harga produk?" langsung dibalas katalog).
  if (isProductQuery && products.length > 0) {
    let prodText = `🛍️ *Katalog Produk - ${storeName}*\n\n`;
    products.forEach((p, idx) => {
      prodText += `${idx + 1}. *${p.name}*\n`;
      prodText += `   💰 Rp ${p.price.toLocaleString("id-ID")}\n`;
      prodText += `   ⚖️ Berat: ${p.weight} gram\n`;
      if (p.description) prodText += `   📝 ${p.description}\n`;
      prodText += `\n`;
    });
    prodText += `Mau pesan produk yang mana Kak? Bisa sekalian sebutkan lokasi kota untuk langsung kami hitungkan ongkirnya ya! 🚚`;

    if (!geminiApiKey) return { replyText: prodText, intent: "PRODUCT_INQUIRY" };

    // Draf pesanan ikut dikirim supaya "harga 2 kaos berapa?" dijawab dengan
    // hitungannya, bukan dengan seluruh katalog yang harus dihitung pembeli.
    const draft = resolveOrderDraft(rawMessage, products, defaultWeight);
    const guard = baseGuard();
    const catalogFacts = renderCatalogFacts(products, guard);
    const orderFacts = renderOrderFacts(draft, guard);

    const replyText = await narrateWithGemini({
      apiKey: geminiApiKey,
      guard,
      fallback: prodText,
      label: "katalog",
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
  pengantar.`
    });

    return { replyText, intent: "PRODUCT_INQUIRY" };
  }

  // 3. Jika Pesan adalah Sapaan Awal
  if (isGreetingQuery) {
    // Sapaan yang ditulis sendiri pemilik toko dikirim APA ADANYA. Itu teks yang
    // dia karang dan setujui; menyuruh AI "memperbaiki"-nya justru mengubah
    // sesuatu yang tidak diminta diubah.
    if (greetingMessage && greetingMessage.trim()) {
      return { replyText: greetingMessage, intent: "GREETING" };
    }

    const defaultGreeting = `Halo! Selamat datang di *${storeName}* 👋 Ada yang bisa kami bantu mengenai produk kami atau mau langsung cek tarif ongkir ke lokasi Kakak?`;
    if (!geminiApiKey) return { replyText: defaultGreeting, intent: "GREETING" };

    const guard = baseGuard();
    const catalogFacts = renderCatalogFacts(products, guard);
    const replyText = await narrateWithGemini({
      apiKey: geminiApiKey,
      guard,
      fallback: defaultGreeting,
      label: "sapaan",
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

    return { replyText, intent: "GREETING" };
  }

  // 4. Obrolan umum — AI menyusun jawabannya, dengan katalog & draf pesanan
  //    sebagai satu-satunya sumber angka.
  const fallbackReply =
    `Terima kasih sudah menghubungi *${storeName}*! 😊\n\n` +
    `Pesan Kakak sudah kami terima. Kami siap membantu pertanyaan seputar produk maupun pengecekan tarif ongkos kirim (ongkir) kurir ke seluruh wilayah Indonesia.\n\n` +
    `Boleh diinfokan nama kota/kecamatan tujuan Kakak agar langsung kami bantu cek tarif ongkirnya? 📍`;

  if (!geminiApiKey) {
    return { replyText: fallbackReply, intent: "GENERAL_CHAT" };
  }

  const draft = resolveOrderDraft(rawMessage, products, defaultWeight);
  const guard = baseGuard();
  const catalogFacts = renderCatalogFacts(products, guard);
  const orderFacts = renderOrderFacts(draft, guard);

  const replyText = await narrateWithGemini({
    apiKey: geminiApiKey,
    guard,
    fallback: fallbackReply,
    label: "obrolan",
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
  pengantar.`
  });

  return { replyText, intent: "GENERAL_CHAT" };
}
