/**
 * AI Assistant Engine for WhatsApp Customer Service
 * Integrates Gemini API / OpenAI API with fallback Intelligent Rule-Based Engine
 * Handles Buyer Greeting -> Location Extraction -> Mengantar Ongkir Calculation -> Conversational Chat
 */

import { calculateMengantarOngkir, searchMengantarLocation, RateSource, ShippingOption } from "./mengantar";

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

export interface ShippingWeightBasis {
  weightGram: number;
  matched: Array<{ name: string; units: number; weight: number }>;
  /** `matched` = berat produk yang disebut pembeli; `default` = asumsi toko. */
  source: "matched" | "default";
}

/**
 * Tentukan berat paket untuk kutipan ongkir.
 *
 * Dulu fungsi ini efektif `products[0].weight` — berat produk PERTAMA di katalog,
 * siapa pun yang bertanya dan apa pun yang ditanyakan. Untuk toko dengan produk
 * campur (misal gantungan kunci 50 g dan karpet 8 kg) itu salah kutip di setiap
 * percakapan: terlalu murah = toko nombok, terlalu mahal = pembeli kabur.
 *
 * Sekarang: cocokkan nama produk terhadap pesan pembeli, jumlahkan berat yang
 * cocok (kali jumlah unit bila disebut), dan bila TIDAK ADA yang cocok pakai
 * `default_weight` yang diatur pemilik toko di dashboard — bukan produk acak.
 */
export function resolveShippingWeight(
  message: string,
  products: ProductLike[] = [],
  defaultWeight?: number
): ShippingWeightBasis {
  const fallback = defaultWeight && defaultWeight > 0 ? defaultWeight : 1000;
  const haystack = normalizeForMatch(message);
  const matched: ShippingWeightBasis["matched"] = [];
  let total = 0;

  for (const p of products) {
    const needle = normalizeForMatch(p?.name || "");
    // Nama sangat pendek ("XL", "A") terlalu mudah cocok dengan kata biasa.
    if (needle.length < 3 || !haystack.includes(needle)) continue;
    const weight = Number(p?.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;

    const units = unitsMentioned(haystack, needle);
    matched.push({ name: p.name, units, weight });
    total += weight * units;
  }

  if (matched.length === 0 || total <= 0) {
    return { weightGram: fallback, matched: [], source: "default" };
  }
  return {
    weightGram: Math.min(total, MAX_SHIPPING_WEIGHT_GRAM),
    matched,
    source: "matched"
  };
}

/** "1.200 gram" → "1,2 kg"; di bawah 1 kg tetap dalam gram. */
function formatWeight(gram: number): string {
  if (gram < 1000) return `${gram} gram`;
  const kg = gram / 1000;
  return `${kg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
}

/**
 * Format pilihan ongkir Mengantar menjadi teks WhatsApp yang rapi.
 *
 * Bila `source === "mock"` tarif BUKAN dari kurir sungguhan (lokasi asal toko
 * belum di-set ke `_id` Mengantar). Jangan menyajikannya sebagai harga pasti —
 * beri label "perkiraan" supaya pembeli tidak salah paham & toko tidak rugi.
 */
/** allEstimatePublic mengembalikan ~16 kurir; menampilkan semuanya = dinding teks. */
const MAX_WHATSAPP_OPTIONS = 5;

function formatOngkirWhatsApp(
  options: ShippingOption[],
  destinationCity: string,
  originCity: string,
  source: RateSource,
  weight: ShippingWeightBasis
): string {
  const isEstimate = source === "mock";

  let text = isEstimate
    ? `📦 *Perkiraan Ongkir ke ${destinationCity}*\n`
    : `📦 *Informasi Tarif Ongkir ke ${destinationCity}*\n`;
  text += `📍 *Pengiriman dari:* ${originCity}\n`;

  // Selalu sebutkan berat yang dipakai. Ongkir tanpa dasar berat mudah jadi
  // sengketa: pembeli merasa dikutip mahal, toko merasa sudah benar.
  if (weight.source === "matched") {
    const detail = weight.matched
      .map((m) => (m.units > 1 ? `${m.units}× ${m.name}` : m.name))
      .join(" + ");
    text += `⚖️ *Berat paket:* ${formatWeight(weight.weightGram)} (${detail})\n\n`;
  } else {
    text += `⚖️ *Berat paket:* ${formatWeight(weight.weightGram)} (perkiraan)\n\n`;
  }

  text += isEstimate
    ? `Berikut *perkiraan* ongkos kirim ya Kak:\n\n`
    : `Berikut adalah daftar pilihan ekspedisi & ongkos kirim:\n\n`;

  // `options` sudah terurut dari termurah, jadi potongannya = pilihan terbaik.
  const shown = options.slice(0, MAX_WHATSAPP_OPTIONS);
  const hidden = options.length - shown.length;

  shown.forEach((opt, idx) => {
    text += `${idx + 1}. *${opt.courier_name}* (${opt.service_name})\n`;
    text += `   💰 Rp ${opt.cost.toLocaleString("id-ID")}\n`;
    text += `   ⏱️ Estimasi: ${opt.etd}\n`;
    if (opt.belowMinimumWeight) {
      text += `   ℹ️ Kena tarif minimum karena berat paket di bawah batas layanan ini\n`;
    }
    text += `\n`;
  });

  if (hidden > 0) {
    text += `_Masih ada ${hidden} pilihan ekspedisi lain. Beri tahu kami kalau Kakak ingin lihat opsi lainnya ya._\n\n`;
  }

  if (isEstimate) {
    text += `_Catatan: angka di atas masih perkiraan. Tarif pastinya kami konfirmasi ulang sebelum pesanan diproses ya Kak._\n\n`;
  }

  if (weight.source === "default") {
    // Pembeli belum menyebut produknya, jadi beratnya masih asumsi toko. Katakan
    // terus terang — lebih murah daripada revisi ongkir setelah pembeli setuju.
    text += `_Ongkir di atas dihitung untuk berat ${formatWeight(weight.weightGram)}. Sebutkan produk & jumlahnya supaya kami hitung ulang lebih tepat ya Kak._\n\n`;
  }

  text += `Silakan beri tahu kami ekspedisi pilihan Kakak atau jika ingin langsung lanjut ke pemesanan ya! 😊`;
  return text;
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
    aiContextMessages = 0
  } = params;

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

    // Berat paket: dari produk yang DISEBUT pembeli, bukan produk pertama di
    // katalog. Tidak ada yang cocok → berat default toko dari dashboard.
    const weightBasis = resolveShippingWeight(rawMessage, products, defaultWeight);

    const { rates, source: rateSource } = await calculateMengantarOngkir({
      originSubdistrictId,
      destinationSubdistrictId: destId,
      weightGram: weightBasis.weightGram,
      apiKey: mengantarApiKey
    });

    // Kalau pencarian lokasi saja sudah jatuh ke mock, tarifnya pasti bukan live.
    const effectiveSource: RateSource = locSource === "mock" ? "mock" : rateSource;
    const formattedOngkir = formatOngkirWhatsApp(
      rates,
      destName,
      originCityName,
      effectiveSource,
      weightBasis
    );

    return {
      replyText: formattedOngkir,
      intent: "ONGKIR_CHECK",
      shippingDetails: rates,
      detectedCity: destName,
      rateSource: effectiveSource,
      shippingWeightGram: weightBasis.weightGram
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

    const aiPrompt = `
System Prompt: ${aiPromptSystem || "Kamu adalah CS AI yang ramah."}
Toko: ${storeName}
Pengiriman dari: ${originCityName}
Katalog Produk:
${productCatalogStr || "Belum ada katalog"}
${
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

Balaslah sebagai Customer Service WhatsApp yang sopan, ramah, dan solutif. Sertakan ajakan untuk mengecek ongkir atau pemesanan produk jika relevan.
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
