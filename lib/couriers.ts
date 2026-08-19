/**
 * Katalog ekspedisi + kurir toko sendiri.
 *
 * Modul ini MURNI: tidak membaca `process.env`, tidak memanggil `fetch`, jadi
 * aman diimpor dari komponen client maupun dari server — pola yang sama dengan
 * `lib/packages.ts`. Itu bukan kerapian belaka: `lib/mengantar.ts` membaca ENV
 * di scope modul sehingga dashboard tidak bisa mengimpornya, jadi daftar merek
 * ekspedisi harus tinggal di file terpisah supaya checkbox di dashboard dan
 * penyaringan tarif di server benar-benar memakai sumber yang sama.
 */

export interface CourierGroup {
  /** Kode kanonik yang disimpan di `stores.active_couriers`. */
  code: string;
  /** Nama merek untuk ditampilkan di dashboard. */
  label: string;
  /**
   * Semua `courier_code` yang mungkin dikembalikan Mengantar untuk merek ini.
   * Sudah lowercase, sama seperti yang dihasilkan `mapEstimateData`.
   */
  services: string[];
  /** Kode historis yang pernah dipakai (tarif mock lama / default kolom lama). */
  aliases?: string[];
  /** Keterangan singkat di bawah checkbox. */
  hint?: string;
}

/**
 * Pemilik toko berpikir dalam MEREK ("JNE", "J&T"), bukan dalam ~16 kode layanan
 * termasuk varian Cargo/Lite. Jadi yang diceklis adalah merek, dan satu ceklis
 * mengizinkan seluruh layanan merek itu.
 *
 * Urutan array ini adalah urutan kanonik: dipakai untuk menampilkan checkbox DAN
 * untuk mengurutkan hasil `normalizeActiveCouriers`.
 */
export const COURIER_GROUPS: CourierGroup[] = [
  { code: "jne", label: "JNE", services: ["jne", "jnecargo"], hint: "Reguler & Cargo" },
  { code: "jt", label: "J&T Express", services: ["jt"], aliases: ["jnt"] },
  { code: "sicepat", label: "SiCepat", services: ["sicepat", "sicepatcargo"], hint: "Reguler & Cargo" },
  { code: "anteraja", label: "AnterAja", services: ["anteraja"] },
  { code: "ninja", label: "Ninja Xpress", services: ["ninja"] },
  { code: "idexpress", label: "ID Express", services: ["idexpress", "idexpresscargo", "idlite"], hint: "Reguler, Cargo & Lite" },
  { code: "lion", label: "Lion Parcel", services: ["lion"] },
  { code: "sap", label: "SAP Express", services: ["sap", "sapcargo", "saplite"], hint: "Reguler, Cargo & Lite" },
  { code: "paxel", label: "Paxel", services: ["paxel"] },
  { code: "pos", label: "POS Indonesia", services: ["pos"] }
];

/** Peta `courier_code` (dan alias) → kode grup. Dibangun sekali saat modul dimuat. */
const SERVICE_TO_GROUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const g of COURIER_GROUPS) {
    for (const s of g.services) map[s.toLowerCase()] = g.code;
    for (const a of g.aliases || []) map[a.toLowerCase()] = g.code;
  }
  return map;
})();

const GROUP_ORDER: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  COURIER_GROUPS.forEach((g, i) => (map[g.code] = i));
  return map;
})();

/** Kode grup untuk satu `courier_code` dari Mengantar, atau `null` bila tak dikenal. */
export function courierGroupOf(courierCode: string): string | null {
  return SERVICE_TO_GROUP[(courierCode || "").trim().toLowerCase()] || null;
}

/** Label merek dari kode grup; jatuh ke kodenya sendiri bila tak dikenal. */
export function courierLabel(groupCode: string): string {
  return COURIER_GROUPS.find((g) => g.code === groupCode)?.label || groupCode;
}

/**
 * Bersihkan nilai `active_couriers` apa pun bentuknya menjadi daftar kode grup
 * yang sah: buang yang tak dikenal, dedupe, lalu urutkan menurut urutan kanonik.
 *
 * Urutan yang stabil itu WAJIB, bukan kosmetik: dashboard mendeteksi "ada
 * perubahan belum disimpan" dengan `JSON.stringify` (`sameForm`), jadi urutan
 * yang berubah-ubah akan membuat tombol Simpan menyala terus tanpa sebab.
 */
export function normalizeActiveCouriers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    // Terima kode grup langsung maupun `courier_code`/alias mentah, supaya
    // nilai lama di database tetap terbaca setelah semantiknya berubah.
    const code = GROUP_ORDER[item.trim().toLowerCase()] !== undefined
      ? item.trim().toLowerCase()
      : courierGroupOf(item);
    if (code) seen.add(code);
  }
  return [...seen].sort((a, b) => (GROUP_ORDER[a] ?? 99) - (GROUP_ORDER[b] ?? 99));
}

/**
 * Saring tarif menurut ekspedisi yang dilayani toko.
 *
 * Dua perilaku di sini SENGAJA berbeda arah, dan itu bukan inkonsistensi:
 *
 * - Belum ada yang diceklis (`active` kosong/null) → kembalikan SEMUA.
 *   Fail-open. Pemilik toko yang belum pernah membuka pengaturan ini tidak boleh
 *   mendapat bot yang mengutip nol ekspedisi.
 * - Sudah diceklis tapi rute ini tidak menghasilkan satu pun kecocokan →
 *   kembalikan KOSONG, jangan jatuh kembali ke semua kurir. Mengutip kurir yang
 *   tokonya tidak punya akun jauh lebih merugikan daripada berkata jujur bahwa
 *   ekspedisi pilihan toko belum melayani rute itu.
 */
export function filterRatesByActiveCouriers<T extends { courier_code: string }>(
  rates: T[],
  active?: string[] | null
): T[] {
  const allowed = normalizeActiveCouriers(active);
  if (allowed.length === 0) return rates;
  const set = new Set(allowed);
  return rates.filter((r) => {
    const group = courierGroupOf(r.courier_code);
    return group ? set.has(group) : false;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Kurir toko sendiri (bukan dari Mengantar)
// ─────────────────────────────────────────────────────────────────────────────

/** Tarif kurir toko di atas ini pasti salah input. */
export const MAX_LOCAL_COURIER_COST = 1_000_000;

export interface LocalCourierConfig {
  /**
   * Ditampilkan ke pembeli atau tidak. Disimpan DI DALAM objek (bukan sebagai
   * ketiadaan objek) supaya label & tarif yang sudah diketik tidak hilang ketika
   * pemilik toko mematikan opsinya sementara.
   */
  enabled: boolean;
  label: string;
  /** `0` berarti tarif belum pasti → ditampilkan sebagai "tanya dulu". */
  cost: number;
  etd: string;
}

export const DEFAULT_LOCAL_COURIER: LocalCourierConfig = {
  enabled: false,
  label: "Kurir toko / Gojek (dalam kota)",
  cost: 0,
  etd: "Hari yang sama"
};

/** Bersihkan `local_courier` dari database atau dari body request. */
export function normalizeLocalCourier(raw: unknown): LocalCourierConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_LOCAL_COURIER };
  const v = raw as Record<string, unknown>;
  const label = typeof v.label === "string" ? v.label.trim().slice(0, 60) : "";
  const costRaw = Number(v.cost);
  const cost =
    Number.isFinite(costRaw) && costRaw > 0
      ? Math.min(MAX_LOCAL_COURIER_COST, Math.round(costRaw))
      : 0;
  return {
    // Label kosong tidak bisa ditampilkan ke pembeli, jadi tidak boleh aktif.
    enabled: v.enabled === true && label.length > 0,
    label: label || DEFAULT_LOCAL_COURIER.label,
    cost,
    etd: typeof v.etd === "string" ? v.etd.trim().slice(0, 40) : ""
  };
}
