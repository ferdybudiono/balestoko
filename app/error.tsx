"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";

/**
 * Batas error untuk seluruh `app/` — termasuk `/dashboard` (1.500+ baris) dan
 * halaman pemasaran.
 *
 * Sebelum file ini ada, satu `throw` saat render menampilkan layar error bawaan
 * Next: latar putih, teks hitam, tanpa gaya, tanpa jalan pulang, dan di produksi
 * tanpa satu pun keterangan. Pemilik toko yang melihatnya tidak punya cara tahu
 * apakah datanya hilang atau hanya halamannya yang gagal dirender.
 *
 * `reset()` merender ulang segmennya TANPA memuat ulang halaman, jadi sesi dan
 * state di atasnya tetap utuh — itu sebabnya tombol pertamanya ini, bukan
 * "refresh".
 *
 * `digest` adalah satu-satunya penghubung ke log server: di produksi Next
 * menyembunyikan pesan aslinya (bisa memuat detail internal) dan hanya
 * menyisakan hash ini. Ditampilkan supaya pemilik toko bisa menyebutkannya saat
 * melapor — tanpa itu, "dashboard saya error" tidak bisa ditelusuri.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Titik sambung monitoring (Sentry) nanti. Untuk sekarang minimal ia
    // mendarat di console browser, bukan hilang sama sekali.
    console.error("[app error]", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4 py-16">
      <div
        role="alert"
        className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-card p-6 sm:p-8 text-center"
      >
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <TriangleAlert className="w-6 h-6 text-red-600" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-bold text-ink mb-2">Halaman ini gagal ditampilkan</h1>
        <p className="text-sm text-ink-muted leading-relaxed">
          Kesalahan terjadi saat menyiapkan tampilan — bukan pada data Anda.
          Pesanan, produk, dan percakapan tetap tersimpan.
        </p>

        {error.digest && (
          <p className="mt-4 text-xs text-ink-muted">
            Kode kesalahan:{" "}
            <span className="font-mono text-ink-soft break-all">{error.digest}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Coba tampilkan lagi
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-ink-soft transition-colors"
          >
            Ke dashboard
          </Link>
        </div>

        <p className="mt-5 text-xs text-ink-muted">
          Masih gagal?{" "}
          <Link href="/" className="font-semibold text-brand-700 hover:underline">
            kembali ke halaman utama
          </Link>{" "}
          atau hubungi kami lewat WhatsApp di footer.
        </p>
      </div>
    </main>
  );
}
