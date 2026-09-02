/**
 * Mengantar API Integration Module (Shipping Rates / Cek Ongkir)
 * Supporting Live Mengantar API endpoint and high-fidelity Mock Fallback.
 */

import { filterRatesByActiveCouriers } from "./couriers";

export interface MengantarLocation {
  id: string;
  subdistrict_name: string;
  district_name: string;
  city_name: string;
  province_name: string;
  zip_code?: string;
}

export interface ShippingOption {
  courier_code: string;
  courier_name: string;
  service_name: string;
  etd: string; // Estimasi Tiba (misal: "1-2 hari")
  cost: number; // Dalam IDR Rupiah
  /**
   * Layanan Cargo yang berat kirimannya di bawah minimum, jadi tarifnya adalah
   * tarif minimum (tidak proporsional dengan berat sebenarnya).
   */
  belowMinimumWeight?: boolean;
}

/**
 * Asal data: `live` = benar-benar dari API Mengantar, `mock` = hasil simulasi
 * lokal karena API gagal / origin-destination belum berupa `_id` Mengantar.
 *
 * Ini WAJIB dipropagasi ke atas: tarif `mock` tidak boleh disajikan ke pembeli
 * (atau ke pemilik toko di dashboard) seolah-olah tarif kurir sungguhan.
 */
export type RateSource = "live" | "mock";

export interface LocationSearchResult {
  locations: MengantarLocation[];
  source: RateSource;
}

export interface OngkirResult {
  rates: ShippingOption[];
  source: RateSource;
}

/** `_id` Mengantar berupa ObjectId 24 karakter hex. Selain itu bukan ID asli. */
export function isMengantarId(id?: string | null): boolean {
  return /^[a-f0-9]{24}$/i.test((id || "").trim());
}

// Data lokasi bawaan untuk fallback jika API Mengantar belum dihubungkan
const MOCK_LOCATIONS: MengantarLocation[] = [
  { id: "3171010", subdistrict_name: "Gambir", district_name: "Gambir", city_name: "Jakarta Pusat", province_name: "DKI Jakarta", zip_code: "10110" },
  { id: "3273010", subdistrict_name: "Coblong", district_name: "Coblong", city_name: "Bandung", province_name: "Jawa Barat", zip_code: "40132" },
  { id: "3578010", subdistrict_name: "Gubeng", district_name: "Gubeng", city_name: "Surabaya", province_name: "Jawa Timur", zip_code: "60281" },
  { id: "3374010", subdistrict_name: "Semarang Selatan", district_name: "Semarang Selatan", city_name: "Semarang", province_name: "Jawa Tengah", zip_code: "50249" },
  { id: "5171010", subdistrict_name: "Denpasar Selatan", district_name: "Denpasar Selatan", city_name: "Denpasar", province_name: "Bali", zip_code: "80221" },
  { id: "1275010", subdistrict_name: "Medan Kota", district_name: "Medan Kota", city_name: "Medan", province_name: "Sumatera Utara", zip_code: "20212" },
  { id: "7371010", subdistrict_name: "Ujung Pandang", district_name: "Ujung Pandang", city_name: "Makassar", province_name: "Sulawesi Selatan", zip_code: "90111" }
];

/** Base URL API Mengantar (bisa dioverride via ENV untuk sandbox/testing). */
const MENGANTAR_BASE_URL = (process.env.MENGANTAR_BASE_URL || "https://api-public.mengantar.com").replace(/\/+$/, "");

/**
 * Segmen {API_KEY} pada path Mengantar. Route `address/search` TIDAK memvalidasi
 * key (bagian dari legacy system per dokumentasi), sehingga placeholder "public"
 * tetap berfungsi bila toko belum punya API key sendiri.
 */
function mengantarKeyPath(apiKey?: string): string {
  const key = (apiKey || process.env.MENGANTAR_API_KEY || "public").trim() || "public";
  return encodeURIComponent(key);
}

/**
 * Nama ekspedisi ramah-tampilan dari kode kurir Mengantar (allEstimatePublic).
 *
 * Merek yang sudah tidak bekerja sama TIDAK ada di sini dan tidak perlu ada:
 * tarifnya sudah dibuang `filterRatesByActiveCouriers` sebelum sampai ke tahap
 * penamaan. Daftar merek pensiun tinggal di `RETIRED_COURIERS`
 * (`lib/couriers.ts`) — satu tempat saja, supaya nama merek yang tidak bisa
 * dikirim tidak pernah muncul lagi di balasan ke pembeli.
 */
const COURIER_NAMES: Record<string, string> = {
  JNE: "JNE", JNECargo: "JNE Cargo",
  SiCepat: "SiCepat", SiCepatCargo: "SiCepat Cargo",
  Sap: "SAP Express", SAP: "SAP Express", SapCargo: "SAP Cargo", SAPLite: "SAP Lite",
  iDexpress: "ID Express", iDexpressCargo: "ID Express Cargo", iDlite: "ID Lite",
  JT: "J&T Express", lion: "Lion Parcel",
  anteraja: "AnterAja", paxel: "Paxel", pos: "POS Indonesia"
};

/** ALL CAPS dari API → Title Case yang enak dibaca di WhatsApp. */
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).trim();
}

/**
 * Normalisasi estimasi tiba ke bahasa Indonesia.
 *
 * `estimate_delivery` dari API tidak konsisten — nilai nyata yang pernah muncul:
 * "1 - 2 days", "2 - 3 Days", "2 - 4 days", "2-4 Day", "1 - 2 Hari", "4 HARI",
 * dan "-". Menampilkannya apa adanya membuat pesan berbahasa Indonesia
 * bercampur "days"/"Day"/"HARI".
 */
function normalizeEtd(raw: unknown, fallback: unknown): string {
  const pick = (v: unknown): string => {
    const s = String(v ?? "").trim();
    return s && s !== "-" ? s : "";
  };
  const src = pick(raw) || pick(fallback);
  if (!src) return "1-3 hari";

  const norm = src
    .toLowerCase()
    .replace(/\bdays?\b/g, "hari")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return /hari/.test(norm) ? norm : `${norm} hari`;
}

/**
 * Ubah objek `data` (dikunci per kurir) dari allEstimatePublic → daftar ShippingOption.
 *
 * `weightKg` dipakai untuk menandai layanan Cargo yang berat minimumnya belum
 * terpenuhi. Layanan itu TIDAK dibuang: pada 1 kg cargo memang mahal (kena
 * tarif minimum), tapi pada 8 kg justru bisa lebih murah dari reguler — jadi
 * lebih jujur menampilkannya dengan keterangan minimum daripada
 * menyembunyikan opsi termurah.
 */
function mapEstimateData(data: Record<string, unknown>, weightKg: number): ShippingOption[] {
  const options: ShippingOption[] = [];
  for (const [key, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;

    // CATATAN SENGAJA: pakai `price` (tarif normal), BUKAN
    // `estimatedSpecialPrice`. Field diskon itu tidak bisa dipercaya — pernah
    // terlihat SiCepatCargo price=40000 tapi estimatedSpecialPrice=8400
    // (nilai milik SiCepat reguler). Mengutip angka itu ke pembeli membuat
    // toko menanggung selisihnya.
    const price = Number(v.price) || 0;
    if (v.unsupported === true || price <= 0) continue;

    const isCargo = key.toLowerCase().includes("cargo");
    const minCargo = Number(v.minimumWeightCargo) || 0;

    let serviceName: string;
    if (isCargo) {
      serviceName = minCargo > 0 ? `Cargo (min. ${minCargo} kg)` : "Cargo";
    } else if (key.toLowerCase().includes("lite")) {
      serviceName = "Lite";
    } else {
      serviceName = "Reguler";
    }

    options.push({
      courier_code: key.toLowerCase(),
      courier_name: COURIER_NAMES[key] || key,
      service_name: serviceName,
      etd: normalizeEtd(v.estimate_delivery, v.estimatedDate),
      cost: price,
      // Tarif minimum belum terpenuhi → harga tidak proporsional dengan berat.
      belowMinimumWeight: isCargo && minCargo > 0 && weightKg < minCargo
    });
  }
  options.sort((a, b) => a.cost - b.cost);
  return options;
}

/**
 * Cari lokasi kecamatan / kota berdasarkan kata kunci.
 * Endpoint asli: GET {BASE}/api/public/{API_KEY}/address/search?keyword=...
 * `id` yang dikembalikan adalah `_id` Mengantar — dipakai sebagai origin_id/
 * destination_id saat menghitung ongkir.
 */
export async function searchMengantarLocation(
  query: string,
  apiKey?: string
): Promise<LocationSearchResult> {
  const clean = query.trim();
  if (!clean) return { locations: [], source: "live" };

  // 1. Panggil Live API Mengantar (key tidak divalidasi untuk route ini).
  try {
    const url = `${MENGANTAR_BASE_URL}/api/public/${mengantarKeyPath(apiKey)}/address/search?keyword=${encodeURIComponent(clean)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });

    if (res.ok) {
      const data = await res.json();
      if (data?.success && Array.isArray(data.data) && data.data.length > 0) {
        const mapped = data.data
          .slice(0, 15)
          .map((loc: Record<string, unknown>) => ({
            id: String(loc._id || loc.DESTINATION_CODE || ""),
            subdistrict_name: toTitleCase(String(loc.SUBDISTRICT_NAME || "")),
            district_name: toTitleCase(String(loc.DISTRICT_NAME || "")),
            city_name: toTitleCase(String(loc.CITY_NAME || loc.CITY_NAME_SI || "")),
            province_name: toTitleCase(String(loc.PROVINCE_NAME || "")),
            zip_code: loc.ZIP_CODE ? String(loc.ZIP_CODE) : undefined
          }))
          .filter((l: MengantarLocation) => l.id);
        if (mapped.length > 0) return { locations: mapped, source: "live" };
      }
    } else {
      console.warn(`[mengantar] address/search HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("[mengantar] address/search gagal, fallback ke mock:", err);
  }

  // 2. Mock Fallback Search — DITANDAI `source: "mock"` supaya pemanggil bisa
  //    memberi tahu user bahwa ID ini bukan ID Mengantar asli (ongkir simulasi).
  const lc = clean.toLowerCase();
  const filtered = MOCK_LOCATIONS.filter(
    (loc) =>
      loc.city_name.toLowerCase().includes(lc) ||
      loc.subdistrict_name.toLowerCase().includes(lc) ||
      loc.province_name.toLowerCase().includes(lc)
  );

  if (filtered.length > 0) return { locations: filtered, source: "mock" };

  // Jika tidak ditemukan di mock hardcode, hasilkan dinamis agar fleksibel
  return {
    locations: [
      {
        id: "99999" + lc.length,
        subdistrict_name: clean,
        district_name: clean,
        city_name: clean,
        province_name: "Indonesia",
        zip_code: "40000"
      }
    ],
    source: "mock"
  };
}

/**
 * Hitung biaya ongkos kirim (Cek Ongkir) lewat Mengantar API
 *
 * `couriers` = daftar kode grup ekspedisi yang dilayani toko
 * (`stores.active_couriers`). Penyaringan sengaja ditaruh DI SINI, bukan di
 * pemanggil: ini satu-satunya tempat yang dilewati jalur live maupun jalur
 * simulasi, jadi bot dan tes ongkir di dashboard mustahil memakai aturan yang
 * berbeda. Kosong/undefined = semua ekspedisi (lihat `filterRatesByActiveCouriers`).
 */
export async function calculateMengantarOngkir(params: {
  originSubdistrictId: string;
  destinationSubdistrictId: string;
  weightGram: number; // Dalam gram
  couriers?: string[] | null;
  apiKey?: string;
}): Promise<OngkirResult> {
  const { originSubdistrictId, destinationSubdistrictId, weightGram, couriers } = params;
  const weightKg = Math.max(1, Math.ceil((weightGram || 1000) / 1000));

  // 1. Panggil Live API Mengantar: allEstimatePublic mengembalikan tarif semua
  //    kurir sekaligus dan bersifat publik (tanpa {API_KEY} di path), sehingga
  //    Cek Ongkir tetap live meski toko belum punya API key sendiri.
  //    origin_id / destination_id HARUS berupa `_id` Mengantar (dari address/search);
  //    kalau bukan, API pasti gagal — jadi jangan buang waktu memanggilnya.
  //    Satuan `weight` adalah KILOGRAM (bukan gram).
  if (isMengantarId(originSubdistrictId) && isMengantarId(destinationSubdistrictId)) {
    try {
      const qs = new URLSearchParams({
        origin_id: String(originSubdistrictId),
        destination_id: String(destinationSubdistrictId),
        weight: String(weightKg)
      });
      const url = `${MENGANTAR_BASE_URL}/api/order/allEstimatePublic?${qs.toString()}`;
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });

      if (res.ok) {
        const data = await res.json();
        if (data?.success && data.data && typeof data.data === "object") {
          const options = mapEstimateData(data.data as Record<string, unknown>, weightKg);
          // Penyaringan dilakukan SETELAH memastikan API memang mengembalikan
          // tarif. Kalau tarifnya ada tapi semuanya milik kurir yang tidak
          // dilayani toko, hasilnya harus tetap "live tapi kosong" — JANGAN
          // jatuh ke blok simulasi di bawah, karena itu justru mengembalikan
          // kurir yang baru saja sengaja dibuang.
          if (options.length > 0) {
            return { rates: filterRatesByActiveCouriers(options, couriers), source: "live" };
          }
        }
      } else {
        console.warn(`[mengantar] allEstimatePublic HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn("[mengantar] allEstimatePublic gagal, pakai tarif simulasi:", err);
    }
  }

  // 2. Realistic Mock Shipping Cost Calculation
  // Berdasarkan jarak simulasi & berat kg
  const baseRate = 12000;
  const distanceMultiplier = Math.abs(
    (parseInt(destinationSubdistrictId) || 3000) - (parseInt(originSubdistrictId) || 3000)
  ) % 15000;

  const totalBase = baseRate + Math.min(25000, Math.floor(distanceMultiplier / 500) * 1500);

  const mockRates: ShippingOption[] = [
    {
      courier_code: "jne",
      courier_name: "JNE Express",
      service_name: "REG (Reguler)",
      etd: "1-2 hari",
      cost: totalBase * weightKg
    },
    {
      // `jnt` adalah kode historis; dikenali sebagai grup `jt` lewat alias di
      // lib/couriers.ts, jadi J&T tetap ikut tersaring dengan benar.
      courier_code: "jnt",
      courier_name: "J&T Express",
      service_name: "EZ",
      etd: "1-3 hari",
      cost: (totalBase - 1000) * weightKg
    },
    {
      courier_code: "sicepat",
      courier_name: "SiCepat Ekspres",
      service_name: "SIUNTUNG",
      etd: "1-2 hari",
      cost: (totalBase + 1000) * weightKg
    },
    {
      courier_code: "pos",
      courier_name: "Pos Indonesia",
      service_name: "Pos Kilat Khusus",
      etd: "2-4 hari",
      cost: Math.max(9000, (totalBase - 3000) * weightKg)
    }
  ];

  // Jalur simulasi ikut disaring supaya pengaturan ekspedisi toko tetap dihormati
  // walau tarifnya sedang tidak bisa diambil dari Mengantar.
  return { source: "mock", rates: filterRatesByActiveCouriers(mockRates, couriers) };
}
