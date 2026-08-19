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
  buildOngkirReply,
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
    if (!targetLocationQuery) {
      // Jika menanyakan ongkir tanpa menyebutkan kota
      return {
        replyText: `Tentu Kak! Untuk mengecek tarif ongkir dari toko kami (*${originCityName}*), boleh minta informasi nama *Kecamatan* atau *Kota* tujuan pengirimannya Kak? 🚚`,
        intent: "ONGKIR_CHECK"
      };
    }

    // Cari lokasi di Mengantar
    const { locations, source: locSource } = await searchMengantarLocation(targetLocationQuery, mengantarApiKey);
    const destLoc = locations[0];
    const destName = destLoc ? `${destLoc.subdistrict_name}, ${destLoc.city_name}` : targetLocationQuery;
    const destId = destLoc ? destLoc.id : "3273010";

    // Draf pesanan: produk yang DISEBUT pembeli beserta jumlah & harganya, bukan
    // produk pertama di katalog. Tidak ada yang cocok → berat default toko.
    const draft = resolveOrderDraft(rawMessage, products, defaultWeight);

    const { rates, source: rateSource } = await calculateMengantarOngkir({
      originSubdistrictId,
      destinationSubdistrictId: destId,
      weightGram: draft.weightGram,
      couriers: activeGroups,
      apiKey: mengantarApiKey
    });

    // Kalau pencarian lokasi saja sudah jatuh ke mock, tarifnya pasti bukan live.
    const effectiveSource: RateSource = locSource === "mock" ? "mock" : rateSource;

    const replyText = buildOngkirReply({
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

    return {
      replyText: prodText,
      intent: "PRODUCT_INQUIRY"
    };
  }

  // 3. Jika Pesan adalah Sapaan Awal
  if (isGreetingQuery) {
    const defaultGreeting = greetingMessage || `Halo! Selamat datang di *${storeName}* 👋 Ada yang bisa kami bantu mengenai produk kami atau mau langsung cek tarif ongkir ke lokasi Kakak?`;
    return {
      replyText: defaultGreeting,
      intent: "GREETING"
    };
  }

  // 4. Menggunakan Google Gemini Generative AI jika GEMINI_API_KEY tersedia di ENV
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (geminiApiKey) {
    const productCatalogStr = products.map((p) => `- ${p.name}: Rp ${p.price} (${p.weight}g)`).join("\n");

    // Riwayat percakapan — hanya untuk paket yang berhak (Pro). Tanpa blok ini
    // model tidak tahu apa pun yang sudah dibicarakan, jadi pembeli yang
    // bertanya "yang tadi itu berapa?" akan dibalas seolah pesan pertama.
    // Dipotong dari BELAKANG supaya yang terbaru selalu ikut, dan tiap isi
    // pesan dipangkas agar satu pesan panjang tidak menelan seluruh konteks.
    const contextTurns = Math.max(0, Math.floor(aiContextMessages));
    const recent = contextTurns > 0 ? chatHistory.slice(-contextTurns) : [];
    const historyStr = recent
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "Pembeli" : "CS"}: ${m.content.slice(0, 400)}`)
      .join("\n");

    // Rekening disebut LENGKAP ke model supaya ia tidak perlu (dan tidak boleh)
    // mengarang nomor. Aturan "jangan mengarang" di bawah baru berarti kalau
    // data yang benar memang tersedia untuk dikutip.
    const paymentSummary = [
      ...payment.accounts.map(
        (a) => `${a.name} ${a.number}${a.holder ? ` (a.n. ${a.holder})` : ""}`
      ),
      payment.codEnabled ? "COD (bayar di tempat)" : ""
    ]
      .filter(Boolean)
      .join("; ");

    const aiPrompt = `
System Prompt: ${aiPromptSystem || "Kamu adalah CS AI yang ramah."}
Toko: ${storeName}
Pengiriman dari: ${originCityName}
Nada bicara: ${AI_TONE_INSTRUCTIONS[tone]}
Katalog Produk:
${productCatalogStr || "Belum ada katalog"}
${
  activeGroups.length > 0
    ? `Ekspedisi yang dilayani toko: ${activeGroups.map((c) => courierLabel(c)).join(", ")}.
Jangan menawarkan ekspedisi di luar daftar itu.
`
    : ""
}${
  paymentSummary
    ? `Metode pembayaran yang tersedia: ${paymentSummary}.
`
    : ""
}${
  payment.note ? `Catatan pembayaran dari toko: ${payment.note}\n` : ""
}${
  historyStr
    ? `
Riwayat percakapan sebelumnya dengan pembeli ini (terlama ke terbaru):
${historyStr}

Gunakan riwayat di atas sebagai konteks: jangan menyapa ulang seperti pesan
pertama, jangan menanyakan hal yang sudah dijawab pembeli, dan rujuk produk
atau kota yang sudah disebut bila pembeli memakai kata seperti "itu"/"tadi".
`
    : ""
}
Pesan Pembeli: "${rawMessage}"

ATURAN ANGKA — WAJIB DIPATUHI:
- JANGAN mengarang harga produk, ongkir, total, nomor rekening, atau nama bank.
  Pakai HANYA angka dan data yang tertulis di atas.
- Ongkir tidak boleh ditebak. Kalau pembeli menanyakan ongkir atau total,
  mintalah nama kecamatan/kota tujuannya supaya sistem yang menghitung.
- Kalau harga suatu produk tidak ada di katalog di atas, katakan akan dicek
  dahulu — jangan menyebut angka apa pun.
${
  payment.accounts.length > 0 || payment.codEnabled
    ? `- Nomor rekening hanya boleh disebut persis seperti yang tertulis di atas.
`
    : `- Toko belum mencantumkan rekening. Jangan memberi nomor rekening apa pun.
`
}
Balaslah sebagai Customer Service WhatsApp yang sopan dan solutif. Sertakan ajakan untuk mengecek ongkir atau pemesanan produk jika relevan.
`;

    const geminiReply = await generateGeminiReply(aiPrompt, geminiApiKey);
    if (geminiReply) {
      return {
        replyText: geminiReply,
        intent: "GENERAL_CHAT"
      };
    }
    console.warn("[ai] Gemini tidak mengembalikan balasan — pakai fallback rule-based.");
  } else {
    console.warn("[ai] GEMINI_API_KEY belum di-set — AI Gemini nonaktif, pakai fallback rule-based.");
  }

  // 5. Default Smart Rule Engine Fallback
  let fallbackReply = `Terima kasih sudah menghubungi *${storeName}*! 😊\n\n`;
  fallbackReply += `Pesan Kakak sudah kami terima. Kami siap membantu pertanyaan seputar produk maupun pengecekan tarif ongkos kirim (ongkir) kurir ke seluruh wilayah Indonesia.\n\n`;
  fallbackReply += `Boleh diinfokan nama kota/kecamatan tujuan Kakak agar langsung kami bantu cek tarif ongkirnya? 📍`;

  return {
    replyText: fallbackReply,
    intent: "GENERAL_CHAT"
  };
}
