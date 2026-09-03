/**
 * Konstanta sesi yang dipakai BERSAMA oleh Edge middleware dan route Node.
 *
 * EDGE-SAFE: modul ini tidak boleh mengimpor `crypto` Node, `next/headers`, atau
 * apa pun dari `lib/supabase.ts`. `middleware.ts` berjalan di Edge runtime dan
 * akan gagal build kalau salah satu ikut terbawa.
 *
 * KENAPA ADA: nama cookie dan urutan resolusi kunci HMAC sebelumnya ditulis dua
 * kali — sekali di `lib/auth.ts`, sekali di `middleware.ts` — dengan komentar di
 * kedua tempat yang saling mengingatkan agar tetap sama. Kalau salah satu berubah
 * sendiri, cookie yang diterbitkan `lib/auth.ts` akan ditolak middleware dan
 * SELURUH pengguna terlempar ke `/login` tanpa ada yang tampak salah di log.
 * Satu sumber kebenaran menghilangkan kelas kegagalan itu.
 */

/** Nama cookie httpOnly berisi token sesi. */
export const SESSION_COOKIE = "bt_session";

/** Umur token sesi. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 hari

/**
 * Kunci HMAC yang dipakai untuk menandatangani/memverifikasi token sesi.
 *
 * SATU sumber, tanpa cadangan: `AUTH_SECRET` atau tidak ada. `undefined` berarti
 * tidak ada rahasia sungguhan yang tersedia, dan pemanggil yang memutuskan
 * artinya — `lib/auth.ts` melempar di produksi, `middleware.ts` memperlakukan
 * pengunjung sebagai belum login. Keduanya gagal-TERTUTUP.
 *
 * Dulu di sini ada cadangan `|| process.env.SUPABASE_SERVICE_ROLE_KEY`, dipasang
 * agar sesi yang sudah terbit tidak langsung batal pada hari `AUTH_SECRET`
 * diperkenalkan. Migrasi itu sudah lama lewat dan cadangannya menyisakan dua
 * masalah: satu rahasia memikul dua tujuan (tanda tangan sesi DAN akses penuh
 * database, sehingga bocornya salah satu berarti bocornya keduanya), dan
 * merotasi kunci database — tindakan yang justru dilakukan saat curiga ada
 * kebocoran — ikut melogout seluruh pengguna tanpa sebab yang terlihat.
 *
 * KONSEKUENSI YANG HARUS DIKETAHUI SEBELUM DEPLOY: tanpa `AUTH_SECRET` di
 * environment produksi, tidak ada sesi yang bisa diterbitkan MAUPUN diverifikasi
 * — login gagal dan seluruh akses dashboard dialihkan ke `/login`. Isi variabel
 * itu lebih dulu (`openssl rand -hex 32`). Mengisi atau mengubahnya juga
 * membatalkan semua sesi yang sedang berjalan satu kali; itu memang harga
 * rotasi kunci, bukan bug.
 */
export function resolveSessionSecret(): string | undefined {
  // `.trim()` mengikuti pola `FONNTE_WEBHOOK_SECRET`/`CRON_SECRET` di route lain,
  // dan menutup dua kasus yang sama-sama nyata: `AUTH_SECRET=` tanpa nilai (bentuk
  // baris ini di `.env.example`, jadi deployment yang menyalinnya apa adanya harus
  // dianggap BELUM diisi, bukan memakai kunci kosong), dan spasi/newline yang ikut
  // ter-paste di dashboard Vercel — tanpa trim, nilai "abc" dan "abc " adalah dua
  // kunci berbeda dan membetulkan paste-nya melogout semua orang.
  const secret = (process.env.AUTH_SECRET || "").trim();
  return secret.length > 0 ? secret : undefined;
}

/**
 * Kunci pengganti untuk development saja.
 *
 * Nilainya ada di dalam repo, jadi siapa pun bisa memalsukan cookie sesi untuk
 * email mana pun. Tidak boleh dipakai di produksi.
 */
export const DEV_SESSION_SECRET = "dev-insecure-secret-change-me";

/**
 * Perbandingan string konstan-waktu untuk tanda tangan.
 *
 * `a !== b` berhenti pada byte pertama yang berbeda, jadi lama pembandingannya
 * membocorkan berapa banyak byte awal tanda tangan yang sudah benar. Itu cukup
 * untuk menyusun tanda tangan sah byte demi byte tanpa pernah tahu kuncinya.
 *
 * Web Crypto tidak punya `timingSafeEqual` (itu API Node, dan Edge runtime tidak
 * menyediakannya), jadi perbandingannya ditulis manual: seluruh byte selalu
 * di-XOR ke satu akumulator, tanpa jalan keluar lebih awal.
 *
 * Panjang yang berbeda tetap dijawab lebih cepat — dan itu tidak masalah:
 * panjang tanda tangan HMAC-SHA256 base64url selalu 43 karakter dan bukan rahasia.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
