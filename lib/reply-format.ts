/**
 * Penyusun teks balasan WhatsApp.
 *
 * Modul ini MURNI — tanpa `process.env`, tanpa `fetch`, tanpa akses database —
 * supaya dashboard bisa mengimpornya langsung dan menampilkan PRATINJAU memakai
 * fungsi yang sama persis dengan yang dipakai bot. Itu alasan utama pemisahan
 * ini dari `lib/ai.ts`: pratinjau yang dibangun ulang secara terpisah pasti
 * menyimpang cepat atau lambat, dan pemilik toko akan mengatur sesuatu yang
 * berbeda dari yang benar-benar diterima pembelinya.
 */

import { LocalCourierConfig } from "./couriers";

// ─────────────────────────────────────────────────────────────────────────────
//  Bentuk data
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderDraftLine {
  name: string;
  units: number;
  /** Berat satuan (gram); `0` bila data produk tidak valid. */
  weight: number;
  /** Harga satuan; `0` bila tidak valid. */
  price: number;
  lineTotal: number;
}

export interface OrderDraft {
  lines: OrderDraftLine[];
  subtotal: number;
  weightGram: number;
  /** `matched` = berat dari produk yang disebut pembeli; `default` = asumsi toko. */
  weightSource: "matched" | "default";
  /**
   * Nama produk yang mungkin dimaksud pembeli tapi tidak bisa dipastikan
   * (mis. menyebut "kaos" di toko yang punya "Kaos Polos" dan "Kaos Raglan").
   * Isi array ini berarti balasan harus MENANYAKAN, bukan menebak.
   */
  ambiguous: string[];
}

export interface QuoteOption {
  courier_name: string;
  service_name: string;
  etd: string;
  cost: number;
  belowMinimumWeight?: boolean;
  /** Opsi kurir toko sendiri — tarifnya diatur pemilik toko, bukan dari Mengantar. */
  local?: boolean;
  /** Tarif belum pasti; dicetak "menyesuaikan jarak", tidak pernah sebagai Rp 0. */
  askForRate?: boolean;
}

export const PAYMENT_ACCOUNT_TYPES = ["bank", "ewallet"] as const;
export type PaymentAccountType = (typeof PAYMENT_ACCOUNT_TYPES)[number];

export interface PaymentAccount {
  type: PaymentAccountType;
  /** Nama bank atau e-wallet: "BCA", "GoPay". */
  name: string;
  /** Nomor rekening atau nomor HP e-wallet. */
  number: string;
  /** Nama pemilik rekening. */
  holder: string;
}

export const MAX_PAYMENT_ACCOUNTS = 3;

export interface PaymentSettings {
  accounts: PaymentAccount[];
  codEnabled: boolean;
  note?: string | null;
}

export const AI_TONES = ["ramah", "santai", "formal", "singkat"] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_TONE_LABELS: Record<AiTone, string> = {
  ramah: "Ramah & hangat",
  santai: "Santai / akrab",
  formal: "Formal & profesional",
  singkat: "Singkat & padat"
};

export const AI_TONE_HINTS: Record<AiTone, string> = {
  ramah: "Sapaan hangat, pakai “Kak”, sedikit emoji.",
  santai: "Bahasa sehari-hari yang akrab, seperti chat teman.",
  formal: "Bahasa Indonesia baku, tanpa emoji, panggil “Bapak/Ibu”.",
  singkat: "Jawab langsung ke inti, satu–dua kalimat, tanpa basa-basi."
};

/** Kalimat instruksi nada bicara yang disisipkan ke prompt model. */
export const AI_TONE_INSTRUCTIONS: Record<AiTone, string> = {
  ramah:
    "Gunakan nada ramah dan hangat. Panggil pembeli dengan \"Kak\". Emoji secukupnya, jangan berlebihan.",
  santai:
    "Gunakan bahasa sehari-hari yang akrab dan santai seperti mengobrol dengan teman, tetap sopan.",
  formal:
    "Gunakan Bahasa Indonesia baku dan profesional. Panggil pembeli dengan \"Bapak/Ibu\". Jangan memakai emoji.",
  singkat:
    "Jawab sesingkat mungkin dan langsung ke inti — maksimal dua kalimat. Tanpa basa-basi dan tanpa emoji."
};

export function normalizeAiTone(raw: unknown): AiTone {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (AI_TONES as readonly string[]).includes(v) ? (v as AiTone) : "ramah";
}

/** Bersihkan daftar rekening dari database atau dari body request. */
export function normalizePaymentAccounts(raw: unknown): PaymentAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentAccount[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim().slice(0, 40) : "";
    const number = typeof v.number === "string" ? v.number.trim().slice(0, 40) : "";
    // Rekening tanpa nama bank atau tanpa nomor tidak bisa dipakai membayar,
    // jadi lebih baik dijatuhkan daripada dikirim ke pembeli setengah jadi.
    if (!name || !number) continue;
    const type = v.type === "ewallet" ? "ewallet" : "bank";
    out.push({
      type,
      name,
      number,
      holder: typeof v.holder === "string" ? v.holder.trim().slice(0, 60) : ""
    });
    if (out.length >= MAX_PAYMENT_ACCOUNTS) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helper format
// ─────────────────────────────────────────────────────────────────────────────

/** allEstimatePublic mengembalikan ~16 kurir; menampilkan semuanya = dinding teks. */
export const MAX_WHATSAPP_OPTIONS = 5;

const SEPARATOR = "──────────────────────────";
/** Lebar kolom label sebelum angka rupiah pada baris rincian. */
const LEADER_WIDTH = 22;

function rp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** "1.200 gram" → "1,2 kg"; di bawah 1 kg tetap dalam gram. */
export function formatWeight(gram: number): string {
  if (gram < 1000) return `${gram} gram`;
  const kg = gram / 1000;
  return `${kg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
}

/** "2× Kaos Polos" → "2× Kaos Polos ........" agar angka rupiah sejajar. */
function leader(label: string): string {
  const max = LEADER_WIDTH - 2;
  const clipped = label.length > max ? `${label.slice(0, max - 1)}…` : label;
  return `${clipped} ${".".repeat(Math.max(2, LEADER_WIDTH - clipped.length - 1))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Blok teks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rincian produk + subtotal + berat.
 *
 * Hanya dipanggil bila ada produk yang benar-benar cocok. Tanpa itu, angka
 * subtotal tidak punya dasar dan menampilkannya berarti mengarang.
 */
export function formatOrderSummary(draft: OrderDraft): string {
  const rows = draft.lines.map((l) => {
    const label = l.units > 1 ? `${l.units}× ${l.name}` : l.name;
    // Produk tanpa harga valid tetap ditampilkan (pembeli menyebutnya, jadi
    // menghilangkannya membingungkan) tapi angkanya tidak dikarang.
    const amount = l.lineTotal > 0 ? rp(l.lineTotal) : "harga menyusul";
    return `${leader(label)} ${amount}`;
  });

  let text = `🛍️ *Ringkasan pesanan*\n${rows.join("\n")}\n${SEPARATOR}\n`;
  text += `${leader("Subtotal produk")} ${rp(draft.subtotal)}\n`;
  text += `⚖️ Berat paket: ${formatWeight(draft.weightGram)}`;
  if (draft.weightSource === "default") text += ` (perkiraan)`;
  return text;
}

/**
 * Gabungkan tarif Mengantar dengan opsi kurir toko, lalu potong ke jumlah yang
 * layak dibaca di WhatsApp.
 *
 * Kurir toko yang tarifnya belum pasti selalu diletakkan PALING AKHIR dan tidak
 * ikut diurutkan berdasarkan biaya: `cost` 0 yang diurutkan menurut harga akan
 * muncul di urutan teratas dan terbaca sebagai gratis ongkir.
 */
export function mergeQuoteOptions(
  rates: QuoteOption[],
  local?: LocalCourierConfig | null,
  maxOptions: number = MAX_WHATSAPP_OPTIONS
): { shown: QuoteOption[]; hidden: number } {
  const priced = [...rates];
  let tail: QuoteOption | null = null;

  if (local?.enabled && local.label) {
    const opt: QuoteOption = {
      courier_name: local.label,
      service_name: "Kurir toko",
      etd: local.etd || "",
      cost: local.cost > 0 ? local.cost : 0,
      local: true,
      askForRate: local.cost <= 0
    };
    if (opt.askForRate) tail = opt;
    else priced.push(opt);
  }

  priced.sort((a, b) => a.cost - b.cost);

  const budget = tail ? Math.max(1, maxOptions - 1) : maxOptions;
  const shown = priced.slice(0, budget);
  const hidden = priced.length - shown.length;
  if (tail) shown.push(tail);

  return { shown, hidden };
}

/**
 * Daftar ekspedisi beserta total bayar per opsi.
 *
 * `subtotal` 0 (tidak ada produk yang cocok) → hanya ongkir yang dicetak, tanpa
 * total. `estimate` true (tarif simulasi) → judulnya "Perkiraan total", bukan
 * "Total bayar": angka lunak tidak boleh berubah menjadi angka pasti hanya
 * karena sekarang sudah dijumlahkan.
 */
export function formatOngkirOptions(
  options: QuoteOption[],
  subtotal: number,
  estimate: boolean
): string {
  const totalLabel = estimate ? "Perkiraan total" : "Total bayar";

  return options
    .map((opt, idx) => {
      let block = `${idx + 1}. *${opt.courier_name}* (${opt.service_name})\n`;

      if (opt.askForRate) {
        // Jangan pernah mencetak "Rp 0" di sini.
        block += `   Ongkir menyesuaikan jarak — kami infokan setelah tahu alamatnya\n`;
        return block;
      }

      block += `   Ongkir ${rp(opt.cost)}`;
      if (opt.etd) block += ` · ${opt.etd}`;
      block += `\n`;

      if (subtotal > 0) {
        block += `   💳 *${totalLabel}: ${rp(subtotal + opt.cost)}*\n`;
      }
      if (opt.belowMinimumWeight) {
        block += `   ℹ️ Kena tarif minimum karena berat paket di bawah batas layanan ini\n`;
      }
      return block;
    })
    .join("\n");
}

/** Instruksi pembayaran: ke mana transfer, atau COD. */
export function formatPaymentInstructions(payment: PaymentSettings): string {
  const accounts = normalizePaymentAccounts(payment.accounts);
  const note = (payment.note || "").trim();
  if (accounts.length === 0 && !payment.codEnabled && !note) return "";

  let text = `💳 *Cara pembayaran*\n`;

  for (const a of accounts) {
    const kind = a.type === "ewallet" ? "" : "Transfer ";
    const holder = a.holder ? ` (a.n. ${a.holder})` : "";
    text += `• ${kind}*${a.name}* ${a.number}${holder}\n`;
  }

  if (payment.codEnabled) {
    text += `• *COD* — bayar di tempat saat barang diterima\n`;
  }

  if (accounts.length > 0) {
    text += `\nSetelah transfer, kirim bukti pembayarannya ke chat ini ya 🙏\n`;
  }

  if (note) text += `\n_${note}_\n`;

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Perekat
// ─────────────────────────────────────────────────────────────────────────────

export interface OngkirReplyParams {
  draft: OrderDraft;
  /** Tarif dari Mengantar (sudah tersaring ekspedisi aktif). */
  rates: QuoteOption[];
  localCourier?: LocalCourierConfig | null;
  destinationName: string;
  originCityName: string;
  /** `mock` = tarif simulasi, bukan tarif kurir sungguhan. */
  source: "live" | "mock";
  payment?: PaymentSettings;
  /** Sertakan penjumlahan produk + ongkir (pengaturan toko). */
  includeTotal?: boolean;
  /** Sertakan blok instruksi pembayaran (pengaturan toko). */
  includePayment?: boolean;
  /** Pemilik toko membatasi ekspedisi — mempengaruhi bunyi pesan "kosong". */
  courierFilterActive?: boolean;
  maxOptions?: number;
}

/**
 * Susun satu balasan utuh: rincian pesanan → ongkir + total per ekspedisi →
 * cara bayar. Inilah fungsi yang dipakai bot DAN pratinjau dashboard.
 */
export function buildOngkirReply(params: OngkirReplyParams): string {
  const {
    draft,
    rates,
    localCourier,
    destinationName,
    originCityName,
    source,
    payment,
    includeTotal = true,
    includePayment = true,
    courierFilterActive = false,
    maxOptions = MAX_WHATSAPP_OPTIONS
  } = params;

  const estimate = source === "mock";
  const hasLines = draft.lines.length > 0;
  // Total hanya boleh muncul kalau ada dasar produknya. Tanpa itu angka total
  // sama dengan ongkir dan cuma membingungkan.
  const subtotalForTotals = includeTotal && hasLines ? draft.subtotal : 0;

  const blocks: string[] = [];

  if (hasLines) blocks.push(formatOrderSummary(draft));

  let header = estimate
    ? `🚚 *Perkiraan ongkir ke ${destinationName}*`
    : `🚚 *Ongkir ke ${destinationName}*`;
  if (originCityName) header += `\n📍 Dari ${originCityName}`;
  if (!hasLines) {
    header += `\n⚖️ Berat paket: ${formatWeight(draft.weightGram)} (perkiraan)`;
  }
  blocks.push(header);

  // Pertanyaan varian didahulukan: kalau pembeli menyebut "kaos" di toko yang
  // punya beberapa varian kaos, menebak salah satunya berarti mengutip harga
  // dan berat produk yang bukan dia maksud.
  if (draft.ambiguous.length > 0) {
    const list = draft.ambiguous.map((n) => `*${n}*`).join(", ");
    blocks.push(
      `❓ Ada beberapa produk yang cocok dengan yang Kakak sebut: ${list}.\nMaksudnya yang mana ya Kak?`
    );
  }

  const { shown, hidden } = mergeQuoteOptions(rates, localCourier, maxOptions);

  if (shown.length === 0) {
    // Sengaja TIDAK jatuh kembali ke semua kurir. Lihat catatan pada
    // `filterRatesByActiveCouriers` di lib/couriers.ts.
    blocks.push(
      courierFilterActive
        ? `Maaf Kak, ekspedisi yang kami layani belum menjangkau ${destinationName}. Boleh sebutkan alamat lain, atau kami carikan alternatif pengiriman ya?`
        : `Maaf Kak, untuk saat ini kami belum menemukan layanan kurir ke ${destinationName}. Boleh sebutkan kecamatan tujuannya lebih spesifik?`
    );
    return blocks.join("\n\n").trim();
  }

  blocks.push(formatOngkirOptions(shown, subtotalForTotals, estimate).trimEnd());

  const notes: string[] = [];
  if (hidden > 0) {
    notes.push(
      `_Masih ada ${hidden} pilihan ekspedisi lain — bilang saja kalau Kakak mau lihat opsi lainnya._`
    );
  }
  if (estimate) {
    notes.push(
      `_Angka di atas masih perkiraan. Tarif pastinya kami konfirmasi ulang sebelum pesanan diproses ya Kak._`
    );
  }
  if (draft.weightSource === "default") {
    notes.push(
      `_Ongkir dihitung untuk berat ${formatWeight(
        draft.weightGram
      )}. Sebutkan produk & jumlahnya supaya kami hitung ulang lebih tepat ya Kak._`
    );
  }
  if (notes.length > 0) blocks.push(notes.join("\n"));

  if (includePayment && payment) {
    const paymentBlock = formatPaymentInstructions(payment).trimEnd();
    if (paymentBlock) blocks.push(paymentBlock);
  }

  blocks.push(`Pilih ekspedisinya ya Kak 😊`);

  return blocks.join("\n\n").trim();
}
