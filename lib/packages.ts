/**
 * Single source of truth untuk paket & harga.
 *
 * Dipakai oleh:
 *  - Frontend (komponen Pricing & CheckoutModal) untuk menampilkan harga.
 *  - Backend (/api/checkout) untuk menentukan `gross_amount` secara OTORITATIF.
 *
 * PENTING: harga TIDAK PERNAH diambil dari input client. Server selalu
 * membaca harga dari sini berdasarkan `packageId`, supaya tidak bisa
 * dimanipulasi dari browser.
 */

export type PackageId = "starter" | "pro";

export interface Plan {
  id: PackageId;
  name: string;
  /** Harga dalam Rupiah (integer, tanpa desimal — sesuai syarat Midtrans IDR). */
  price: number;
  period: string;
  tagline: string;
  highlighted?: boolean;
  badge?: string;
  ctaLabel: string;
  /**
   * Batas jumlah nomor WhatsApp (device Fonnte) yang boleh disambungkan.
   * DITEGAKKAN di server oleh `/api/fonnte/devices`, bukan cuma klaim di
   * halaman harga — jadi angka di sini harus sama dengan yang ditulis di
   * `features` di bawah.
   */
  maxDevices: number;
  /**
   * Kuota percakapan per bulan kalender (zona WIB). `null` = tanpa batas.
   *
   * Satu "percakapan" = satu pembeli yang chat dalam bulan itu, bukan satu
   * pesan: pembeli yang bolak-balik 50 kali tetap dihitung satu. Ditegakkan di
   * `lib/reply-engine.ts` sebelum Gemini dipanggil, karena setiap pesan masuk
   * memicu biaya AI + kirim WhatsApp.
   */
  monthlyConversations: number | null;
  /**
   * Banyaknya pesan riwayat yang diikutkan ke prompt AI.
   *
   * `0` = AI tanpa memori: setiap pesan dinilai berdiri sendiri. Inilah beda
   * nyata antara "AI Agent" biasa dan "AI Agent lanjutan" — bukan model yang
   * berbeda, tapi apakah AI-nya ingat percakapan sebelumnya. Riwayat tetap
   * dibaca untuk semua paket (dipakai mendeteksi sapaan pertama), yang berbeda
   * hanya apakah ia dimasukkan ke prompt.
   */
  aiContextMessages: number;
  /** Grafik tren 7 hari, sebaran topik & kota tujuan di tab Ringkasan. */
  advancedAnalytics: boolean;
  features: string[];
  /** Fitur yang TIDAK termasuk (ditampilkan dicoret) — opsional. */
  notIncluded?: string[];
}

export const PLANS: Record<PackageId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 99000,
    period: "/bulan",
    tagline: "Pas untuk toko yang baru mulai otomasi chat.",
    ctaLabel: "Pilih Starter",
    maxDevices: 1,
    monthlyConversations: 1000,
    aiContextMessages: 0,
    advancedAnalytics: false,
    features: [
      "1 nomor WhatsApp",
      "Balas chat otomatis 24/7",
      "Cek ongkir real-time (API Mengantar)",
      "1.000 percakapan / bulan",
      "Template sapaan & prompt AI",
      "Dashboard percakapan & katalog produk",
    ],
    notIncluded: [
      "AI dengan memori percakapan",
      "Analitik lanjutan & grafik tren",
      "Prioritas support",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 299000,
    period: "/bulan",
    tagline: "Untuk toko yang serius scale-up penjualan.",
    highlighted: true,
    badge: "Paling Populer",
    ctaLabel: "Pilih Pro",
    maxDevices: 3,
    monthlyConversations: null,
    aiContextMessages: 12,
    advancedAnalytics: true,
    features: [
      "3 nomor WhatsApp",
      "Semua fitur Starter",
      "AI ingat konteks percakapan (bukan sekali-balas)",
      "Percakapan unlimited",
      "Analitik lanjutan: tren, topik & kota tujuan",
      "Integrasi katalog produk",
      "Prioritas support (respon < 2 jam)",
    ],
  },
};

export const PLAN_LIST: Plan[] = [PLANS.starter, PLANS.pro];

export function getPlan(id: string | undefined | null): Plan | undefined {
  if (!id) return undefined;
  return PLANS[id as PackageId];
}

export function isPackageId(id: unknown): id is PackageId {
  return id === "starter" || id === "pro";
}

/**
 * Batas nomor WhatsApp untuk sebuah paket.
 *
 * Dipakai server untuk menolak penambahan device melebihi paket. Paket yang
 * tidak dikenali (atau kosong) jatuh ke batas paling ketat — lebih baik user
 * menghubungi support daripada sistem diam-diam membagikan kuota Pro.
 */
export function maxDevicesForPackage(packageId?: string | null): number {
  return getPlan(packageId)?.maxDevices ?? PLANS.starter.maxDevices;
}

/**
 * Kuota percakapan bulanan sebuah paket. `null` = tanpa batas.
 * Paket tak dikenal jatuh ke batas paling ketat (alasan sama seperti di atas).
 */
export function monthlyConversationLimit(packageId?: string | null): number | null {
  const plan = getPlan(packageId);
  return plan ? plan.monthlyConversations : PLANS.starter.monthlyConversations;
}

/** Jumlah pesan riwayat yang boleh masuk ke prompt AI untuk paket ini. */
export function aiContextMessagesForPackage(packageId?: string | null): number {
  return getPlan(packageId)?.aiContextMessages ?? PLANS.starter.aiContextMessages;
}

/** Paket ini berhak atas grafik tren, sebaran topik & kota tujuan? */
export function hasAdvancedAnalytics(packageId?: string | null): boolean {
  return getPlan(packageId)?.advancedAnalytics ?? PLANS.starter.advancedAnalytics;
}

/**
 * Awal bulan kalender berjalan dalam **WIB**, sebagai epoch ms.
 *
 * Kuota percakapan harus di-reset pada tengah malam waktu pemilik toko, bukan
 * pukul 07:00 WIB (tengah malam UTC). Fungsi ini sengaja ada di sini — bukan di
 * `lib/supabase.ts` — supaya server (penegak kuota) dan dashboard (penampil
 * pemakaian) memakai batas yang SAMA; kalau tidak, angka di layar bisa berbeda
 * dari angka yang memblokir bot, dan itu mustahil dijelaskan ke user.
 *
 * Catatan: WIB (UTC+7) tidak punya DST, jadi offset tetap ini akurat.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function monthStartMs(nowMs: number = Date.now()): number {
  const wib = new Date(nowMs + WIB_OFFSET_MS);
  // Tengah malam 1 <bulan> WIB = 17:00 UTC pada hari terakhir bulan sebelumnya.
  return Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1) - WIB_OFFSET_MS;
}

/** Format angka ke Rupiah, mis. 99000 -> "Rp99.000". */
export function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
