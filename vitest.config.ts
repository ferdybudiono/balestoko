import { defineConfig } from "vitest/config";

/**
 * Konfigurasi tes unit.
 *
 * Cakupannya SENGAJA dibatasi ke `lib/` — modul murni yang menghitung angka
 * yang dikirim ke pembeli (subtotal, berat paket, tarif ongkir, kuota paket).
 * Di situlah kesalahan paling mahal: salah satu angka meleset berarti toko
 * mengutip harga yang salah ke pelanggan sungguhan, dan tidak ada layar yang
 * menahannya lebih dulu.
 *
 * Komponen React tidak ikut diuji di sini karena butuh jsdom + testing-library;
 * `tsc --noEmit` dan `next build` sudah menjaga sisi itu dari galat tipe.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
});
