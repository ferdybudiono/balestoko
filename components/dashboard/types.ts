/** Tipe & util bersama untuk panel-panel dashboard. */

export interface Product {
  id?: string;
  name: string;
  price: number;
  weight: number;
  stock?: number;
  description?: string;
  created_at?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface Conversation {
  id?: string;
  customer_phone: string;
  customer_name?: string;
  messages: ChatMessage[];
  last_intent?: string;
  destination_city?: string;
  updated_at?: string;
  created_at?: string;
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

export type TabId = "overview" | "whatsapp" | "store" | "products" | "chats";

export type ShowToast = (msg: string, type?: "success" | "error") => void;

/** Label ramah-pengguna untuk `last_intent` yang disimpan bot. */
export const INTENT_LABELS: Record<string, string> = {
  GREETING: "Sapaan",
  ONGKIR_CHECK: "Cek ongkir",
  PRODUCT_INQUIRY: "Tanya produk",
  GENERAL_CHAT: "Obrolan umum"
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
