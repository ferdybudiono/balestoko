import Link from "next/link";
import { Compass, LayoutDashboard, MessageCircle } from "lucide-react";

/**
 * 404 milik aplikasi.
 *
 * Sebelumnya URL salah di bawah `/dashboard/*` — dan URL lama yang dibagikan di
 * WhatsApp — mendarat di layar 404 bawaan Next: satu baris hitam-putih tanpa
 * satu pun tautan. Untuk produk yang jalur distribusinya berbagi tautan, itu
 * ujung jalan buntu di tempat yang paling mahal.
 *
 * Dua tautan keluar, bukan satu: yang mengetik URL dashboard salah butuh
 * `/dashboard`, sedangkan yang datang dari tautan basi butuh `/`.
 */
export const metadata = {
  title: "Halaman tidak ditemukan — BalesToko.ai",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
          <Compass className="w-6 h-6 text-brand-600" aria-hidden="true" />
        </div>

        <p className="text-sm font-semibold text-brand-700 mb-1">404</p>
        <h1 className="text-2xl font-bold text-ink mb-2">Halaman ini tidak ada</h1>
        <p className="text-sm text-ink-muted leading-relaxed">
          Alamatnya mungkin salah ketik, atau halamannya sudah dipindahkan.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
            Ke dashboard
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-ink-soft transition-colors"
          >
            <MessageCircle className="w-4 h-4" aria-hidden="true" />
            Halaman utama
          </Link>
        </div>
      </div>
    </main>
  );
}
