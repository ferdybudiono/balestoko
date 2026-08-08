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
    features: [
      "1 nomor WhatsApp",
      "Balas chat otomatis 24/7",
      "Cek ongkir real-time (API Mengantar)",
      "1.000 percakapan / bulan",
      "Template balasan siap pakai",
      "Dashboard order dasar",
    ],
    notIncluded: ["AI Agent lanjutan", "Analitik & laporan", "Prioritas support"],
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
    features: [
      "3 nomor WhatsApp",
      "Semua fitur Starter",
      "AI Agent pintar (paham konteks & produk)",
      "Percakapan unlimited",
      "Auto follow-up & closing",
      "Analitik & laporan penjualan",
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

/** Format angka ke Rupiah, mis. 99000 -> "Rp99.000". */
export function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
