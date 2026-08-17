"use client";

import {
  CheckCircle,
  Info,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import type { FonnteStatus } from "./types";
import { formatPhoneDisplay } from "./types";

interface WhatsappTabProps {
  fonnteStatus: FonnteStatus;
  hasFonnteToken: boolean;
  connectPhone: string;
  setConnectPhone: (v: string) => void;
  qrUrl: string | null;
  loadingQr: boolean;
  onFetchQr: () => void;
  /** Menghentikan polling QR & menyembunyikan QR. */
  onCancelQr: () => void;
  testPhone: string;
  setTestPhone: (v: string) => void;
  testMessageText: string;
  setTestMessageText: (v: string) => void;
  sendingTest: boolean;
  onSendTest: () => void;
}

export default function WhatsappTab({
  fonnteStatus,
  hasFonnteToken,
  connectPhone,
  setConnectPhone,
  qrUrl,
  loadingQr,
  onFetchQr,
  onCancelQr,
  testPhone,
  setTestPhone,
  testMessageText,
  setTestMessageText,
  sendingTest,
  onSendTest
}: WhatsappTabProps) {
  const connected = fonnteStatus.status;
  const inputCls =
    "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-60";

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card overflow-hidden">
        <div className="px-5 sm:px-6 pt-6 pb-4">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Hubungkan WhatsApp toko
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Scan QR sekali untuk menautkan nomor WhatsApp toko. Setelah terhubung, pesan pembeli
            otomatis dijawab AI.
          </p>
        </div>

        <div className="px-5 sm:px-6 pb-6">
          {connected ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-brand-50 border border-brand-200 rounded-2xl">
                <div className="w-10 h-10 shrink-0 rounded-full bg-brand-100 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-brand-700" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-900">WhatsApp sudah terhubung</p>
                  <p className="text-xs text-brand-800/80 mt-0.5">
                    Bot AI dan cek ongkir otomatis aktif menerima pesan pembeli.
                  </p>
                  {connectPhone && (
                    <p className="text-xs text-brand-800/70 mt-1.5">
                      Nomor device: <strong>{formatPhoneDisplay(connectPhone)}</strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Jangan keluarkan (log out) perangkat tertaut ini dari HP Anda — bot akan berhenti
                  membalas. Jika terputus, status di atas berubah dan QR baru bisa dimunculkan lagi.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-4 space-y-5">
              {/* Alasan dari Fonnte — sebelumnya di-fetch tapi tidak pernah ditampilkan. */}
              {fonnteStatus.reason && (
                <div className="w-full flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-left">
                  <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="text-xs text-amber-900 leading-relaxed">
                    Status device: <strong>{fonnteStatus.device || "tidak diketahui"}</strong> —{" "}
                    {fonnteStatus.reason}
                  </p>
                </div>
              )}

              <div className="w-full max-w-sm text-left space-y-1.5">
                <label
                  htmlFor="connect-phone"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Nomor WhatsApp yang ingin dihubungkan
                </label>
                <input
                  id="connect-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="mis. 0812xxxxxxx"
                  value={connectPhone}
                  onChange={(e) => setConnectPhone(e.target.value)}
                  disabled={hasFonnteToken}
                  className={inputCls}
                />
                <p className="text-[11px] text-slate-400">
                  {hasFonnteToken
                    ? "Device sudah dibuat untuk nomor ini. Scan QR di bawah untuk menautkan."
                    : "Nomor ini akan didaftarkan sebagai device WhatsApp khusus toko Anda."}
                </p>
              </div>

              {qrUrl ? (
                <>
                  <div className="p-4 bg-white border-2 border-brand-200 rounded-3xl shadow-card-lg inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrUrl} alt="QR Code untuk menautkan WhatsApp" className="w-56 h-56 object-contain" />
                  </div>

                  <div className="flex items-center gap-2 text-xs font-medium text-brand-700">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Menunggu Anda scan… halaman ini akan otomatis lanjut.
                  </div>

                  <div className="space-y-2 max-w-sm">
                    <p className="text-sm font-semibold text-ink">Cara scan</p>
                    <ol className="text-xs text-slate-500 text-left list-decimal list-inside space-y-1">
                      <li>Buka <strong>WhatsApp</strong> di HP toko Anda</li>
                      <li>Ketuk menu <strong>⋮</strong> &rarr; <strong>Perangkat Tertaut</strong></li>
                      <li>Ketuk <strong>Tautkan Perangkat</strong></li>
                      <li>Arahkan kamera ke QR Code di atas</li>
                    </ol>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={onFetchQr}
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
                      Batalkan
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center">
                    <QrCode className="w-10 h-10 text-slate-300" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-700">WhatsApp belum terhubung</p>
                    <p className="text-xs text-slate-400 max-w-xs">
                      Tampilkan QR Code, lalu scan dari HP toko Anda untuk mengaktifkan bot.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onFetchQr}
                    disabled={loadingQr}
                    className="px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors shadow-card flex items-center gap-2"
                  >
                    {loadingQr ? (
                      <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <QrCode className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>{loadingQr ? "Memuat QR Code…" : "Tampilkan QR Code"}</span>
                  </button>
                </>
              )}
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

        <button
          type="button"
          onClick={onSendTest}
          disabled={sendingTest || !connected}
          title={connected ? undefined : "Hubungkan WhatsApp terlebih dahulu"}
          className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {sendingTest ? (
            <RefreshCw className="w-4 h-4 animate-spin text-brand-600" aria-hidden="true" />
          ) : (
            <Send className="w-4 h-4 text-brand-600" aria-hidden="true" />
          )}
          <span>{sendingTest ? "Mengirim…" : "Kirim pesan uji coba"}</span>
        </button>
        {!connected && (
          <p className="text-[11px] text-slate-400 text-center">
            Hubungkan WhatsApp terlebih dahulu agar pesan uji coba bisa diproses.
          </p>
        )}
      </section>
    </div>
  );
}
