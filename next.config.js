/** @type {import('next').NextConfig} */

/**
 * Header keamanan untuk SEMUA respons.
 *
 * Sebelumnya file ini hanya berisi `reactStrictMode` — nol header. Aplikasi ini
 * memuat skrip pihak ketiga (Midtrans Snap) dan merender gambar dari input
 * tenant, jadi absennya header di sini bukan kelalaian teoretis.
 *
 * Yang SENGAJA belum ada di sini: `Content-Security-Policy` penuh. CSP yang
 * salah setel mematikan pembayaran dan font tanpa gejala selain pop-up yang
 * tidak muncul, dan ia perlu ditulis setelah Snap.js tidak lagi dimuat di semua
 * route (lihat `app/page.tsx`). Yang sudah dipasang di bawah adalah satu
 * direktif `frame-ancestors` — CSP yang hanya memuat satu direktif TIDAK
 * membatasi apa pun selain direktif itu, jadi ia aman berdiri sendiri.
 */
const securityHeaders = [
  // Paksa HTTPS pada kunjungan berikutnya. `preload` sengaja TIDAK dipakai:
  // masuk daftar preload browser praktis tidak bisa dibatalkan cepat, dan itu
  // keputusan pemilik domain — bukan default yang pantas dipasang diam-diam.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // Jangan menebak tipe konten. Melindungi endpoint yang mengembalikan JSON
  // dari dieksekusi sebagai skrip saat dibuka langsung di tab.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Anti clickjacking. Dashboard toko tidak pernah perlu di-embed orang lain.
  // Snap tetap jalan: ini membatasi HALAMAN INI di-iframe, bukan iframe yang
  // kita buka.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Jangan bocorkan path saat pengguna menekan tautan keluar — URL dashboard
  // memuat tab dan id yang tidak perlu diketahui situs tujuan.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Tidak ada satu pun fitur ini dipakai (QR WhatsApp ditampilkan sebagai
  // gambar, bukan dipindai dari kamera), jadi cabut semuanya. `payment` TIDAK
  // ikut dicabut: Snap berjalan di dalam iframe Midtrans, dan mencabut fitur
  // yang mungkin dipakainya berarti menaruh risiko di jalur pembayaran demi
  // pengetatan yang tidak melindungi apa pun di sini.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Jangan iklankan versi Next di setiap respons.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
