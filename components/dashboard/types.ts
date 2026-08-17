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
