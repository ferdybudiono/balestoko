/**
 * Konfigurasi kupon diskon — single source of truth.
 *
 * Divalidasi & diterapkan SELALU di server (lihat /api/checkout) supaya
 * diskon tidak bisa dimanipulasi dari browser.
 *
 * Aturan kupon "ferdy budiono":
 *  - Diskon 50%.
 *  - Hanya untuk AKUN BARU (email yang belum punya toko berbayar & belum
 *    pernah memakai kupon). Enforcement "sekali pakai" dilakukan di server.
 *  - Hanya berlaku untuk SATU paket (lihat `plans`). Ubah daftar ini bila
 *    ingin membolehkan paket lain.
 */

import type { PackageId } from "@/lib/packages";

export interface Coupon {
  /** Kode kanonik untuk ditampilkan & disimpan. */
  code: string;
  discountPercent: number;
  /** Paket yang boleh memakai kupon ini. */
  plans: PackageId[];
}

/** Normalisasi input kupon: buang spasi berlebih & samakan huruf kecil. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Kunci map = kode ternormalisasi. */
const COUPONS: Record<string, Coupon> = {
  "ferdy budiono": {
    code: "ferdy budiono",
    discountPercent: 50,
    plans: ["pro"],
  },
};

export function getCoupon(rawCode: string | undefined | null): Coupon | undefined {
  if (!rawCode) return undefined;
  return COUPONS[normalizeCouponCode(rawCode)];
}

export interface CouponCheck {
  valid: boolean;
  coupon?: Coupon;
  error?: string;
}

/**
 * Validasi kupon terhadap paket yang dipilih (belum termasuk cek "akun baru",
 * yang butuh akses DB dan dilakukan di route checkout).
 */
export function validateCouponForPlan(rawCode: string, planId: PackageId): CouponCheck {
  const coupon = getCoupon(rawCode);
  if (!coupon) {
    return { valid: false, error: "Kode kupon tidak ditemukan." };
  }
  if (!coupon.plans.includes(planId)) {
    return {
      valid: false,
      error: "Kupon ini tidak berlaku untuk paket yang dipilih.",
    };
  }
  return { valid: true, coupon };
}

/** Hitung harga setelah diskon (integer Rupiah, sesuai syarat Midtrans). */
export function applyDiscount(price: number, discountPercent: number): number {
  const discounted = Math.round(price * (1 - discountPercent / 100));
  return Math.max(0, discounted);
}
