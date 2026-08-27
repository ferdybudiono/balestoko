/** Tipe & util bersama untuk panel-panel dashboard. */

export interface Product {
  id?: string;
  name: string;
  price: number;
  weight: number;
  stock?: number;
  description?: string;
  /** URL foto produk — dikirim ke pembeli bersama balasan yang mengutipnya. */
  image_url?: string | null;
  created_at?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  /**
   * `true` = balasan ini ditulis pemilik toko, bukan bot.
   *
   * Tidak ada pada pesan lama (sebelum fitur ambil-alih), jadi ketiadaannya berarti
   * "tidak diketahui" — dan ditampilkan sebagai balasan AI, sebagaimana memang
   * demikian pada seluruh riwayat sebelum fitur ini.
   */
  manual?: boolean;
}

export interface Conversation {
  id?: string;
  customer_phone: string;
  customer_name?: string;
  /** Alamat kirim yang sudah dipancing & direkam bot. */
  customer_address?: string;
  messages: ChatMessage[];
  last_intent?: string;
  destination_city?: string;
  /** AI sengaja dibungkam untuk percakapan ini — sedang ditangani manusia. */
  ai_paused?: boolean | null;
  ai_paused_at?: string | null;
  /**
   * Kapan pemilik toko terakhir membuka/membalas percakapan ini.
   *
   * `null` pada percakapan yang sudah ada pesan = belum pernah dibuka, jadi
   * dihitung belum dibaca. Kolom ini yang membuat penanda "belum dibaca" mungkin
   * tanpa menyimpan status baca per pesan.
   */
  last_seen_at?: string | null;
  updated_at?: string;
  created_at?: string;
}

/** Satu baris barang di pesanan pembeli. */
export interface BuyerOrderItem {
  name: string;
  units: number;
  price: number;
  weight: number;
  line_total: number;
}

/**
 * Pesanan pembeli hasil rekaman bot — isi tab "Pesanan".
 *
 * Bukan `Order` (pembayaran langganan SaaS lewat Midtrans). Dua hal berbeda yang
 * kebetulan sama-sama bernama "order"; menyamakannya berarti mencampur uang
 * langganan dengan pesanan pembeli.
 */
/**
 * Tahap hidup pesanan pembeli.
 *
 * `new → paid → shipped → done`. Empat nilai, bukan dua: pemilik toko yang hanya
 * punya "baru" dan "selesai" tidak bisa membedakan pesanan yang menunggu
 * pembayaran dari yang sudah dibayar tapi belum dikirim — padahal itu dua
 * pekerjaan berbeda dengan urgensi berbeda.
 */
export type BuyerOrderStatus = "new" | "paid" | "shipped" | "done";

export const BUYER_ORDER_STATUS_FLOW: BuyerOrderStatus[] = ["new", "paid", "shipped", "done"];

export const BUYER_ORDER_STATUS_LABELS: Record<BuyerOrderStatus, string> = {
  new: "Baru",
  paid: "Sudah bayar",
  shipped: "Dikirim",
  done: "Selesai"
};

export interface BuyerOrder {
  id?: string;
  customer_phone: string;
  customer_name?: string | null;
  customer_address?: string | null;
  destination_city?: string | null;
  items: BuyerOrderItem[];
  subtotal: number;
  weight_gram: number;
  shipping_courier?: string | null;
  shipping_cost?: number | null;
  note?: string | null;
  status?: BuyerOrderStatus;
  /** URL bukti transfer yang dicatat pemilik toko. */
  payment_proof_url?: string | null;
  paid_at?: string | null;
  /** Nomor resi pengiriman. */
  tracking_number?: string | null;
  shipped_at?: string | null;
  done_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Tahap berikutnya dari sebuah pesanan; `null` bila sudah selesai. */
export function nextOrderStatus(status?: BuyerOrderStatus | null): BuyerOrderStatus | null {
  const idx = BUYER_ORDER_STATUS_FLOW.indexOf(status || "new");
  if (idx < 0 || idx >= BUYER_ORDER_STATUS_FLOW.length - 1) return null;
  return BUYER_ORDER_STATUS_FLOW[idx + 1];
}

/**
 * Label pembeli di daftar chat: "Nama · Kota".
 *
 * Nomor telepon dipakai hanya bila nama belum terekam — nama & kota jauh lebih
 * cepat dikenali pemilik toko saat menelusuri percakapan. `customer_name` dari
 * database punya default 'Pembeli WA', jadi nilai itu ikut dianggap "belum ada".
 */
export function conversationLabel(c: {
  customer_name?: string | null;
  customer_phone: string;
  destination_city?: string | null;
}): string {
  const name = (c.customer_name || "").trim();
  const city = (c.destination_city || "").trim();
  const head = name && name.toLowerCase() !== "pembeli wa" ? name : formatPhoneDisplay(c.customer_phone);
  return city ? `${head} · ${city}` : head;
}

/** Pesan terakhir dalam sebuah percakapan (apa pun perannya). */
export function lastMessageOf(c: Conversation): ChatMessage | null {
  const msgs = Array.isArray(c.messages) ? c.messages : [];
  return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}

/**
 * Ada pesan pembeli yang belum dilihat pemilik toko?
 *
 * Dihitung dari perbandingan waktu, bukan dari status baca per pesan: yang perlu
 * diketahui pemilik toko hanyalah "ada yang baru sejak terakhir saya buka".
 * Percakapan yang `last_seen_at`-nya kosong dianggap BELUM dibaca — pada kolom
 * yang baru ditambahkan itu berarti semua chat lama sekali muncul sebagai belum
 * dibaca, dan itu pilihan yang benar: melewatkan chat pembeli lebih mahal
 * daripada satu kali menandai terlalu banyak.
 */
export function hasUnread(c: Conversation): boolean {
  const last = lastMessageOf(c);
  if (!last || last.role !== "user") return false;
  const lastAt = new Date(last.timestamp || c.updated_at || 0).getTime();
  if (!Number.isFinite(lastAt) || lastAt === 0) return false;
  if (!c.last_seen_at) return true;
  const seenAt = new Date(c.last_seen_at).getTime();
  if (!Number.isFinite(seenAt)) return true;
  return lastAt > seenAt;
}

/**
 * Percakapan yang perlu DILIHAT MANUSIA sekarang.
 *
 * Tiga keadaan, semuanya berarti bot tidak (atau tidak bisa) menyelesaikannya:
 *   • pesan terakhir dari pembeli dan belum dibaca — tidak ada yang menjawab;
 *   • AI dijeda — memang menunggu manusia;
 *   • pesan terakhir gagal dijawab bot (`FALLBACK`).
 */
export function needsAttention(c: Conversation): boolean {
  if (c.ai_paused === true) return true;
  if (c.last_intent === "FALLBACK") return true;
  return hasUnread(c);
}

export interface FonnteStatus {
  status: boolean;
  device?: string;
  reason?: string;
}

/**
 * Satu nomor WhatsApp milik toko. Bentuk ini sengaja TANPA token device —
 * server tidak pernah mengirimkannya ke browser.
 *
 * Kelompok field kedua adalah diagnosa JALUR TERIMA (Fonnte → aplikasi). Ini
 * jalur yang tidak tersentuh oleh tombol uji coba balasan — uji coba hanya
 * memakai jalur KIRIM — jadi tanpa panel ini "bot bisu" tidak bisa dibedakan
 * dari "belum ada pembeli yang chat".
 */
export interface StoreDevice {
  id?: string;
  label: string | null;
  phone: string;
  device_status: string;
  is_primary: boolean;
  has_token: boolean;
  created_at?: string;

  /** `auto read` di Fonnte. WAJIB true, kalau tidak webhook tidak pernah jalan. */
  autoread?: boolean | null;
  /** URL webhook terdaftar, secret sudah disamarkan server. */
  webhook_url?: string | null;
  /** URL di Fonnte sama dengan URL yang berlaku sekarang. */
  webhook_synced?: boolean;
  /** Setelan di atas dibaca langsung dari Fonnte (bukan cuma catatan database). */
  inbound_checked?: boolean;
  /** Setelan baru saja diperbaiki otomatis pada pembacaan ini. */
  inbound_repaired?: boolean;
  /** Kendala jalur terima yang perlu dibaca pemilik toko. */
  inbound_error?: string | null;
  /** Kapan pesan masuk terakhir benar-benar sampai ke aplikasi. */
  last_inbound_at?: string | null;
  /** Apa yang terjadi pada pesan masuk terakhir (dibalas / diabaikan + alasan). */
  last_inbound_note?: string | null;

  /**
   * Id produk yang DIJAWAB nomor ini. `[]` = nomor umum: seluruh katalog.
   *
   * Paket Pro punya 3 nomor, jadi satu nomor bisa dikhususkan untuk sebagian
   * produk — katalog yang masuk ke prompt AI ikut dipersempit.
   */
  product_ids?: string[];
}

/** Jalur terima nomor ini siap? `null` = belum bisa disimpulkan. */
export function isInboundReady(device: StoreDevice): boolean | null {
  if (!device.inbound_checked) return null;
  if (!device.webhook_synced) return false;
  if (device.autoread === false) return false;
  if (device.autoread === null || device.autoread === undefined) return null;
  return true;
}

export function isDeviceConnected(device: StoreDevice): boolean {
  return String(device.device_status || "").toUpperCase() === "CONNECTED";
}

export type TabId = "overview" | "whatsapp" | "store" | "products" | "orders" | "chats";

export type ShowToast = (msg: string, type?: "success" | "error") => void;

/** Label ramah-pengguna untuk `last_intent` yang disimpan bot. */
export const INTENT_LABELS: Record<string, string> = {
  GREETING: "Sapaan",
  ONGKIR_CHECK: "Cek ongkir",
  PRODUCT_INQUIRY: "Tanya produk",
  GENERAL_CHAT: "Obrolan umum",
  ORDER: "Pesanan",
  FALLBACK: "Tidak terjawab"
};

export function intentLabel(intent?: string | null): string {
  if (!intent) return "Lainnya";
  return INTENT_LABELS[intent] || intent;
}

/** "Rp 25.000" — aman terhadap nilai null/NaN dari DB. */
export function formatRupiah(value: unknown): string {
  const n = Number(value);
  return `Rp ${(Number.isFinite(n) ? n : 0).toLocaleString("id-ID")}`;
}

/** "1.2 kg" / "700 g" */
export function formatWeight(gram: unknown): string {
  const n = Number(gram);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1000) return `${Math.round(n)} g`;
  return `${(n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
}

/** Angka ringkas untuk stat tile: 1.284 → "1.284", 12900 → "12,9 rb". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 10000) return value.toLocaleString("id-ID");
  if (value < 1_000_000) return `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} rb`;
  return `${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
}

/** "baru saja" / "5 mnt lalu" / "3 jam lalu" / "2 hari lalu" */
export function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "baru saja";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} mnt lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** "14:32" untuk stempel waktu di bubble chat. */
export function clockTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/** "16 Agu" — pemisah tanggal di dalam thread chat. */
export function dayLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Hari ini";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

/** Normalisasi nomor WA ke tampilan +62 812-3456-7890 (best effort). */
export function formatPhoneDisplay(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 8) return phone;
  const national = digits.startsWith("62") ? digits.slice(2) : digits.replace(/^0/, "");
  const groups = national.match(/^(\d{3})(\d{3,4})(\d{0,5})$/);
  if (!groups) return `+62 ${national}`;
  return `+62 ${groups[1]}-${groups[2]}${groups[3] ? `-${groups[3]}` : ""}`;
}
