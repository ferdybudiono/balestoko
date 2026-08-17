"use client";

import { useState } from "react";
import {
  Calculator,
  CheckCircle,
  ChevronRight,
  KeyRound,
  MapPin,
  RefreshCw,
  Save,
  Search,
  ShoppingBag,
  Sparkles,
  Truck,
  TriangleAlert
} from "lucide-react";
import { formatRupiah, type ShowToast } from "./types";

export interface LocationOption {
  id: string;
  subdistrict_name: string;
  city_name: string;
}

interface Rate {
  courier_code: string;
  courier_name: string;
  service_name: string;
  etd: string;
  cost: number;
  /** Layanan Cargo yang berat kirimannya belum memenuhi minimum. */
  belowMinimumWeight?: boolean;
}

export interface StoreForm {
  storeName: string;
  originCityName: string;
  originSubdistrictId: string;
  defaultWeight: string;
  aiPromptSystem: string;
  greetingMessage: string;
  /** Kosong = biarkan key yang sudah tersimpan di server apa adanya. */
  mengantarApiKey: string;
  /** Minta server menghapus key tersimpan (kolom kosong saja tidak menghapus). */
  clearMengantarKey: boolean;
}

interface StoreTabProps {
  form: StoreForm;
  setForm: (patch: Partial<StoreForm>) => void;
  /** Ada perubahan yang belum disimpan. */
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  /** Origin sudah berupa `_id` Mengantar asli (24 hex) → ongkir akurat. */
  originValid: boolean;
  /** Toko sudah punya API key Mengantar tersimpan di server. */
  hasMengantarKey: boolean;
  showToast: ShowToast;
}

const inputCls =
  "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const labelCls = "block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2";

export default function StoreTab({
  form,
  setForm,
  dirty,
  saving,
  onSave,
  onReset,
  originValid,
  hasMengantarKey,
  showToast
}: StoreTabProps) {
  // Pencarian lokasi asal
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationOption[]>([]);
  const [locationSource, setLocationSource] = useState<"live" | "mock" | null>(null);
  const [searchingLoc, setSearchingLoc] = useState(false);

  // Tes ongkir sungguhan
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState<LocationOption[]>([]);
  const [searchingTest, setSearchingTest] = useState(false);
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [rateSource, setRateSource] = useState<"live" | "mock" | null>(null);
  const [rateDest, setRateDest] = useState("");
  const [calculating, setCalculating] = useState(false);

  const searchLocations = async (
    q: string,
    apply: (items: LocationOption[], source: "live" | "mock") => void,
    setBusy: (b: boolean) => void
  ) => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ongkir?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal mencari lokasi.", "error");
        return;
      }
      const items: LocationOption[] = Array.isArray(data.locations) ? data.locations : [];
      apply(items, data.source === "mock" ? "mock" : "live");
      if (items.length === 0) showToast("Lokasi tidak ditemukan. Coba kata kunci lain.", "error");
    } catch {
      showToast("Gagal mencari lokasi. Periksa koneksi Anda.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCalculate = async (dest: LocationOption) => {
    setRateDest(`${dest.subdistrict_name}, ${dest.city_name}`);
    setTestResults([]);
    setTestQuery("");
    setCalculating(true);
    setRates(null);
    try {
      const res = await fetch("/api/ongkir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationId: dest.id,
          weightGram: Number(form.defaultWeight) || 1000
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menghitung ongkir.", "error");
        return;
      }
      setRates(Array.isArray(data.rates) ? data.rates : []);
      setRateSource(data.source === "mock" ? "mock" : "live");
    } catch {
      showToast("Gagal menghitung ongkir.", "error");
    } finally {
      setCalculating(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-6"
    >
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Pengaturan toko &amp; ongkir
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Atur nama toko, lokasi pengiriman asal, serta pesan sapaan dan instruksi AI CS.
          </p>
        </div>

        {/* Nama toko */}
        <div>
          <label htmlFor="store-name" className={labelCls}>
            Nama toko
          </label>
          <input
            id="store-name"
            type="text"
            value={form.storeName}
            onChange={(e) => setForm({ storeName: e.target.value })}
            className={inputCls}
          />
        </div>

        {/* ── Lokasi asal ────────────────────────────────────────────── */}
        <div className="p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`${labelCls} mb-0`}>Lokasi asal pengiriman</span>
            {originValid ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                <CheckCircle className="w-3 h-3" aria-hidden="true" />
                Tarif kurir asli
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                <TriangleAlert className="w-3 h-3" aria-hidden="true" />
                Masih simulasi
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Pilih kecamatan tempat toko Anda mengirim barang — dipakai sebagai titik awal perhitungan
            ongkir.
          </p>

          {!originValid && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-amber-900 leading-relaxed">
                Lokasi asal belum dipilih dari hasil pencarian, jadi ongkir ke pembeli masih{" "}
                <strong>perkiraan</strong> (dan AI akan menyebutkannya sebagai perkiraan). Cari lalu
                pilih kecamatan toko Anda di bawah, kemudian <strong>Simpan</strong>.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-600"
                aria-hidden="true"
              />
              <input
                type="text"
                aria-label="Cari kota atau kecamatan asal"
                placeholder="Cari kota atau kecamatan (mis. Bandung)"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // Jangan submit form simpan-toko; jalankan pencarian saja.
                    e.preventDefault();
                    searchLocations(
                      locationQuery,
                      (items, source) => {
                        setLocationResults(items);
                        setLocationSource(source);
                      },
                      setSearchingLoc
                    );
                  }
                }}
                className={`${inputCls} bg-white pl-9`}
              />
            </div>
            <button
              type="button"
              onClick={() =>
                searchLocations(
                  locationQuery,
                  (items, source) => {
                    setLocationResults(items);
                    setLocationSource(source);
                  },
                  setSearchingLoc
                )
              }
              disabled={searchingLoc}
              className="px-4 py-2.5 bg-white hover:bg-slate-100 disabled:opacity-60 border border-slate-200 text-sm font-medium text-slate-700 rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
            >
              {searchingLoc ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Cari</span>
            </button>
          </div>

          {/* Hasil mock TIDAK boleh dirayakan seperti sukses — beri tahu apa adanya. */}
          {locationSource === "mock" && locationResults.length > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              Daftar ini <strong>contoh offline</strong>, bukan dari Mengantar — memilihnya tidak akan
              membuat ongkir jadi akurat. Isi API key Mengantar di bawah, lalu cari lagi.
            </p>
          )}

          {locationResults.length > 0 && (
            <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
              {locationResults.map((loc) => (
                <button
                  type="button"
                  key={loc.id}
                  onClick={() => {
                    setForm({
                      originCityName: `${loc.subdistrict_name}, ${loc.city_name}`,
                      originSubdistrictId: loc.id
                    });
                    setLocationResults([]);
                    setLocationQuery("");
                    showToast(
                      locationSource === "mock"
                        ? `Lokasi diisi dari contoh offline — ongkir masih perkiraan.`
                        : `Lokasi asal disetel ke ${loc.subdistrict_name}. Jangan lupa Simpan.`,
                      locationSource === "mock" ? "error" : "success"
                    );
                  }}
                  className="w-full p-3 hover:bg-brand-50 text-sm flex justify-between items-center gap-2 transition-colors text-left"
                >
                  <span className="font-medium text-slate-700 truncate">
                    {loc.subdistrict_name}, {loc.city_name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-slate-400">Lokasi aktif:</span>
            <span className="text-xs font-bold text-brand-800 bg-brand-50 border border-brand-200 px-2.5 py-1 rounded-lg inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {form.originCityName || "Belum diatur"}
            </span>
          </div>
        </div>

        {/* ── API key Mengantar ──────────────────────────────────────── */}
        <div>
          <label htmlFor="mengantar-key" className={labelCls}>
            API key Mengantar{" "}
            <span className="font-normal normal-case tracking-normal text-slate-400">(opsional)</span>
          </label>
          <div className="relative">
            <KeyRound
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="mengantar-key"
              type="password"
              autoComplete="off"
              placeholder={hasMengantarKey ? "•••••••• (tersimpan — isi untuk mengganti)" : "Tempel API key di sini"}
              value={form.mengantarApiKey}
              onChange={(e) => setForm({ mengantarApiKey: e.target.value, clearMengantarKey: false })}
              className={`${inputCls} pl-9`}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            {hasMengantarKey
              ? "Key sudah tersimpan dan tidak pernah dikirim balik ke browser. Kosongkan kolom ini untuk membiarkannya, atau ketik key baru untuk menggantinya."
              : "Tanpa key, sistem memakai endpoint publik Mengantar yang bisa dibatasi — akibatnya ongkir jatuh ke mode perkiraan."}
          </p>

          {/* Kolom kosong sengaja TIDAK menghapus key — penghapusan harus disengaja. */}
          {hasMengantarKey && !form.mengantarApiKey && (
            <div className="mt-2">
              {form.clearMengantarKey ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 inline-flex flex-wrap items-center gap-2">
                  Key akan dihapus saat Anda menyimpan.
                  <button
                    type="button"
                    onClick={() => setForm({ clearMengantarKey: false })}
                    className="font-semibold underline hover:no-underline"
                  >
                    Batalkan
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setForm({ clearMengantarKey: true })}
                  className="text-xs font-medium text-slate-400 hover:text-red-600 underline"
                >
                  Hapus key tersimpan
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Berat default ──────────────────────────────────────────── */}
        <div>
          <label htmlFor="default-weight" className={labelCls}>
            Berat default per pesanan (gram)
          </label>
          <input
            id="default-weight"
            type="number"
            inputMode="numeric"
            min={100}
            max={50000}
            step={100}
            value={form.defaultWeight}
            onChange={(e) => setForm({ defaultWeight: e.target.value })}
            className={inputCls}
          />
          <p className="text-xs text-slate-400 mt-1.5">
            Dipakai AI bila berat produk tidak diketahui. 1000 = 1 kg. Rentang 100 g – 50 kg.
          </p>
        </div>

        {/* ── Pengaturan AI ──────────────────────────────────────────── */}
        <div className="space-y-4 pt-5 border-t border-slate-100">
          <div>
            <label htmlFor="greeting" className={labelCls}>
              Pesan sambutan otomatis
            </label>
            <textarea
              id="greeting"
              rows={2}
              maxLength={1000}
              value={form.greetingMessage}
              onChange={(e) => setForm({ greetingMessage: e.target.value })}
              className={`${inputCls} py-3`}
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Dikirim saat pembeli menyapa untuk pertama kali. {form.greetingMessage.length}/1000
            </p>
          </div>

          <div>
            <label htmlFor="ai-prompt" className={labelCls}>
              Instruksi khusus untuk AI CS
            </label>
            <textarea
              id="ai-prompt"
              rows={4}
              maxLength={4000}
              value={form.aiPromptSystem}
              onChange={(e) => setForm({ aiPromptSystem: e.target.value })}
              className={`${inputCls} py-3`}
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Tentukan gaya bahasa, aturan khusus toko, hal yang tidak boleh dijanjikan, dll.{" "}
              {form.aiPromptSystem.length}/4000
            </p>
          </div>
        </div>

        {/* ── Aksi simpan ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors shadow-card flex items-center gap-2"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{saving ? "Menyimpan…" : "Simpan pengaturan"}</span>
          </button>

          {dirty && !saving && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                Ada perubahan yang belum disimpan
              </span>
              <button
                type="button"
                onClick={onReset}
                className="text-xs font-medium text-slate-400 hover:text-slate-600 underline"
              >
                Batalkan perubahan
              </button>
            </>
          )}
        </div>
      </section>

      {/* ── Tes ongkir sungguhan ─────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <Calculator className="w-4 h-4 text-brand-600" aria-hidden="true" />
            Tes ongkir dari lokasi toko
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Cek tarif yang akan dilihat pembeli — dari{" "}
            <strong>{form.originCityName || "lokasi asal"}</strong> dengan berat{" "}
            {Number(form.defaultWeight) || 1000} gram. Memakai lokasi asal yang{" "}
            <strong>sudah tersimpan</strong>, jadi simpan dulu bila baru diubah.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Truck
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Cari kota tujuan untuk tes ongkir"
              placeholder="Kota tujuan (mis. Surabaya)"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  searchLocations(testQuery, (items) => setTestResults(items), setSearchingTest);
                }
              }}
              className={`${inputCls} pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={() => searchLocations(testQuery, (items) => setTestResults(items), setSearchingTest)}
            disabled={searchingTest}
            className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 disabled:opacity-60 border border-slate-200 text-sm font-medium text-slate-700 rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
          >
            {searchingTest ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>Cari</span>
          </button>
        </div>

        {testResults.length > 0 && (
          <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
            {testResults.map((loc) => (
              <button
                type="button"
                key={loc.id}
                onClick={() => handleCalculate(loc)}
                className="w-full p-3 hover:bg-brand-50 text-sm flex justify-between items-center gap-2 transition-colors text-left"
              >
                <span className="font-medium text-slate-700 truncate">
                  {loc.subdistrict_name}, {loc.city_name}
                </span>
                <span className="text-[11px] font-semibold text-brand-700 shrink-0">Hitung</span>
              </button>
            ))}
          </div>
        )}

        {calculating && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Menghitung tarif ke {rateDest}…
          </div>
        )}

        {rates && !calculating && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink">Tarif ke {rateDest}</p>
              {rateSource === "live" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 px-2.5 py-1 text-[11px] font-semibold text-brand-700">
                  <CheckCircle className="w-3 h-3" aria-hidden="true" />
                  Tarif asli Mengantar
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                  <TriangleAlert className="w-3 h-3" aria-hidden="true" />
                  Perkiraan, bukan tarif asli
                </span>
              )}
            </div>

            {rates.length === 0 ? (
              <p className="text-xs text-slate-400">Tidak ada layanan kurir untuk rute ini.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {rates.map((r, i) => (
                  <li
                    key={`${r.courier_code}-${r.service_name}-${i}`}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {r.courier_name}{" "}
                        <span className="font-normal text-slate-500">{r.service_name}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">Estimasi {r.etd}</p>
                      {r.belowMinimumWeight && (
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Tarif minimum — berat paket di bawah batas layanan ini
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-ink shrink-0">
                      {formatRupiah(r.cost)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {rateSource === "mock" && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed">
                Angka di atas dihitung lokal karena lokasi asal belum berupa lokasi Mengantar asli atau
                API key belum terpasang. AI juga akan menyebut tarif ini sebagai perkiraan kepada
                pembeli.
              </p>
            )}
          </div>
        )}

        {!rates && !calculating && testResults.length === 0 && (
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-brand-600" aria-hidden="true" />
            Cari kota tujuan lalu pilih untuk melihat tarif yang akan dikutip AI.
          </p>
        )}
      </section>
    </form>
  );
}
