import { fileURLToPath } from "node:url";
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
 *
 * Alias `@/` harus dinyatakan ulang di sini: vitest tidak membaca `paths` dari
 * `tsconfig.json`, jadi tanpa baris ini modul mana pun yang mengimpor lewat
 * `@/lib/...` (mis. `lib/supabase.ts`) gagal di-resolve saat tes — dan modul
 * itulah yang justru paling perlu diuji.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
});
