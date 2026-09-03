"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Jaring terakhir: error yang terjadi DI DALAM root layout, sebelum `error.tsx`
 * punya tempat untuk dirender.
 *
 * Karena ia mengganti root layout, file ini WAJIB merender `<html>` dan `<body>`
 * sendiri — dan itu juga sebabnya `globals.css` diimpor di sini: tanpa impor
 * itu, tidak satu pun kelas Tailwind di bawah punya arti.
 *
 * Font `--font-sans` sengaja tidak dipakai (ia lahir di root layout yang justru
 * sedang gagal); `font-sans` Tailwind jatuh ke `system-ui`, yang selalu ada.
 * Kasus ini nyaris tidak pernah terjadi — dan justru karena itu, ia harus tetap
 * bisa dibaca ketika terjadi.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="id">
      <body>
        <main className="min-h-screen bg-white flex items-center justify-center px-4 py-16">
          <div
            role="alert"
            className="w-full max-w-md border border-slate-200 rounded-2xl p-6 sm:p-8 text-center"
          >
            <h1 className="text-xl font-bold text-ink mb-2">Aplikasi gagal dimuat</h1>
            <p className="text-sm text-ink-muted leading-relaxed">
              Terjadi kesalahan sebelum halaman selesai disiapkan. Data Anda tidak
              terpengaruh.
            </p>

            {error.digest && (
              <p className="mt-4 text-xs text-ink-muted">
                Kode kesalahan:{" "}
                <span className="font-mono text-ink-soft break-all">{error.digest}</span>
              </p>
            )}

            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
            >
              Muat ulang aplikasi
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
