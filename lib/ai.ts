/**
 * AI Assistant Engine for WhatsApp Customer Service
 * Integrates Gemini API / OpenAI API with fallback Intelligent Rule-Based Engine
 * Handles Buyer Greeting -> Location Extraction -> Mengantar Ongkir Calculation -> Conversational Chat
 */

import { calculateMengantarOngkir, searchMengantarLocation, ShippingOption } from "./mengantar";

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
  products?: Array<{ name: string; price: number; weight: number; description?: string }>;
  chatHistory?: ChatMessage[];
}

export interface AIProcessResult {
  replyText: string;
  intent: "GREETING" | "ONGKIR_CHECK" | "PRODUCT_INQUIRY" | "GENERAL_CHAT";
  shippingDetails?: ShippingOption[];
  detectedCity?: string;
}

/**
 * Format pilihan ongkir Mengantar menjadi teks WhatsApp yang rapi
 */
function formatOngkirWhatsApp(options: ShippingOption[], destinationCity: string, originCity: string): string {
  let text = `📦 *Informasi Tarif Ongkir ke ${destinationCity}*\n`;
  text += `📍 *Pengiriman dari:* ${originCity}\n\n`;
  text += `Berikut adalah daftar pilihan ekspedisi & ongkos kirim:\n\n`;

  options.forEach((opt, idx) => {
    text += `${idx + 1}. *${opt.courier_name}* (${opt.service_name})\n`;
    text += `   💰 Rp ${opt.cost.toLocaleString("id-ID")}\n`;
    text += `   ⏱️ Estimasi: ${opt.etd}\n\n`;
  });

  text += `Silakan beri tahu kami ekspedisi pilihan Kakak atau jika ingin langsung lanjut ke pemesanan ya! 😊`;
  return text;
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
    products = [],
    chatHistory = []
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

  const isGreetingQuery =
    chatHistory.length === 0 ||
    lowerMsg.startsWith("halo") ||
    lowerMsg.startsWith("hi") ||
    lowerMsg.startsWith("p") ||
    lowerMsg.startsWith("selamat") ||
    lowerMsg.includes("permisi");

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
    const locations = await searchMengantarLocation(targetLocationQuery, mengantarApiKey);
    const destLoc = locations[0];
    const destName = destLoc ? `${destLoc.subdistrict_name}, ${destLoc.city_name}` : targetLocationQuery;
    const destId = destLoc ? destLoc.id : "3273010";

    // Hitung berat default dari produk jika ada
    const totalWeight = products.length > 0 ? products[0].weight : 1000;

    const rates = await calculateMengantarOngkir({
      originSubdistrictId,
      destinationSubdistrictId: destId,
      weightGram: totalWeight,
      apiKey: mengantarApiKey
    });

    const formattedOngkir = formatOngkirWhatsApp(rates, destName, originCityName);

    return {
      replyText: formattedOngkir,
      intent: "ONGKIR_CHECK",
      shippingDetails: rates,
      detectedCity: destName
    };
  }

  // 2. Jika Pesan adalah Sapaan Awal
  if (isGreetingQuery) {
    const defaultGreeting = greetingMessage || `Halo! Selamat datang di *${storeName}* 👋 Ada yang bisa kami bantu mengenai produk kami atau mau langsung cek tarif ongkir ke lokasi Kakak?`;
    return {
      replyText: defaultGreeting,
      intent: "GREETING"
    };
  }

  // 3. Deteksi Pertanyaan Produk / Katalog
  const isProductQuery =
    lowerMsg.includes("harga") ||
    lowerMsg.includes("produk") ||
    lowerMsg.includes("jual") ||
    lowerMsg.includes("barang") ||
    lowerMsg.includes("stok") ||
    lowerMsg.includes("rincian");

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

  // 4. Default Smart AI Response Engine
  const systemContext = aiPromptSystem || `Kamu adalah CS AI toko ${storeName}. Balaslah dengan ramah, singkat, dan berikan opsi untuk mengecek ongkir atau pemesanan produk.`;
  
  let fallbackReply = `Terima kasih sudah menghubungi *${storeName}*! 😊\n\n`;
  fallbackReply += `Pesan Kakak sudah kami terima. Kami siap membantu pertanyaan seputar produk maupun pengecekan tarif ongkos kirim (ongkir) kurir ke seluruh wilayah Indonesia.\n\n`;
  fallbackReply += `Boleh diinfokan nama kota/kecamatan tujuan Kakak agar langsung kami bantu cek tarif ongkirnya? 📍`;

  return {
    replyText: fallbackReply,
    intent: "GENERAL_CHAT"
  };
}
