/**
 * Pembaca data pembeli dari teks chat: NAMA, ALAMAT, dan niat MEMESAN.
 *
 * Modul ini MURNI (tanpa `process.env`, `fetch`, atau database) dengan alasan
 * yang sama seperti `lib/reply-format.ts`: hasilnya dipakai bot maupun dashboard,
 * dan aturan yang disalin-tempel pasti menyimpang.
 *
 * KENAPA DETERMINISTIK, BUKAN DISERAHKAN KE MODEL: nama & alamat yang direkam di
 * sini masuk ke daftar pesanan dan dipakai mengirim barang. Model yang "kira-kira"
 * membaca "saya mau beli kaos" sebagai nama "mau beli kaos" akan mengotori daftar
 * pesanan toko dan tidak bisa dibedakan dari data sungguhan. Jadi: pola yang jelas
 * saja yang diterima, sisanya dibiarkan kosong dan DIPANCING lagi lewat pertanyaan.
 */

export const MAX_NAME_LENGTH = 60;
export const MAX_ADDRESS_LENGTH = 400;

/** Slot identitas pembeli yang dipakai menyusun pesanan. */
export interface CustomerSlots {
  name: string | null;
  address: string | null;
}

/**
 * Kata yang tidak mungkin menjadi nama orang. Tanpa daftar ini, pola "saya X"
 * akan merekam "mau", "cuma tanya", atau "dari Bandung" sebagai nama pembeli.
 */
const NON_NAME_WORDS = new Set([
  "mau", "mo", "ingin", "pengen", "pesan", "order", "beli", "ambil", "tanya",
  "nanya", "cek", "cari", "minta", "butuh", "perlu", "lihat", "liat", "kirim",
  "ongkir", "harga", "produk", "barang", "stok", "ada", "tidak", "gak", "ga",
  "belum", "sudah", "udah", "iya", "ya", "oke", "ok", "sip", "halo", "hai",
  "dari", "di", "ke", "untuk", "dan", "atau", "saja", "aja", "dong", "kak",
  "min", "bang", "bu", "pak", "mbak", "mas", "sis", "gan", "tolong", "boleh",
  "berapa", "bisa", "juga", "ini", "itu", "yang", "alamat", "nama", "nomor",
  "hp", "wa", "bayar", "transfer", "cod", "kota", "kecamatan", "kelurahan",
  "jalan", "jl", "rumah", "kantor", "test", "tes"
]);

/**
 * Penanda bahwa sepotong teks memang alamat, bukan sekadar nama kota.
 *
 * Dipakai dua arah: menerima teks panjang sebagai alamat, dan MENOLAK "kirim ke
 * Bandung" (itu tujuan ongkir, bukan alamat kirim yang bisa dipakai kurir).
 */
const ADDRESS_MARKERS = [
  "jl ", "jl.", "jln", "jalan", "gang ", "gg ", "gg.", "blok", "perum", "komplek",
  "kompleks", "rt ", "rt.", "rw ", "rw.", "no ", "no.", "nomor ", "kel ", "kel.",
  "kelurahan", "kec ", "kec.", "kecamatan", "desa", "dusun", "kabupaten", "kab ",
  "kab.", "kode pos", "kodepos", "rumah", "apartemen", "apt ", "lantai", "gedung"
];

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasAddressMarker(text: string): boolean {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  if (ADDRESS_MARKERS.some((m) => lower.includes(m))) return true;
  // Kode pos 5 digit yang berdiri sendiri juga penanda kuat.
  return /(?:^|\s)\d{5}(?:$|\s)/.test(lower);
}

/**
 * Apakah potongan teks ini layak disimpan sebagai nama orang?
 *
 * Sengaja ketat: 1–4 kata, huruf saja, dan tidak ada kata kerja/kata sapaan.
 * Nama yang tertolak bukan kerugian besar — bot akan menanyakannya lagi.
 */
export function looksLikePersonName(raw: string): boolean {
  const value = collapse(raw);
  if (value.length < 2 || value.length > MAX_NAME_LENGTH) return false;
  // Nama tidak memuat angka, tanda baca aneh, atau emoji.
  if (!/^[a-zA-ZÀ-ɏ' .-]+$/.test(value)) return false;

  const words = value.toLowerCase().split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.some((w) => NON_NAME_WORDS.has(w.replace(/[.'-]/g, "")))) return false;
  // Satu huruf ("p", "a") adalah ping WhatsApp, bukan nama.
  if (words.every((w) => w.length < 2)) return false;
  return true;
}

/** Rapikan nama agar konsisten di dashboard: "budi santoso" → "Budi Santoso". */
export function titleCaseName(raw: string): string {
  return collapse(raw)
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, MAX_NAME_LENGTH);
}

const NAME_PATTERNS: RegExp[] = [
  /(?:^|\s)nama(?:\s+(?:saya|aku|ku|nya|lengkap(?:nya)?|penerima(?:nya)?))?\s*(?:adalah|yaitu)?\s*[:=-]?\s*([^\n,.;]{2,60})/i,
  /atas\s+nama\s*[:=-]?\s*([^\n,.;]{2,60})/i,
  /(?:^|\s)a[\/.]?n\.?\s*[:=-]?\s*([^\n,.;]{2,60})/i,
  /(?:saya|aku)\s+(?:bernama|namanya)\s*[:=-]?\s*([^\n,.;]{2,60})/i,
  /(?:panggil\s+(?:saya|aku))\s+([^\n,.;]{2,60})/i
];

/**
 * Nama pembeli dari satu pesan, atau `null` bila tidak yakin.
 *
 * `expecting: "name"` = pesan sebelumnya bot memang menanyakan nama, jadi balasan
 * pendek seperti "Budi Santoso" boleh diterima apa adanya. Tanpa itu, jawaban
 * pendek terlalu berbahaya untuk ditebak (bisa jadi nama produk atau kota).
 */
export function extractCustomerName(message: string, expecting?: SlotAsk): string | null {
  const text = collapse(message);
  if (!text) return null;

  for (const pat of NAME_PATTERNS) {
    const hit = pat.exec(text);
    const candidate = hit?.[1];
    if (candidate && looksLikePersonName(candidate)) return titleCaseName(candidate);
  }

  // "saya Budi" hanya diterima bila itu ISI SELURUH pesan — di tengah kalimat
  // pola ini hampir selalu bagian dari "saya mau ..." atau "saya di ...".
  const solo = /^(?:saya|aku|ini)\s+([a-zA-ZÀ-ɏ' .-]{2,60})$/i.exec(text);
  if (solo?.[1] && looksLikePersonName(solo[1])) return titleCaseName(solo[1]);

  if (expecting === "name" && looksLikePersonName(text)) return titleCaseName(text);

  return null;
}

/**
 * Alamat kirim dari satu pesan, atau `null`.
 *
 * Nama kota saja TIDAK dihitung alamat: itu sudah punya tempat sendiri
 * (`destination_city` untuk ongkir), dan kurir tidak bisa mengantar ke "Bandung".
 */
export function extractCustomerAddress(message: string, expecting?: SlotAsk): string | null {
  const text = collapse(message);
  if (text.length < 5) return null;

  const labeled =
    /alamat(?:\s+(?:saya|aku|ku|nya|lengkap(?:nya)?|kirim(?:nya)?|pengiriman(?:nya)?|penerima))?\s*[:=-]?\s*([\s\S]{5,400})/i.exec(
      text
    ) || /(?:kirim|dikirim|antar)\s+ke\s*[:=-]?\s*([\s\S]{8,400})/i.exec(text);

  const candidate = labeled?.[1] ? collapse(labeled[1]) : "";
  if (candidate && hasAddressMarker(candidate)) return candidate.slice(0, MAX_ADDRESS_LENGTH);

  // Tanpa label pun, teks yang memuat penanda alamat (jalan/RT/kode pos) memang
  // alamat — pembeli sering langsung mengirimkannya begitu saja.
  if (hasAddressMarker(text) && text.length >= 12) return text.slice(0, MAX_ADDRESS_LENGTH);

  // Bot baru saja meminta alamat: teks yang cukup panjang dan memuat angka
  // (nomor rumah / kode pos) diterima meski tanpa kata "jalan".
  if (expecting === "address" && text.length >= 12 && /\d/.test(text)) {
    return text.slice(0, MAX_ADDRESS_LENGTH);
  }

  return null;
}

/** Slot mana yang sedang ditunggu bot. */
export type SlotAsk = "name" | "address" | null;

/**
 * Baca balasan bot TERAKHIR untuk tahu apa yang sedang ditunggu.
 *
 * Dipakai supaya jawaban singkat pembeli ("Budi", "Jl. Merdeka 10 …") bisa
 * dipetakan ke slot yang benar. Bertumpu pada kata dalam balasan — bukan pada
 * state tersembunyi — supaya tetap bekerja walau balasannya ditulis ulang AI
 * dengan gaya toko.
 */
export function detectSlotAsk(lastAssistantMessage?: string | null): SlotAsk {
  const text = (lastAssistantMessage || "").toLowerCase();
  if (!text) return null;
  const asksName = /\bnama\b/.test(text);
  const asksAddress = /\balamat\b/.test(text);
  if (asksAddress && !asksName) return "address";
  if (asksName && !asksAddress) return "name";
  // Keduanya diminta sekaligus: nama lebih mudah dikenali dari pola, jadi
  // biarkan pembaca alamat bekerja lewat penanda alamatnya sendiri.
  if (asksName && asksAddress) return "name";
  return null;
}

/**
 * Kata yang menandakan pembeli benar-benar MEMESAN, bukan sedang bertanya.
 *
 * Ini yang membedakan "berapa harga kaos?" (pertanyaan) dari "oke pesan 2 kaos"
 * (pesanan yang layak masuk daftar pesanan toko).
 */
const ORDER_COMMIT_PATTERNS: RegExp[] = [
  /\b(?:pesan|order|orderan|oder|odr)\b/i,
  /\b(?:mau|mo|ingin|pengen|minta)\s+(?:beli|ambil|order|pesan)\b/i,
  /\b(?:beli|ambil)\s+\d+/i,
  /\bcheck\s?out\b|\bcheckout\b/i,
  /\b(?:jadi|fix|deal|gas|sikat|lanjut)\b.*\b(?:pesan|order|beli|ambil|bayar)\b/i,
  /\b(?:sudah|udah|uda|sdh)\s+(?:transfer|tf|bayar)\b/i,
  /\b(?:saya|aku)\s+(?:beli|ambil)\b/i
];

/** Apakah pesan ini niat memesan? */
export function isOrderCommit(message: string): boolean {
  const text = collapse(message).toLowerCase();
  if (!text) return false;
  return ORDER_COMMIT_PATTERNS.some((p) => p.test(text));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tujuan pengiriman dari alamat
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kata yang sering menempel di potongan alamat tapi bukan bagian nama tempat.
 * Tanpa ini, "Kec. Coblong Kota Bandung 40132" menghasilkan kandidat yang tidak
 * pernah ditemukan pencarian lokasi kurir.
 */
const PLACE_NOISE = [
  "kec", "kecamatan", "kel", "kelurahan", "desa", "kota", "kab", "kabupaten",
  "provinsi", "prov", "kode", "pos", "kodepos", "no", "nomor", "rt", "rw",
  "blok", "jl", "jln", "jalan", "gang", "gg", "rumah", "dekat", "depan"
];

/**
 * Rapikan satu kandidat nama tempat: buang angka, tanda baca, dan kata penanda,
 * lalu batasi 2 kata. Pencarian lokasi kurir mencocokkan nama kecamatan/kota —
 * "coblong bandung jawa barat" justru tidak ketemu, sedangkan "coblong" ketemu.
 */
function cleanPlace(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PLACE_NOISE.includes(w));
  if (words.length === 0) return "";
  return words.slice(0, 2).join(" ").slice(0, 40);
}

/**
 * Tebak kata kunci tujuan pengiriman dari alamat lengkap yang sudah tercatat.
 *
 * DIPAKAI UNTUK APA: ketika pembeli menyatakan memesan tanpa menyebut kota lagi
 * ("oke pesan 2 kaos") padahal alamatnya sudah dikirim di chat sebelumnya,
 * ongkirnya seharusnya bisa langsung dihitung dari alamat itu — bukan malah
 * bertanya ulang "kirim ke mana?" pada orang yang sudah menjawabnya.
 *
 * Urutan aturan mengikuti apa yang paling berguna bagi kurir: kecamatan dulu
 * (tarif dihitung per kecamatan), lalu kota/kabupaten, terakhir potongan koma
 * yang murni huruf. Hasilnya sengaja hanya KATA KUNCI PENCARIAN — benar atau
 * tidaknya ditentukan oleh pencarian lokasi kurir, bukan oleh fungsi ini.
 */
export function extractShippingCityQuery(address?: string | null): string {
  const text = collapse(address || "");
  if (!text) return "";

  // 1. Kecamatan — satuan tarif yang paling tepat.
  const kec = /\bkec(?:amatan)?\.?\s+([a-zA-Z\s]{3,30})/.exec(text);
  if (kec) {
    const place = cleanPlace(kec[1]);
    if (place) return place;
  }

  // 2. Kota / kabupaten.
  const city = /\b(?:kota|kab(?:upaten)?)\.?\s+([a-zA-Z\s]{3,30})/.exec(text);
  if (city) {
    const place = cleanPlace(city[1]);
    if (place) return place;
  }

  // 3. Potongan koma terakhir yang murni huruf — pola alamat "…, Coblong,
  //    Bandung, 40132" sangat umum, dan bagian belakangnya justru yang berisi
  //    nama wilayah. Kode pos dan nomor rumah otomatis tersaring.
  const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!/^[a-zA-Z\s.]+$/.test(segments[i])) continue;
    const place = cleanPlace(segments[i]);
    if (place) return place;
  }

  return "";
}

/**
 * Pertanyaan pemancing untuk slot yang belum terisi.
 *
 * Dikembalikan sebagai TEKS BIASA tanpa angka apa pun, jadi aman digabungkan ke
 * balasan deterministik maupun diserahkan ke model untuk ditulis ulang: pagar
 * angka di `lib/ai.ts` tidak pernah melihat kandidat angka baru dari sini.
 */
export function buildIdentityAsk(missing: { name: boolean; address: boolean }): string {
  if (missing.name && missing.address) {
    return (
      "Biar pesanannya kami catat dan siap dikirim, boleh minta *nama* dan " +
      "*alamat lengkap* (jalan, nomor, kelurahan, kecamatan, kota, kode pos) ya Kak? 🙏"
    );
  }
  if (missing.name) {
    return "Kalau boleh tahu, pesanan ini atas *nama* siapa ya Kak? Biar kami catat 🙏";
  }
  if (missing.address) {
    return (
      "Boleh kirim *alamat lengkapnya* (jalan, nomor, kelurahan, kecamatan, kota, " +
      "kode pos) ya Kak, biar paketnya kami siapkan 🙏"
    );
  }
  return "";
}

/** Pengakuan singkat bahwa data pembeli sudah tercatat. */
export function buildSlotAck(captured: { name?: string | null; address?: string | null }): string {
  const name = (captured.name || "").trim();
  const address = (captured.address || "").trim();
  if (name && address) return `Siap Kak ${name}, nama dan alamatnya sudah kami catat ✅`;
  if (name) return `Siap Kak ${name}, namanya sudah kami catat ✅`;
  if (address) return "Siap Kak, alamatnya sudah kami catat ✅";
  return "";
}
