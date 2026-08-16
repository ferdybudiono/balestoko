/**
 * Mengantar API Integration Module (Shipping Rates / Cek Ongkir)
 * Supporting Live Mengantar API endpoint and high-fidelity Mock Fallback.
 */

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

/** Nama ekspedisi ramah-tampilan dari kode kurir Mengantar (allEstimatePublic). */
const COURIER_NAMES: Record<string, string> = {
  JNE: "JNE", JNECargo: "JNE Cargo",
  SiCepat: "SiCepat", SiCepatCargo: "SiCepat Cargo",
  Sap: "SAP Express", SAP: "SAP Express", SapCargo: "SAP Cargo", SAPLite: "SAP Lite",
  iDexpress: "ID Express", iDexpressCargo: "ID Express Cargo", iDlite: "ID Lite",
  JT: "J&T Express", Ninja: "Ninja Xpress", lion: "Lion Parcel",
  anteraja: "AnterAja", paxel: "Paxel", pos: "POS Indonesia"
};

/** ALL CAPS dari API → Title Case yang enak dibaca di WhatsApp. */
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).trim();
}

/** Ubah objek `data` (dikunci per kurir) dari allEstimatePublic → daftar ShippingOption. */
function mapEstimateData(data: Record<string, unknown>): ShippingOption[] {
  const options: ShippingOption[] = [];
  for (const [key, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const price = Number(v.price) || 0;
    if (v.unsupported === true || price <= 0) continue;

    const deliv = String(v.estimate_delivery || "").trim();
    const etd = deliv && deliv !== "-" ? deliv : (String(v.estimatedDate || "").trim() || "1-3 hari");

    options.push({
      courier_code: key.toLowerCase(),
      courier_name: COURIER_NAMES[key] || key,
      service_name: key.toLowerCase().includes("cargo") ? "Cargo" : "Reguler",
      etd,
      cost: price
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
): Promise<MengantarLocation[]> {
  const clean = query.trim();
  if (!clean) return [];

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
        if (mapped.length > 0) return mapped;
      }
    } else {
      console.warn(`[mengantar] address/search HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn("[mengantar] address/search gagal, fallback ke mock:", err);
  }

  // 2. Mock Fallback Search
  const lc = clean.toLowerCase();
  const filtered = MOCK_LOCATIONS.filter(
    (loc) =>
      loc.city_name.toLowerCase().includes(lc) ||
      loc.subdistrict_name.toLowerCase().includes(lc) ||
      loc.province_name.toLowerCase().includes(lc)
  );

  if (filtered.length > 0) return filtered;

  // Jika tidak ditemukan di mock hardcode, hasilkan dinamis agar fleksibel
  return [
    {
      id: "99999" + lc.length,
      subdistrict_name: clean,
      district_name: clean,
      city_name: clean,
      province_name: "Indonesia",
      zip_code: "40000"
    }
  ];
}

/**
 * Hitung biaya ongkos kirim (Cek Ongkir) lewat Mengantar API
 */
export async function calculateMengantarOngkir(params: {
  originSubdistrictId: string;
  destinationSubdistrictId: string;
  weightGram: number; // Dalam gram
  couriers?: string[];
  apiKey?: string;
}): Promise<ShippingOption[]> {
  const { originSubdistrictId, destinationSubdistrictId, weightGram } = params;
  const weightKg = Math.max(1, Math.ceil((weightGram || 1000) / 1000));

  // 1. Panggil Live API Mengantar: allEstimatePublic mengembalikan tarif semua
  //    kurir sekaligus dan bersifat publik (tanpa {API_KEY} di path), sehingga
  //    Cek Ongkir tetap live meski toko belum punya API key sendiri.
  //    origin_id / destination_id HARUS berupa `_id` Mengantar (dari address/search).
  //    Satuan `weight` adalah KILOGRAM (bukan gram).
  if (originSubdistrictId && destinationSubdistrictId) {
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
          const options = mapEstimateData(data.data as Record<string, unknown>);
          if (options.length > 0) return options;
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

  return [
    {
      courier_code: "jne",
      courier_name: "JNE Express",
      service_name: "REG (Reguler)",
      etd: "1-2 hari",
      cost: totalBase * weightKg
    },
    {
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
}
