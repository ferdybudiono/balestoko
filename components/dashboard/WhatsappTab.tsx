"use client";

import { useState } from "react";
import {
  CheckCircle,
  Inbox,
  Info,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Wrench,
  Lock
} from "lucide-react";
import type { Product, StoreDevice } from "./types";
import { formatPhoneDisplay, isDeviceConnected, isInboundReady, relativeTime } from "./types";

interface WhatsappTabProps {
  devices: StoreDevice[];
  /** Batas nomor sesuai paket (Starter 1, Pro 3) — ditegakkan juga di server. */
  deviceLimit: number;
  planName: string;
  /** Tabel `store_devices` belum ada/terisi: nomor tampil read-only. */
  devicesNeedMigration: boolean;
  refreshingDevices: boolean;
  onRefreshDevices: () => void;

  /** URL webhook yang berlaku (secret sudah disamarkan server). */
  expectedWebhookUrl?: string | null;
  /** Terisi bila NEXT_PUBLIC_BASE_URL tidak bisa dijangkau Fonnte. */
  baseUrlWarning?: string | null;
  /** Nomor yang setelan penerimaannya sedang diperbaiki. */
  repairingDeviceId: string | null;
  onRepairDevice: (device: StoreDevice) => void;

  newPhone: string;
  setNewPhone: (v: string) => void;
  newLabel: string;
  setNewLabel: (v: string) => void;
  addingDevice: boolean;
  onAddDevice: () => void;
  removingDeviceId: string | null;
  onRemoveDevice: (device: StoreDevice) => void;

  /** Katalog toko — sumber pilihan "produk yang dijawab nomor ini". */
  products: Product[];
  /** Nomor yang cakupan produknya sedang disimpan. */
  savingScopeId: string | null;
  /** `[]` = nomor umum (menjawab seluruh katalog). */
  onSaveScope: (deviceId: string, productIds: string[]) => void;

  /** Device yang QR-nya sedang ditampilkan. */
  qrDeviceId: string | null;
  qrUrl: string | null;
  loadingQr: boolean;
  onFetchQr: (device: StoreDevice) => void;
  /** Menghentikan polling QR & menyembunyikan QR. */
  onCancelQr: () => void;

  testPhone: string;
  setTestPhone: (v: string) => void;
  testMessageText: string;
  setTestMessageText: (v: string) => void;
  testDeviceId: string;
  setTestDeviceId: (v: string) => void;
  sendingTest: boolean;
  onSendTest: () => void;
}

export default function WhatsappTab({
  devices,
  deviceLimit,
  planName,
  devicesNeedMigration,
  refreshingDevices,
  onRefreshDevices,
  expectedWebhookUrl,
  baseUrlWarning,
  repairingDeviceId,
  onRepairDevice,
  newPhone,
  setNewPhone,
  newLabel,
  setNewLabel,
  addingDevice,
  onAddDevice,
  removingDeviceId,
  onRemoveDevice,
  products,
  savingScopeId,
  onSaveScope,
  qrDeviceId,
  qrUrl,
  loadingQr,
  onFetchQr,
  onCancelQr,
  testPhone,
  setTestPhone,
  testMessageText,
  setTestMessageText,
  testDeviceId,
  setTestDeviceId,
  sendingTest,
  onSendTest
}: WhatsappTabProps) {
  // Hapus nomor = hapus device di Fonnte juga, jadi butuh konfirmasi. Ditahan di
  // sini (bukan window.confirm) supaya tetap satu gaya dengan dashboard.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const inputCls =
    "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-60";

  const connectedDevices = devices.filter(isDeviceConnected);
  const atLimit = devices.length >= deviceLimit;
  const canAdd = !devicesNeedMigration && !atLimit;
  const addFormOpen = showAddForm || devices.length === 0;
  // Bisa terjadi setelah turun paket (mis. selesai trial lalu ambil Starter):
  // nomor melebihi kuota tidak dilayani bot. Urutannya sama dengan server.
  const overLimitIds = new Set(
    devices.slice(deviceLimit).map((d) => d.id || d.phone)
  );
  // Nomor yang benar-benar bisa dipakai mengirim: terhubung DAN dalam kuota.
  const sendableDevices = connectedDevices.filter((d) => !overLimitIds.has(d.id || d.phone));

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card overflow-hidden">
        <div className="px-5 sm:px-6 pt-6 pb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-brand-600" aria-hidden="true" />
              Nomor WhatsApp toko
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Scan QR sekali per nomor. Setiap nomor punya bot AI-nya sendiri, dan balasan selalu
              keluar dari nomor yang dihubungi pembeli.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshDevices}
            disabled={refreshingDevices}
            title="Segarkan status koneksi & periksa jalur pesan masuk tiap nomor"
            className="shrink-0 p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-700 hover:border-brand-200 disabled:opacity-60 transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshingDevices ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span className="sr-only">Segarkan status</span>
          </button>
        </div>

        <div className="px-5 sm:px-6 pb-6 space-y-4">
          {/* Kuota nomor sesuai paket */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200 font-semibold text-brand-800">
              Paket {planName}
            </span>
            <span className="text-slate-500">
              <strong className="text-ink">{devices.length}</strong> dari {deviceLimit} nomor terpakai
              {connectedDevices.length > 0 && (
                <> &middot; {connectedDevices.length} aktif</>
              )}
            </span>
          </div>

          {/* Jalur terima mati total: URL webhook tidak bisa dijangkau Fonnte.
              Ini kegagalan tingkat aplikasi (salah ENV saat deploy), bukan per
              nomor — dan gejalanya menipu: uji coba di bawah tetap berhasil
              karena hanya memakai jalur KIRIM. */}
          {baseUrlWarning && (
            <div className="flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl">
              <TriangleAlert className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="text-xs text-rose-900 leading-relaxed space-y-1">
                <p className="font-semibold">Bot tidak bisa menerima chat pembeli</p>
                <p>{baseUrlWarning}</p>
              </div>
            </div>
          )}

          {devicesNeedMigration && (
            <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
              <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-amber-900 leading-relaxed">
                Dukungan multi-nomor belum aktif di database Anda. Jalankan ulang{" "}
                <code className="px-1 py-0.5 bg-amber-100 rounded font-mono">supabase/schema.sql</code>{" "}
                di SQL Editor Supabase. Nomor di bawah tetap berfungsi, tapi belum bisa
                ditambah/dihapus dari sini.
              </p>
            </div>
          )}

          {overLimitIds.size > 0 && (
            <div className="flex items-start gap-2.5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl">
              <TriangleAlert className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-rose-900 leading-relaxed">
                Anda punya {devices.length} nomor, sedangkan paket <strong>{planName}</strong> mencakup{" "}
                {deviceLimit}. {overLimitIds.size} nomor bertanda{" "}
                <strong>di luar kuota</strong> tidak dibalas bot.{" "}
                <a href="/#harga" className="font-semibold text-rose-800 hover:underline">
                  Upgrade paket
                </a>{" "}
                atau hapus nomor tersebut.
              </p>
            </div>
          )}

          {/* Daftar nomor */}
          {devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-6 space-y-3">
              <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center">
                <QrCode className="w-10 h-10 text-slate-300" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-700">Belum ada nomor WhatsApp</p>
                <p className="text-xs text-slate-400 max-w-xs">
                  Tambahkan nomor toko Anda di bawah, lalu scan QR-nya untuk mengaktifkan bot.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {devices.map((device) => {
                const connected = isDeviceConnected(device);
                const key = device.id || device.phone;
                const showingQr = !!device.id && qrDeviceId === device.id && !!qrUrl;
                const busyRemoving = removingDeviceId === device.id;
                const overLimit = overLimitIds.has(key);

                return (
                  <li
                    key={key}
                    className={`border rounded-2xl overflow-hidden bg-white ${
                      overLimit ? "border-rose-200" : "border-slate-200"
                    }`}
                  >
                    <div className="p-4 flex flex-wrap items-center gap-3">
                      <div
                        className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${
                          connected && !overLimit ? "bg-brand-100" : "bg-slate-100"
                        }`}
                      >
                        {connected && !overLimit ? (
                          <CheckCircle className="w-5 h-5 text-brand-700" aria-hidden="true" />
                        ) : (
                          <Smartphone className="w-5 h-5 text-slate-400" aria-hidden="true" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-ink truncate">
                            {formatPhoneDisplay(device.phone)}
                          </p>
                          {device.is_primary && (
                            <span
                              title="Nomor utama — dipakai mengirim OTP reset kata sandi"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-bold uppercase tracking-wide text-amber-800"
                            >
                              <Star className="w-2.5 h-2.5" aria-hidden="true" />
                              Utama
                            </span>
                          )}
                          {overLimit && (
                            <span
                              title={`Melebihi kuota paket ${planName} — bot tidak membalas di nomor ini`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-bold uppercase tracking-wide text-rose-800"
                            >
                              <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                              Di luar kuota
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {device.label ? `${device.label} · ` : ""}
                          <span
                            className={
                              overLimit
                                ? "text-rose-700 font-medium"
                                : connected
                                ? "text-brand-700 font-medium"
                                : ""
                            }
                          >
                            {overLimit
                              ? "Tidak dilayani bot"
                              : connected
                              ? "Terhubung"
                              : "Belum terhubung"}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 ml-auto">
                        {!connected && !overLimit && (
                          <button
                            type="button"
                            onClick={() => onFetchQr(device)}
                            disabled={loadingQr}
                            className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                          >
                            {loadingQr && qrDeviceId === device.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{showingQr ? "Muat ulang" : "Scan QR"}</span>
                          </button>
                        )}
                        {!devicesNeedMigration && (
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveId(device.id || null)}
                            disabled={busyRemoving || confirmRemoveId === device.id}
                            title="Hapus nomor ini"
                            className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 disabled:opacity-60 transition-colors"
                          >
                            {busyRemoving ? (
                              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            )}
                            <span className="sr-only">Hapus nomor</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Diagnosa jalur TERIMA (Fonnte → aplikasi) */}
                    {connected && !overLimit && (
                      <InboundPanel
                        device={device}
                        expectedWebhookUrl={expectedWebhookUrl}
                        repairing={!!device.id && repairingDeviceId === device.id}
                        onRepair={() => onRepairDevice(device)}
                      />
                    )}

                    {/* Produk yang dijawab nomor ini (paket Pro: bagi tugas antar nomor) */}
                    {!!device.id && !devicesNeedMigration && !overLimit && (
                      <ScopePanel
                        key={`scope-${device.id}`}
                        device={device}
                        products={products}
                        multiNumberPlan={deviceLimit > 1}
                        saving={savingScopeId === device.id}
                        onSave={(ids) => onSaveScope(device.id!, ids)}
                      />
                    )}

                    {/* Konfirmasi hapus */}
                    {confirmRemoveId === device.id && (
                      <div className="px-4 pb-4 -mt-1">
                        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2.5">
                          <p className="text-xs text-rose-900 leading-relaxed">
                            Hapus <strong>{formatPhoneDisplay(device.phone)}</strong>? Bot berhenti
                            membalas di nomor ini dan perangkatnya ikut dihapus di Fonnte, jadi kalau
                            nanti ditambahkan lagi perlu scan QR baru. Riwayat chat tetap tersimpan.
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmRemoveId(null);
                                onRemoveDevice(device);
                              }}
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              Ya, hapus nomor
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* QR untuk nomor ini */}
                    {showingQr && (
                      <div className="px-4 pb-5 pt-1 border-t border-slate-100 bg-slate-50/60">
                        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 pt-4">
                          <div className="p-3 bg-white border-2 border-brand-200 rounded-3xl shadow-card shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={qrUrl!}
                              alt={`QR Code untuk menautkan ${device.phone}`}
                              className="w-48 h-48 object-contain"
                            />
                          </div>
                          <div className="min-w-0 space-y-3 text-center sm:text-left">
                            <div className="flex items-center justify-center sm:justify-start gap-2 text-xs font-medium text-brand-700">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              Menunggu Anda scan… status akan berubah otomatis.
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-sm font-semibold text-ink">Cara scan</p>
                              <ol className="text-xs text-slate-500 text-left list-decimal list-inside space-y-1">
                                <li>
                                  Buka <strong>WhatsApp</strong> di HP dengan nomor{" "}
                                  {formatPhoneDisplay(device.phone)}
                                </li>
                                <li>
                                  Ketuk menu <strong>⋮</strong> &rarr;{" "}
                                  <strong>Perangkat Tertaut</strong>
                                </li>
                                <li>
                                  Ketuk <strong>Tautkan Perangkat</strong>
                                </li>
                                <li>Arahkan kamera ke QR Code di samping</li>
                              </ol>
                            </div>
                            <div className="flex items-center justify-center sm:justify-start gap-4">
                              <button
                                type="button"
                                onClick={() => onFetchQr(device)}
                                disabled={loadingQr}
                                className="text-xs font-semibold text-brand-700 hover:underline disabled:opacity-60"
                              >
                                {loadingQr ? "Memuat ulang…" : "Muat ulang QR Code"}
                              </button>
                              <button
                                type="button"
                                onClick={onCancelQr}
                                className="text-xs font-medium text-slate-400 hover:text-slate-600"
                              >
                                Tutup
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Tambah nomor / upsell batas paket */}
          {atLimit && !devicesNeedMigration ? (
            <div className="flex items-start gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <Lock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-slate-500 leading-relaxed">
                {deviceLimit === 1 ? (
                  <>
                    Paket <strong>{planName}</strong> mendukung 1 nomor WhatsApp.{" "}
                    <a href="/#harga" className="font-semibold text-brand-700 hover:underline">
                      Upgrade ke Pro
                    </a>{" "}
                    untuk memakai sampai 3 nomor sekaligus.
                  </>
                ) : (
                  <>
                    Batas paket <strong>{planName}</strong> ({deviceLimit} nomor) sudah tercapai. Hapus
                    salah satu nomor bila ingin menggantinya.
                  </>
                )}
              </p>
            </div>
          ) : (
            canAdd && (
              <div className="pt-1">
                {addFormOpen ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                    <p className="text-sm font-semibold text-ink">Tambah nomor WhatsApp</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="new-device-phone"
                          className="block text-xs font-medium text-slate-600"
                        >
                          Nomor WhatsApp
                        </label>
                        <input
                          id="new-device-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="mis. 0812xxxxxxx"
                          value={newPhone}
                          onChange={(e) => setNewPhone(e.target.value)}
                          disabled={addingDevice}
                          className={inputCls}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="new-device-label"
                          className="block text-xs font-medium text-slate-600"
                        >
                          Nama/label <span className="text-slate-400">(opsional)</span>
                        </label>
                        <input
                          id="new-device-label"
                          type="text"
                          placeholder="mis. CS 1, Cabang Bandung"
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          disabled={addingDevice}
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Pastikan nomor ini aktif di WhatsApp dan belum dipakai di layanan gateway lain.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={onAddDevice}
                        disabled={addingDevice || !newPhone.trim()}
                        className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
                      >
                        {addingDevice ? (
                          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Plus className="w-4 h-4" aria-hidden="true" />
                        )}
                        <span>{addingDevice ? "Mendaftarkan…" : "Daftarkan nomor"}</span>
                      </button>
                      {devices.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAddForm(false)}
                          disabled={addingDevice}
                          className="text-xs font-medium text-slate-400 hover:text-slate-600"
                        >
                          Batal
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="w-full py-3 border-2 border-dashed border-slate-200 hover:border-brand-300 hover:bg-brand-50/40 text-sm font-semibold text-slate-500 hover:text-brand-700 rounded-2xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Tambah nomor ({devices.length}/{deviceLimit})
                  </button>
                )}
              </div>
            )
          )}

          {connectedDevices.length > 0 && (
            <div className="flex items-start gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Jangan keluarkan (log out) perangkat tertaut ini dari HP Anda — bot berhenti membalas
                di nomor tersebut. Jika terputus, tombol <strong>Scan QR</strong> muncul kembali.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Uji coba ─────────────────────────────────────────────────────
          PENTING: ini bukan simulasi lokal. Pesan balasan benar-benar
          DIKIRIM lewat WhatsApp ke nomor penguji dan memakai kuota.

          Perlu diketahui juga apa yang TIDAK diuji di sini: jalur pesan
          masuk. Uji coba ini memanggil AI dari server lalu mengirim lewat
          Fonnte, tanpa pernah melewati webhook — jadi ia bisa sukses
          sementara chat pembeli sungguhan tidak pernah sampai. Itu sebabnya
          panel "Jalur terima chat pembeli" di atas ada, dan itu yang
          disebutkan di catatan bawah. */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" aria-hidden="true" />
            Uji coba balasan AI
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Kirim pesan seolah-olah dari pembeli, lalu lihat bagaimana AI menjawab.
          </p>
        </div>

        <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
          <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-amber-900 leading-relaxed">
            Balasan AI <strong>benar-benar dikirim</strong> ke nomor penguji lewat WhatsApp dan memakai
            kuota pengiriman Anda. Gunakan nomor Anda sendiri untuk mengetes.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="test-phone" className="block text-xs font-medium text-slate-600">
              Nomor WA penguji
            </label>
            <input
              id="test-phone"
              type="tel"
              inputMode="tel"
              placeholder="08xxxxxxxxxx"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="test-message" className="block text-xs font-medium text-slate-600">
              Pesan dari pembeli
            </label>
            <input
              id="test-message"
              type="text"
              placeholder="mis. cek ongkir ke Bandung dong"
              value={testMessageText}
              onChange={(e) => setTestMessageText(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Pilih nomor pengirim hanya relevan bila toko punya lebih dari satu. */}
        {sendableDevices.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor="test-device" className="block text-xs font-medium text-slate-600">
              Kirim dari nomor
            </label>
            <select
              id="test-device"
              value={testDeviceId}
              onChange={(e) => setTestDeviceId(e.target.value)}
              className={inputCls}
            >
              {sendableDevices.map((d) => (
                <option key={d.id || d.phone} value={d.id || ""}>
                  {formatPhoneDisplay(d.phone)}
                  {d.label ? ` — ${d.label}` : ""}
                  {d.is_primary ? " (utama)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={onSendTest}
          disabled={sendingTest || sendableDevices.length === 0}
          title={
            sendableDevices.length === 0 ? "Hubungkan WhatsApp terlebih dahulu" : undefined
          }
          className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {sendingTest ? (
            <RefreshCw className="w-4 h-4 animate-spin text-brand-600" aria-hidden="true" />
          ) : (
            <Send className="w-4 h-4 text-brand-600" aria-hidden="true" />
          )}
          <span>{sendingTest ? "Mengirim…" : "Kirim pesan uji coba"}</span>
        </button>
        {sendableDevices.length === 0 && (
          <p className="text-[11px] text-slate-400 text-center">
            Hubungkan minimal satu nomor WhatsApp agar pesan uji coba bisa diproses.
          </p>
        )}
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Uji coba ini menguji <strong>jalur kirim</strong> (AI &rarr; WhatsApp). Untuk memastikan chat
          pembeli sungguhan sampai ke bot, lihat <strong>Jalur terima chat pembeli</strong> pada tiap
          nomor di atas.
        </p>
      </section>
    </div>
  );
}

/**
 * Kondisi jalur TERIMA satu nomor: apakah Fonnte akan meneruskan chat pembeli ke
 * aplikasi ini.
 *
 * Kenapa panel ini ada: "Uji coba balasan AI" hanya membuktikan jalur KIRIM
 * (server → Fonnte → pembeli). Kalau URL webhook belum terdaftar atau `auto read`
 * di Fonnte mati, uji coba itu tetap sukses sementara chat pembeli sungguhan tidak
 * pernah tiba — bot tampak sehat tapi bisu, dan satu-satunya gejala yang terlihat
 * pemilik toko adalah kesunyian. Panel ini yang membedakan "belum ada yang chat"
 * dari "chat tidak pernah sampai".
 */
function InboundPanel({
  device,
  expectedWebhookUrl,
  repairing,
  onRepair
}: {
  device: StoreDevice;
  expectedWebhookUrl?: string | null;
  repairing: boolean;
  onRepair: () => void;
}) {
  const ready = isInboundReady(device);
  const tone =
    ready === true
      ? { box: "bg-brand-50/50 border-brand-100", text: "text-brand-800" }
      : ready === false
      ? { box: "bg-rose-50 border-rose-200", text: "text-rose-900" }
      : { box: "bg-slate-50 border-slate-200", text: "text-slate-600" };

  const webhookOk = device.webhook_synced === true;
  const autoreadOk = device.autoread === true;

  return (
    <div className="px-4 pb-4 -mt-1">
      <div className={`p-3.5 border rounded-xl space-y-2.5 ${tone.box}`}>
        <div className="flex items-start justify-between gap-3">
          <p className={`text-xs font-semibold flex items-center gap-1.5 ${tone.text}`}>
            <Inbox className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Jalur terima chat pembeli
            {ready === true ? " · siap" : ready === false ? " · belum siap" : " · belum diperiksa"}
          </p>
          {ready !== true && !!device.id && (
            <button
              type="button"
              onClick={onRepair}
              disabled={repairing}
              className="shrink-0 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700 disabled:opacity-60 transition-colors flex items-center gap-1.5"
            >
              {repairing ? (
                <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <Wrench className="w-3 h-3" aria-hidden="true" />
              )}
              <span>{repairing ? "Memperbaiki…" : "Perbaiki otomatis"}</span>
            </button>
          )}
        </div>

        <dl className="space-y-1.5 text-[11px]">
          <div className="flex items-start gap-1.5">
            <StatusDot ok={device.inbound_checked ? webhookOk : null} />
            <dt className="text-slate-500 shrink-0">URL webhook:</dt>
            <dd className={webhookOk ? "text-slate-600" : "font-medium text-rose-800"}>
              {!device.inbound_checked
                ? "belum dibaca dari Fonnte"
                : webhookOk
                ? "terdaftar di Fonnte"
                : "belum terdaftar / tidak cocok"}
            </dd>
          </div>
          <div className="flex items-start gap-1.5">
            <StatusDot ok={autoreadOk ? true : device.autoread === false ? false : null} />
            <dt className="text-slate-500 shrink-0">Auto read Fonnte:</dt>
            <dd
              className={
                device.autoread === false ? "font-medium text-rose-800" : "text-slate-600"
              }
            >
              {device.autoread === true
                ? "menyala"
                : device.autoread === false
                ? "mati — wajib menyala, tanpa ini Fonnte tidak meneruskan pesan"
                : "belum diketahui"}
            </dd>
          </div>
          <div className="flex items-start gap-1.5">
            <StatusDot ok={device.last_inbound_at ? true : null} />
            <dt className="text-slate-500 shrink-0">Pesan masuk terakhir:</dt>
            <dd className="text-slate-600">
              {device.last_inbound_at ? (
                <>
                  {relativeTime(device.last_inbound_at)}
                  {device.last_inbound_note ? ` · ${device.last_inbound_note}` : ""}
                </>
              ) : (
                "belum pernah ada chat pembeli yang sampai ke aplikasi"
              )}
            </dd>
          </div>
        </dl>

        {device.inbound_repaired && (
          <p className="text-[11px] text-brand-800">
            Setelan baru saja diperbaiki otomatis. Coba kirim chat dari nomor lain ke nomor ini untuk
            memastikan bot menjawab.
          </p>
        )}

        {device.inbound_error && (
          <p className="text-[11px] font-medium text-rose-800">{device.inbound_error}</p>
        )}

        {expectedWebhookUrl && (
          <p
            className="text-[10px] text-slate-400 font-mono truncate"
            title={expectedWebhookUrl}
          >
            {expectedWebhookUrl}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Produk yang DIJAWAB satu nomor WhatsApp.
 *
 * Gunanya di paket Pro (3 nomor): satu nomor bisa dikhususkan untuk sebagian
 * katalog, mis. nomor 1 untuk produk A & B, nomor 2 untuk B, nomor 3 untuk C & D.
 * Katalog yang masuk ke prompt AI ikut dipersempit, jadi bot tidak menawarkan
 * barang yang bukan urusan nomor itu.
 *
 * `[]` berarti "nomor umum" — seluruh katalog. Itu default-nya, dan sengaja:
 * nomor baru yang tiba-tiba tidak mengenali produk apa pun jauh lebih merugikan
 * daripada nomor yang menjawab terlalu luas.
 */
function ScopePanel({
  device,
  products,
  multiNumberPlan,
  saving,
  onSave
}: {
  device: StoreDevice;
  products: Product[];
  /** Paket dengan lebih dari satu nomor — di Starter fitur ini tak ada gunanya. */
  multiNumberPlan: boolean;
  saving: boolean;
  onSave: (productIds: string[]) => void;
}) {
  const scope = (device.product_ids || []).filter((id) => !!id);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(scope);

  // Di Starter (1 nomor) panel ini hanya jadi kebisingan — kecuali toko itu
  // pernah di Pro dan masih menyimpan batasan yang harus bisa dilepas kembali.
  if (!multiNumberPlan && scope.length === 0) return null;
  if (products.length === 0) return null;

  const named = products.filter((p) => p.id && scope.includes(p.id));
  // Id yang tersisa tapi produknya sudah dihapus dari katalog: jangan diam-diam
  // dibuang dari tampilan, pemilik toko perlu tahu daftarnya sudah tidak utuh.
  const missingCount = scope.length - named.length;

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="px-4 pb-4 -mt-1">
      <div className="p-3.5 border border-slate-200 bg-slate-50 rounded-xl space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Produk yang dijawab nomor ini
          </p>
          {!open && (
            <button
              type="button"
              onClick={() => {
                setDraft(scope);
                setOpen(true);
              }}
              className="shrink-0 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700 transition-colors"
            >
              Atur
            </button>
          )}
        </div>

        {!open ? (
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {scope.length === 0 ? (
              <>
                <strong>Semua produk</strong> — nomor umum, bot menjawab seluruh katalog.
              </>
            ) : (
              <>
                {named.map((p) => p.name).join(", ") || "—"}
                {missingCount > 0 && (
                  <span className="text-amber-700">
                    {" "}
                    (+{missingCount} produk yang sudah dihapus dari katalog)
                  </span>
                )}
              </>
            )}
          </p>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Centang produk yang boleh ditawarkan lewat nomor ini. Tanpa centang sama sekali,
              nomor ini menjadi <strong>nomor umum</strong> dan menjawab seluruh katalog.
            </p>

            <fieldset className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              <legend className="sr-only">
                Produk yang dijawab {formatPhoneDisplay(device.phone)}
              </legend>
              {products.map((p) => {
                if (!p.id) return null;
                const id = p.id;
                const inputId = `scope-${device.id}-${id}`;
                return (
                  <label
                    key={id}
                    htmlFor={inputId}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-brand-200"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={draft.includes(id)}
                      onChange={() => toggle(id)}
                      disabled={saving}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                    />
                    <span className="text-[11px] text-ink truncate">{p.name}</span>
                  </label>
                );
              })}
            </fieldset>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onSave(draft);
                  setOpen(false);
                }}
                disabled={saving}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-[11px] font-semibold rounded-lg transition-colors flex items-center gap-1.5"
              >
                {saving && <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />}
                <span>{saving ? "Menyimpan…" : "Simpan"}</span>
              </button>
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraft([])}
                  disabled={saving}
                  className="text-[11px] font-medium text-slate-500 hover:text-ink"
                >
                  Jadikan nomor umum
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraft(scope);
                  setOpen(false);
                }}
                disabled={saving}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600 ml-auto"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Titik status kecil: hijau = beres, merah = bermasalah, abu = belum diketahui. */
function StatusDot({ ok }: { ok: boolean | null }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
        ok === true ? "bg-brand-500" : ok === false ? "bg-rose-500" : "bg-slate-300"
      }`}
    />
  );
}
