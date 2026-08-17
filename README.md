# BotWA — Landing Page CS WhatsApp AI + Cek Ongkir Otomatis

Landing page SaaS satu halaman yang modern, clean, dan konvertif untuk produk
**Bot WA CS AI + Cek Ongkir Otomatis**. Dibangun dengan **Next.js (App Router)**,
**Tailwind CSS**, dan **Lucide Icons**, lengkap dengan integrasi pembayaran
**Midtrans Snap** dan penyimpanan order ke **Supabase**.

---

## ✨ Fitur

- **Hero section** dengan headline catchy, CTA utama, dan mockup chat WhatsApp interaktif.
- **Fitur unggulan**: Balas Chat Otomatis 24/7, Cek Ongkir Real-time (API Mengantar), AI Agent Pintar.
- **Cara kerja**, **testimoni**, dan **FAQ** untuk membangun kepercayaan.
- **Pricing table** — paket **Starter** & **Pro**.
- **Form modal checkout** singkat: Nama Lengkap, Nomor WhatsApp, Email, Nama Toko.
- **Integrasi Midtrans Snap**: `/api/checkout` membuat Snap Token lalu memicu pop-up pembayaran di browser.
- **Order tersimpan ke Supabase** berstatus `PENDING`, lalu diperbarui otomatis lewat **webhook** Midtrans.

---

## 🚀 Cara Menjalankan

### 1. Install dependency

```bash
npm install
```

### 2. Siapkan environment variables

Salin `.env.example` menjadi `.env.local`, lalu isi kuncinya:

```bash
cp .env.example .env.local
```

| Variabel | Keterangan |
|---|---|
| `MIDTRANS_SERVER_KEY` | Server Key dari Midtrans (server-only). |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | Client Key dari Midtrans (dipakai Snap.js di browser). |
| `MIDTRANS_IS_PRODUCTION` | `false` untuk sandbox, `true` untuk production. |
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role key Supabase (**server-only**, jangan diekspos!). |
| `NEXT_PUBLIC_BASE_URL` | Base URL publik aplikasi (untuk callback Snap). |
| `AUTH_SECRET` | Kunci HMAC penandatangan session login. **Wajib di produksi.** |
| `FONNTE_TOKEN` | Account Token Fonnte (untuk provisioning device per toko). |
| `FONNTE_WEBHOOK_SECRET` | Shared secret pelindung `/api/fonnte/webhook`. **Sangat disarankan di produksi** — tanpa ini endpoint terbuka dan bisa dipakai sebagai relay spam. |
| `GEMINI_API_KEY` | API key Gemini untuk balasan AI. |

> 🔑 Ambil kunci Midtrans di **Dashboard → Settings → Access Keys**.
> Ambil kunci Supabase di **Project Settings → API**.

### 3. Buat tabel di Supabase

Buka **Supabase → SQL Editor**, tempel isi [`supabase/schema.sql`](./supabase/schema.sql), lalu **Run**.

> ♻️ **Sudah pernah deploy versi lama? Jalankan ulang `schema.sql`.** Skrip itu
> idempoten (`create table if not exists` / `add column if not exists`), jadi aman
> dijalankan berkali-kali. Diperlukan untuk tabel **`store_devices`** — tanpa itu
> fitur multi-nomor WhatsApp (Starter 1 nomor, Pro 3 nomor) tidak aktif dan tab
> WhatsApp menampilkan peringatan "jalankan ulang `supabase/schema.sql`". Nomor
> yang sudah terhubung tetap jalan selama masa transisi, dibaca dari kolom lama
> di tabel `stores`.

### 4. Jalankan dev server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

---

## 💳 Alur Pembayaran

```
User isi form checkout
        │
        ▼
POST /api/checkout ──► validasi input
        │              harga OTORITATIF dari lib/packages.ts (bukan dari client)
        │              generate order_id unik
        ├──► Midtrans Snap API  ──► dapat snap token
        ├──► Supabase orders    ──► insert status PENDING
        ▼
Browser: window.snap.pay(token) ──► POP-UP pembayaran Midtrans
        │
        ▼
User bayar ──► Midtrans kirim webhook ──► POST /api/midtrans/notification
        │                                 verifikasi signature (SHA512)
        ▼                                 update status order (PAID/FAILED/...)
   Supabase orders diperbarui
```

### Konfigurasi Webhook Midtrans

Agar status order terupdate otomatis, set **Payment Notification URL** di
Midtrans Dashboard (**Settings → Configuration**) ke:

```
https://DOMAIN-ANDA/api/midtrans/notification
```

Saat development lokal, gunakan tunneling (mis. `ngrok http 3000`) supaya
Midtrans bisa menjangkau endpoint webhook Anda.

---

## 🧱 Struktur Proyek

```
app/
  layout.tsx                     # root layout + inject Snap.js
  page.tsx                       # orkestrasi section + state modal checkout
  globals.css
  dashboard/page.tsx             # dashboard toko (state + orkestrasi tab)
  api/
    checkout/route.ts            # buat Snap token + simpan order PENDING
    midtrans/notification/route.ts  # webhook verifikasi + update status
    fonnte/devices/route.ts      # kelola nomor WA toko + TEGAKKAN batas paket
    fonnte/qr/route.ts           # QR pairing per nomor
    fonnte/webhook/route.ts      # penerima pesan masuk → balasan AI
    test-reply/route.ts          # uji coba balasan dari dashboard (wajib login)
    store/route.ts               # baca/tulis konfigurasi toko
components/                      # Navbar, Hero, Features, Pricing, CheckoutModal, dst.
  dashboard/                     # komponen per tab + helper tampilan
lib/
  packages.ts                    # sumber tunggal paket, harga & batas nomor
  midtrans.ts                    # helper Snap REST + verifikasi signature
  supabase.ts                    # klien PostgREST (server-only)
  fonnte.ts                      # provisioning device + kirim WA
  reply-engine.ts                # intent + Gemini + pengiriman balasan
supabase/
  schema.sql                     # DDL tabel orders, stores, store_devices, dst.
```

---

## 🔒 Catatan Keamanan

- **Harga dihitung di server** berdasarkan `packageId`, tidak pernah dari input browser — mencegah manipulasi harga.
- **Batas nomor WhatsApp ditegakkan di server** (`lib/packages.ts` → `maxDevicesForPackage`): penambahan nomor ditolak di `POST /api/fonnte/devices`, dan nomor di luar kuota (mis. sisa 3 nomor dari masa trial lalu berlangganan Starter) tidak dilayani webhook. Dashboard menandai nomor mana yang tidak aktif supaya bukan kematian senyap.
- **Balasan selalu keluar dari device milik toko itu sendiri.** Tidak ada fallback ke `FONNTE_TOKEN` (account token) saat mengirim balasan, jadi pesan satu toko tidak mungkin keluar lewat nomor toko lain.
- **Service Role key hanya dipakai di server** (`lib/supabase.ts`). Jangan pernah meng-import file itu dari komponen client. Token device tidak pernah dikirim ke browser — API selalu memetakannya lewat `toPublicDevice()` yang hanya membocorkan `has_token: true/false`.
- **Webhook memverifikasi signature** `SHA512(order_id + status_code + gross_amount + server_key)` dengan timing-safe compare sebelum memperbarui status.
- Tabel `orders` mengaktifkan **RLS** tanpa policy publik, sehingga hanya bisa diakses via Service Role dari server.

---

## 🛠️ Tech Stack

Next.js 15 · React 19 · TypeScript · Tailwind CSS 3 · Lucide Icons · Midtrans Snap · Supabase (PostgREST)
