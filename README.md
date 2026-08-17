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
  api/
    checkout/route.ts            # buat Snap token + simpan order PENDING
    midtrans/notification/route.ts  # webhook verifikasi + update status
components/                      # Navbar, Hero, Features, Pricing, CheckoutModal, dst.
lib/
  packages.ts                    # sumber tunggal paket & harga
  midtrans.ts                    # helper Snap REST + verifikasi signature
  supabase.ts                    # klien PostgREST (server-only)
supabase/
  schema.sql                     # DDL tabel orders
```

---

## 🔒 Catatan Keamanan

- **Harga dihitung di server** berdasarkan `packageId`, tidak pernah dari input browser — mencegah manipulasi harga.
- **Service Role key hanya dipakai di server** (`lib/supabase.ts`). Jangan pernah meng-import file itu dari komponen client.
- **Webhook memverifikasi signature** `SHA512(order_id + status_code + gross_amount + server_key)` dengan timing-safe compare sebelum memperbarui status.
- Tabel `orders` mengaktifkan **RLS** tanpa policy publik, sehingga hanya bisa diakses via Service Role dari server.

---

## 🛠️ Tech Stack

Next.js 15 · React 19 · TypeScript · Tailwind CSS 3 · Lucide Icons · Midtrans Snap · Supabase (PostgREST)
