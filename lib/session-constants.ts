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
 * `undefined` = tidak ada rahasia sungguhan yang tersedia. Pemanggil yang
 * memutuskan apa artinya: `lib/auth.ts` melempar di produksi, `middleware.ts`
 * memperlakukan pengunjung sebagai belum login.
 *
 * Fallback ke service role key dipertahankan supaya sesi yang sudah terbit tidak
 * langsung batal saat `AUTH_SECRET` ditambahkan. Bukan praktik yang baik —
 * merotasi kunci database ikut memaksa semua user login ulang, dan satu rahasia
 * dipakai untuk dua tujuan berbeda.
 */
export function resolveSessionSecret(): string | undefined {
  return process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || undefined;
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
