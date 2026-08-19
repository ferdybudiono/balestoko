"use client";

import { useState } from "react";
import {
  Banknote,
  Calculator,
  CheckCircle,
  ChevronRight,
  MapPin,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  Truck,
  TriangleAlert
} from "lucide-react";
import {
  COURIER_GROUPS,
  MAX_LOCAL_COURIER_COST,
  normalizeActiveCouriers,
  type LocalCourierConfig
} from "@/lib/couriers";
import {
  AI_TONES,
  AI_TONE_HINTS,
  AI_TONE_LABELS,
  MAX_PAYMENT_ACCOUNTS,
  buildOngkirReply,
  normalizePaymentAccounts,
  type AiTone,
  type PaymentAccount
} from "@/lib/reply-format";
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

  /**
   * Kode grup ekspedisi yang dilayani toko. Array KOSONG = semua ekspedisi
   * ditawarkan (bukan "tidak ada"). Selalu diurutkan `normalizeActiveCouriers`
   * supaya `sameForm` — yang membandingkan dengan `JSON.stringify` — tidak
   * salah menandai ada perubahan hanya karena urutan ceklis berbeda.
   */
  activeCouriers: string[];
  /** Kurir toko sendiri. Disimpan pipih (bukan objek) demi alasan yang sama. */
  localCourierEnabled: boolean;
  localCourierLabel: string;
  /** Kosong / "0" = tarif belum pasti ("tanya dulu"). */
  localCourierCost: string;
  localCourierEtd: string;

  /** Maks 3. Kunci objek selalu dibangun dengan urutan tetap: type→name→number→holder. */
  paymentAccounts: PaymentAccount[];
  codEnabled: boolean;
  paymentNote: string;

  aiTone: AiTone;
  includeTotal: boolean;
  includePayment: boolean;
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

  // ── Ekspedisi yang dilayani ───────────────────────────────────────────
  const activeSet = new Set(form.activeCouriers);
  const toggleCourier = (code: string) => {
    const next = activeSet.has(code)
      ? form.activeCouriers.filter((c) => c !== code)
      : [...form.activeCouriers, code];
    // SELALU lewat normalisasi: urutan kanonik membuat perbandingan "ada
    // perubahan belum disimpan" (yang memakai JSON.stringify) tetap jujur.
    setForm({ activeCouriers: normalizeActiveCouriers(next) });
  };

  // ── Rekening pembayaran ───────────────────────────────────────────────
  /** Kunci selalu urut type→name→number→holder, alasan sama seperti di atas. */
  const orderedAccount = (a: PaymentAccount): PaymentAccount => ({
    type: a.type,
    name: a.name,
    number: a.number,
    holder: a.holder
  });

  const setAccount = (idx: number, patch: Partial<PaymentAccount>) =>
    setForm({
      paymentAccounts: form.paymentAccounts.map((a, i) =>
        i === idx ? orderedAccount({ ...a, ...patch }) : a
      )
    });

  const addAccount = () => {
    if (form.paymentAccounts.length >= MAX_PAYMENT_ACCOUNTS) return;
    setForm({
      paymentAccounts: [
        ...form.paymentAccounts,
        { type: "bank", name: "", number: "", holder: "" }
      ]
    });
  };

  const removeAccount = (idx: number) =>
    setForm({ paymentAccounts: form.paymentAccounts.filter((_, i) => i !== idx) });

  // ── Pratinjau balasan ─────────────────────────────────────────────────
  // Dirender oleh `buildOngkirReply`, yaitu fungsi yang SAMA PERSIS dengan yang
  // dipakai bot saat membalas pembeli. Pratinjau yang disusun ulang secara
  // terpisah pasti menyimpang cepat atau lambat, dan pemilik toko akan mengatur
  // sesuatu yang berbeda dari yang benar-benar diterima pembelinya.
  const previewLocal: LocalCourierConfig = {
    enabled: form.localCourierEnabled,
    label: form.localCourierLabel.trim() || "Kurir toko (dalam kota)",
    cost: Math.max(0, Number(form.localCourierCost) || 0),
    etd: form.localCourierEtd.trim()
  };

  // Angka contoh; yang penting di sini bentuk pesannya, bukan tarifnya. Daftar
  // ekspedisinya mengikuti ceklis supaya pratinjau tidak menampilkan kurir yang
  // justru tidak dilayani.
  const sampleCosts = [12000, 14000, 15000];
  const previewRates = (form.activeCouriers.length > 0
    ? COURIER_GROUPS.filter((g) => activeSet.has(g.code))
    : COURIER_GROUPS
  )
    .slice(0, sampleCosts.length)
    .map((g, i) => ({
      courier_name: g.label,
      service_name: "Reguler",
      etd: "1-2 hari",
      cost: sampleCosts[i]
    }));

  const previewReply = buildOngkirReply({
    draft: {
      lines: [
        { name: "Kaos Polos", units: 2, weight: 250, price: 60000, lineTotal: 120000 },
        { name: "Topi Rajut", units: 1, weight: 250, price: 45000, lineTotal: 45000 }
      ],
      subtotal: 165000,
      weightGram: 750,
      weightSource: "matched",
      ambiguous: []
    },
    rates: previewRates,
    localCourier: previewLocal,
    destinationName: "Coblong, Bandung",
    originCityName: form.originCityName || "Jakarta Pusat",
    source: "live",
    payment: {
      // Dinormalisasi sama seperti di server: baris rekening yang masih kosong
      // memang dijatuhkan sebelum dikirim, jadi pratinjau tidak boleh
      // memperlihatkannya seolah-olah akan sampai ke pembeli.
      accounts: normalizePaymentAccounts(form.paymentAccounts),
      codEnabled: form.codEnabled,
      note: form.paymentNote
    },
    includeTotal: form.includeTotal,
    includePayment: form.includePayment,
    courierFilterActive: form.activeCouriers.length > 0
  });

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
              membuat ongkir jadi akurat. Layanan pencarian wilayah sedang tidak bisa dihubungi; coba
              cari lagi beberapa saat lagi.
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

        {/* ── Ekspedisi yang dilayani ─────────────────────────────────── */}
        <div className="space-y-4 pt-5 border-t border-slate-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                <Truck className="w-4 h-4 text-brand-600" aria-hidden="true" />
                Ekspedisi yang dilayani
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Ceklis ekspedisi yang toko Anda benar-benar pakai. AI hanya menawarkan yang diceklis.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setForm({
                    activeCouriers: normalizeActiveCouriers(COURIER_GROUPS.map((g) => g.code))
                  })
                }
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Pilih semua
              </button>
              <button
                type="button"
                onClick={() => setForm({ activeCouriers: [] })}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Kosongkan
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {COURIER_GROUPS.map((g) => {
              const on = activeSet.has(g.code);
              return (
                <label
                  key={g.code}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                    on
                      ? "bg-brand-50 border-brand-300"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleCourier(g.code)}
                    className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-200"
                  />
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-medium truncate ${
                        on ? "text-brand-800" : "text-slate-600"
                      }`}
                    >
                      {g.label}
                    </span>
                    {g.hint && (
                      <span className="block text-[11px] text-slate-400 truncate">{g.hint}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {/* Perilaku "kosong = semua" harus dikatakan terus terang: tanpa
              keterangan ini, kolom kosong mudah dibaca sebagai "tidak ada
              ekspedisi" dan pemilik toko akan bingung kenapa bot tetap
              menawarkan 16 kurir. */}
          {form.activeCouriers.length === 0 ? (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              Belum ada yang diceklis — <strong>semua ekspedisi</strong> ditawarkan ke pembeli.
              Ceklis beberapa untuk membatasinya.
            </p>
          ) : (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              {form.activeCouriers.length} ekspedisi dilayani. Kalau tujuan pembeli tidak
              dijangkau salah satunya, AI akan berkata terus terang — bukan menawarkan kurir
              lain di luar daftar ini.
            </p>
          )}

          {/* Sub-panel: kurir toko sendiri */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.localCourierEnabled}
                onChange={(e) => setForm({ localCourierEnabled: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-200"
              />
              <span>
                <span className="text-sm font-semibold text-ink">
                  Tambah opsi kurir toko / COD dalam kota
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Untuk pengiriman yang Anda antar sendiri atau lewat ojek online.
                </span>
              </span>
            </label>

            {form.localCourierEnabled && (
              <div className="grid sm:grid-cols-3 gap-3 pt-1">
                <div className="sm:col-span-3">
                  <label htmlFor="local-label" className={labelCls}>
                    Nama opsi
                  </label>
                  <input
                    id="local-label"
                    type="text"
                    maxLength={60}
                    placeholder="Kurir toko / Gojek (dalam kota)"
                    value={form.localCourierLabel}
                    onChange={(e) => setForm({ localCourierLabel: e.target.value })}
                    className={`${inputCls} bg-white`}
                  />
                </div>
                <div>
                  <label htmlFor="local-cost" className={labelCls}>
                    Tarif (Rp)
                  </label>
                  <input
                    id="local-cost"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_LOCAL_COURIER_COST}
                    step={1000}
                    placeholder="0"
                    value={form.localCourierCost}
                    onChange={(e) => setForm({ localCourierCost: e.target.value })}
                    className={`${inputCls} bg-white`}
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Kosong atau 0 = tarif ditanyakan dulu (tidak pernah ditulis “Rp 0”).
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="local-etd" className={labelCls}>
                    Estimasi
                  </label>
                  <input
                    id="local-etd"
                    type="text"
                    maxLength={40}
                    placeholder="Hari yang sama"
                    value={form.localCourierEtd}
                    onChange={(e) => setForm({ localCourierEtd: e.target.value })}
                    className={`${inputCls} bg-white`}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Pembayaran ─────────────────────────────────────────────── */}
        <div className="space-y-4 pt-5 border-t border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Banknote className="w-4 h-4 text-brand-600" aria-hidden="true" />
              Pembayaran
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Dikirim otomatis bersama total pesanan, jadi pembeli tidak perlu bertanya lagi ke
              mana harus transfer. Maksimal {MAX_PAYMENT_ACCOUNTS} rekening / e-wallet.
            </p>
          </div>

          {form.paymentAccounts.length === 0 && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              Belum ada rekening. Selama kosong, AI tidak akan menyebut nomor rekening apa pun.
            </p>
          )}

          {form.paymentAccounts.length > 0 && (
            <div className="space-y-3">
              {form.paymentAccounts.map((a, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 sm:grid-cols-[7.5rem_1fr_1fr_1fr_2.5rem] items-start"
                >
                  <select
                    aria-label={`Jenis pembayaran ${idx + 1}`}
                    value={a.type}
                    onChange={(e) =>
                      setAccount(idx, { type: e.target.value === "ewallet" ? "ewallet" : "bank" })
                    }
                    className={inputCls}
                  >
                    <option value="bank">Bank</option>
                    <option value="ewallet">E-wallet</option>
                  </select>
                  <input
                    type="text"
                    maxLength={40}
                    placeholder={a.type === "ewallet" ? "GoPay" : "BCA"}
                    aria-label={`Nama bank / e-wallet ${idx + 1}`}
                    value={a.name}
                    onChange={(e) => setAccount(idx, { name: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    maxLength={40}
                    placeholder={a.type === "ewallet" ? "0812xxxxxxx" : "1234567890"}
                    aria-label={`Nomor ${idx + 1}`}
                    value={a.number}
                    onChange={(e) => setAccount(idx, { number: e.target.value })}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    maxLength={60}
                    placeholder="a.n. nama pemilik"
                    aria-label={`Nama pemilik ${idx + 1}`}
                    value={a.holder}
                    onChange={(e) => setAccount(idx, { holder: e.target.value })}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => removeAccount(idx)}
                    aria-label={`Hapus rekening ${idx + 1}`}
                    className="h-[42px] w-full sm:w-10 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {form.paymentAccounts.length < MAX_PAYMENT_ACCOUNTS && (
            <button
              type="button"
              onClick={addAccount}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-xl transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Tambah rekening
            </button>
          )}

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.codEnabled}
              onChange={(e) => setForm({ codEnabled: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-200"
            />
            <span>
              <span className="text-sm font-semibold text-ink">Terima COD (bayar di tempat)</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Ditawarkan sebagai pilihan pembayaran di balasan AI.
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="payment-note" className={labelCls}>
              Catatan pembayaran (opsional)
            </label>
            <textarea
              id="payment-note"
              rows={2}
              maxLength={600}
              placeholder="Contoh: COD hanya untuk area Bandung. Pesanan diproses setelah bukti transfer diterima."
              value={form.paymentNote}
              onChange={(e) => setForm({ paymentNote: e.target.value })}
              className={`${inputCls} py-3`}
            />
            <p className="text-xs text-slate-400 mt-1.5">{form.paymentNote.length}/600</p>
          </div>
        </div>

        {/* ── Pengaturan AI ──────────────────────────────────────────── */}
        <div className="space-y-4 pt-5 border-t border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-brand-600" aria-hidden="true" />
              Gaya jawaban AI
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Nada bicara bot dan apa saja yang ikut dikirim setiap kali pembeli menanyakan
              ongkir.
            </p>
          </div>

          <div>
            <span className={labelCls}>Nada bicara</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {AI_TONES.map((t) => {
                const on = form.aiTone === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ aiTone: t })}
                    aria-pressed={on}
                    className={`px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      on
                        ? "bg-brand-50 border-brand-300"
                        : "bg-slate-50 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`block text-sm font-semibold ${
                        on ? "text-brand-800" : "text-slate-700"
                      }`}
                    >
                      {AI_TONE_LABELS[t]}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">
                      {AI_TONE_HINTS[t]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

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
              Tentukan gaya bahasa, aturan khusus toko, hal yang tidak boleh dijanjikan, dll.
              Berlaku untuk semua balasan &mdash; termasuk saat AI menyebut harga, ongkir, total
              bayar, dan cara pembayaran. {form.aiPromptSystem.length}/4000
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={form.includeTotal}
                onChange={(e) => setForm({ includeTotal: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-200"
              />
              <span>
                <span className="text-sm font-semibold text-ink">Sertakan rincian &amp; total</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Harga produk dijumlahkan dengan ongkir tiap ekspedisi.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={form.includePayment}
                onChange={(e) => setForm({ includePayment: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-200"
              />
              <span>
                <span className="text-sm font-semibold text-ink">Sertakan cara pembayaran</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Rekening, COD, dan catatan dari section Pembayaran di atas.
                </span>
              </span>
            </label>
          </div>

          {/* Pratinjau dirender oleh buildOngkirReply — fungsi yang SAMA dengan
              yang dipakai bot menyusun ISI balasan. Jadi rincian, ongkir, total,
              dan cara bayar di sini persis seperti yang dihitung untuk pembeli.
              Yang bisa berbeda hanya kalimatnya: bila GEMINI_API_KEY terpasang,
              AI menyampaikan ulang isi ini mengikuti instruksi & nada di atas.
              Angkanya tidak pernah berubah — balasan AI yang menyelipkan angka
              di luar hitungan sistem dibuang dan versi inilah yang dikirim. */}
          <div>
            <span className={labelCls}>Pratinjau isi balasan WhatsApp</span>
            <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl overflow-x-auto">
              <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
                {previewReply}
              </p>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Contoh dengan data karangan (2 produk, tujuan Coblong &mdash; Bandung) dan tarif
              contoh. Ongkir asli selalu diambil dari Mengantar saat pembeli bertanya.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Ini <strong>isi</strong> balasannya, bukan kalimat finalnya. AI CS menyampaikan ulang
              isi yang sama dengan gaya bahasa sesuai instruksi &amp; nada di atas &mdash; semua
              angka tetap dari hitungan sistem, tidak pernah dari AI.
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
