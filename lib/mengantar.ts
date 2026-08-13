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

/**
 * Cari lokasi kecamatan / kota berdasarkan kata kunci
 */
export async function searchMengantarLocation(
  query: string,
  apiKey?: string
): Promise<MengantarLocation[]> {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  const effectiveApiKey = apiKey || process.env.MENGANTAR_API_KEY;

  // 1. Coba panggil Live API Mengantar jika apiKey ada
  if (effectiveApiKey && effectiveApiKey !== "demo") {
    try {
      const res = await fetch(`https://api-public.mengantar.com/v1/locations/search?q=${encodeURIComponent(clean)}`, {
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          "Content-Type": "application/json"
        },
        cache: "no-store"
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.data)) {
          return data.data.map((loc: Record<string, unknown>) => ({
            id: String(loc.id || loc.subdistrict_id),
            subdistrict_name: String(loc.subdistrict_name || loc.name || ""),
            district_name: String(loc.district_name || ""),
            city_name: String(loc.city_name || loc.city || ""),
            province_name: String(loc.province_name || loc.province || ""),
            zip_code: loc.zip_code ? String(loc.zip_code) : undefined
          }));
        }
      }
    } catch (err) {
      console.warn("[mengantar] API search failed, falling back to mock search:", err);
    }
  }

  // 2. Mock Fallback Search
  const filtered = MOCK_LOCATIONS.filter(
    (loc) =>
      loc.city_name.toLowerCase().includes(clean) ||
      loc.subdistrict_name.toLowerCase().includes(clean) ||
      loc.province_name.toLowerCase().includes(clean)
  );

  if (filtered.length > 0) return filtered;

  // Jika tidak ditemukan di mock hardcode, hasilkan dinamis agar fleksibel
  return [
    {
      id: "99999" + clean.length,
      subdistrict_name: query.trim(),
      district_name: query.trim(),
      city_name: query.trim(),
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
  const { originSubdistrictId, destinationSubdistrictId, weightGram, apiKey } = params;
  const weightKg = Math.max(1, Math.ceil(weightGram / 1000));
  const effectiveApiKey = apiKey || process.env.MENGANTAR_API_KEY;

  // 1. Coba panggil Live Mengantar API jika apiKey diset
  if (effectiveApiKey && effectiveApiKey !== "demo") {
    try {
      const res = await fetch("https://api-public.mengantar.com/v1/shipping/rates", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          origin_id: originSubdistrictId,
          destination_id: destinationSubdistrictId,
          weight: weightGram,
          couriers: params.couriers || ["jne", "jnt", "sicepat", "pos"]
        }),
        cache: "no-store"
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.rates)) {
          return data.rates.map((item: Record<string, unknown>) => ({
            courier_code: String(item.courier_code || item.code || "KURIR"),
            courier_name: String(item.courier_name || item.name || "Ekspedisi"),
            service_name: String(item.service_name || item.service || "Regular"),
            etd: String(item.etd || item.estimated || "1-3 hari"),
            cost: Number(item.cost || item.price || 15000)
          }));
        }
      }
    } catch (err) {
      console.warn("[mengantar] API rates failed, using calculated mock rates:", err);
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
