"use client";

import { useState } from "react";
import {
  CheckCircle,
  Info,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Lock
} from "lucide-react";
import type { StoreDevice } from "./types";
import { formatPhoneDisplay, isDeviceConnected } from "./types";

interface WhatsappTabProps {
  devices: StoreDevice[];
  /** Batas nomor sesuai paket (Starter 1, Pro 3) — ditegakkan juga di server. */
  deviceLimit: number;
  planName: string;
  /** Tabel `store_devices` belum ada/terisi: nomor tampil read-only. */
  devicesNeedMigration: boolean;
  refreshingDevices: boolean;
  onRefreshDevices: () => void;

  newPhone: string;
  setNewPhone: (v: string) => void;
  newLabel: string;
  setNewLabel: (v: string) => void;
  addingDevice: boolean;
  onAddDevice: () => void;
  removingDeviceId: string | null;
  onRemoveDevice: (device: StoreDevice) => void;

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
  newPhone,
  setNewPhone,
  newLabel,
  setNewLabel,
  addingDevice,
  onAddDevice,
  removingDeviceId,
  onRemoveDevice,
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
            title="Segarkan status koneksi tiap nomor"
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

                    {/* Konfirmasi hapus */}
                    {confirmRemoveId === device.id && (
                      <div className="px-4 pb-4 -mt-1">
                        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2.5">
                          <p className="text-xs text-rose-900 leading-relaxed">
                            Hapus <strong>{formatPhoneDisplay(device.phone)}</strong>? Bot berhenti
                            membalas di nomor ini dan tautan perangkat WhatsApp-nya dilepas. Riwayat
                            chat tetap tersimpan.
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
          DIKIRIM lewat WhatsApp ke nomor penguji dan memakai kuota. */}
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
      </section>
    </div>
  );
}
