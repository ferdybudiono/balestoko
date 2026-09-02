/**
 * Kebijakan panjang kata sandi — SATU angka untuk seluruh aplikasi.
 *
 * KENAPA MODULNYA SENDIRI, bukan di `lib/auth.ts`: angka ini dipakai juga oleh
 * komponen client (`TrialModal`, `CheckoutModal`, `TeamMembers`) supaya validasi
 * di browser dan di server tidak pernah berbeda. `lib/auth.ts` mengimpor
 * `crypto` Node dan `next/headers`, dan modul ini membaca `process.env`
 * `AUTH_SECRET` lewat `lib/session-constants.ts` — dua hal yang tidak boleh
 * ikut terbawa ke bundle browser. Modul ini sengaja tanpa impor apa pun.
 *
 * KENAPA ANGKANYA DISATUKAN: sebelumnya pemilik toko divalidasi 6 karakter
 * (`register-trial`, `checkout`, `reset/confirm`) sementara anggota tim 8, dan
 * route ganti kata sandi yang baru juga 8. Akibatnya orang bisa mendaftar dengan
 * 6 karakter lalu ditolak saat ingin menggantinya — aturan yang berubah di
 * tengah jalan tanpa alasan yang bisa dijelaskan ke pengguna.
 *
 * Menaikkan batas ke 8 TIDAK membatalkan kata sandi yang sudah ada: `login`
 * hanya memverifikasi hash, tidak pernah memeriksa panjang. Aturan ini hanya
 * berlaku saat kata sandi dibuat atau diganti.
 */

/** Panjang minimum kata sandi baru, untuk pemilik toko maupun anggota tim. */
export const MIN_PASSWORD = 8;

/** Pesan galat standar, supaya angkanya tidak pernah ditulis ulang manual. */
export function minPasswordError(subject = "Kata sandi"): string {
  return `${subject} minimal ${MIN_PASSWORD} karakter.`;
}
