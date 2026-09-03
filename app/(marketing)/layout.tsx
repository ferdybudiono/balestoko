import Script from "next/script";

/**
 * Layout halaman pemasaran — satu-satunya tempat Midtrans Snap.js dimuat.
 *
 * Sebelumnya skrip ini ada di `app/layout.tsx`, jadi ia terpasang di SETIAP
 * route: `/login`, `/reset-password`, dan seluruh `/dashboard` ikut mengunduh
 * dan menjalankan skrip pihak ketiga yang tidak satu pun dari mereka pakai.
 * `window.snap` hanya dipanggil dari `components/CheckoutModal.tsx`, dan modal
 * itu hanya dirender dari halaman pemasaran di grup ini.
 *
 * Dua alasan pemindahannya, dan yang kedua yang lebih penting: halaman yang
 * memproses kata sandi tidak lagi menjalankan skrip pihak ketiga, dan CSP yang
 * nanti ditulis (`next.config.js`) bisa mengizinkan domain Midtrans HANYA di
 * sini alih-alih di seluruh aplikasi.
 *
 * Grup `(marketing)` tidak muncul di URL — halaman di dalamnya tetap `/`.
 *
 * Ini komponen SERVER, dan itu memang syaratnya: `MIDTRANS_IS_PRODUCTION` bukan
 * variabel `NEXT_PUBLIC_*`, jadi nilainya tidak pernah sampai ke browser. Kalau
 * blok ini dipindah ke komponen klien, `isProduction` akan selalu `false` dan
 * produksi diam-diam memakai Snap sandbox — pembayaran sungguhan tidak akan
 * pernah mendarat.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const snapUrl = isProduction
    ? "https://app.midtrans.com/snap/snap.js"
    : "https://app.sandbox.midtrans.com/snap/snap.js";
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? "";

  return (
    <>
      {children}

      {/* Menyediakan window.snap untuk pop-up pembayaran di CheckoutModal. */}
      <Script src={snapUrl} data-client-key={clientKey} strategy="afterInteractive" />
    </>
  );
}
