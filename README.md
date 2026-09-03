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
| `MIDTRANS_NOTIFICATION_URL` | *(opsional)* URL webhook yang dikirim per-transaksi lewat header `X-Override-Notification`. Kosong = otomatis dari semua domain aplikasi (`NEXT_PUBLIC_BASE_URL` + `NEXT_PUBLIC_ALT_BASE_URLS`). Boleh 1–3 URL dipisah koma. |
| `MIDTRANS_NOTIFICATION_MODE` | `override` (default) / `append` / `off`. Lihat [Konfigurasi Webhook Midtrans](#konfigurasi-webhook-midtrans). |
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role key Supabase (**server-only**, jangan diekspos!). |
| `NEXT_PUBLIC_BASE_URL` | Base URL publik aplikasi (callback Snap **dan** URL webhook yang didaftarkan ke Fonnte). **Wajib domain publik di produksi** — bila masih `localhost`, bot bisa mengirim tapi tidak akan pernah menerima chat pembeli. Isi **satu** domain kanonik. |
| `NEXT_PUBLIC_ALT_BASE_URLS` | *(opsional)* Domain lain tempat aplikasi ini juga dilayani, dipisah koma — mis. `https://balestoko.vercel.app` saat domain kanoniknya `https://balestoko.my.id`. Lihat [Dua domain](#dua-domain-untuk-satu-aplikasi). |
| `AUTH_SECRET` | Kunci HMAC penandatangan session login (`openssl rand -hex 32`). **Wajib di produksi, tanpa cadangan** — bila kosong, login gagal dan seluruh akses `/dashboard` dialihkan ke `/login`. Mengubahnya melogout semua sesi satu kali. |
| `FONNTE_TOKEN` | Account Token Fonnte (untuk provisioning device per toko). |
| `FONNTE_WEBHOOK_SECRET` | Shared secret pelindung `/api/fonnte/webhook`. **Wajib** — bila kosong, webhook menolak semua pesan masuk (503) dan bot tidak membalas siapa pun. |
| `GEMINI_API_KEY` | API key Gemini untuk balasan AI. |

> 🔑 Ambil kunci Midtrans di **Dashboard → Settings → Access Keys**.
> Ambil kunci Supabase di **Project Settings → API**.

### 3. Buat tabel di Supabase

Buka **Supabase → SQL Editor**, tempel isi [`supabase/schema.sql`](./supabase/schema.sql), lalu **Run**.

> ♻️ **Sudah pernah deploy versi lama? Jalankan ulang `schema.sql`.** Skrip itu
> idempoten (`create table if not exists` / `add column if not exists`), jadi aman
> dijalankan berkali-kali. Yang dibawa versi sekarang:
>
> - Tabel **`store_devices`** — tanpa itu fitur multi-nomor WhatsApp (Starter 1
>   nomor, Pro 3 nomor) tidak aktif dan tab WhatsApp menampilkan peringatan
>   "jalankan ulang `supabase/schema.sql`". Nomor yang sudah terhubung tetap jalan
>   selama masa transisi, dibaca dari kolom lama di tabel `stores`.
> - Kolom **`stores.subscription_ends_at`** — tanpa ini langganan tidak punya
>   tanggal berakhir dan satu pembayaran berlaku selamanya. Baris yang sudah
>   `is_paid` di-backfill `now() + 30 hari` (bukan dari `created_at`), jadi
>   menjalankan migrasi TIDAK pernah langsung mematikan pelanggan aktif.
> - Kolom **`stores.password_changed_at`** — dasar pencabutan sesi setelah reset
>   password, dan **`stores.reset_otp_attempts`** untuk batas percobaan OTP.
> - Kolom **`orders.is_renewal`** — menandai pembayaran atas akun yang sudah ada.
> - Tabel **`rate_limits`** + fungsi **`bump_rate_limit`** — pembatas laju yang
>   berlaku lintas instance serverless (login, reset password, pesan masuk).
> - Fungsi **`append_conversation_message`** + **`trim_jsonb_tail`** — menyimpan
>   pesan secara atomik, sehingga dua pesan yang datang bersamaan tidak saling
>   menimpa.
> - Kolom **`stores.payment_accounts`**, **`cod_enabled`**, **`payment_note`**,
>   **`local_courier`**, **`ai_tone`**, **`ai_include_total`**,
>   **`ai_include_payment`** — pengaturan ekspedisi, total, & instruksi bayar
>   (lihat [Ekspedisi, Total & Pembayaran](#-ekspedisi-total--pembayaran)).
>   Tanpa ini tab Pengaturan Toko gagal menyimpan.
> - **`stores.active_couriers` kehilangan default lamanya**, dan baris yang masih
>   memegang default itu apa adanya (`{jne,jnt,sicepat,pos}`) dikosongkan.
>   Kolomnya belum pernah ditulis aplikasi, jadi isinya pasti bukan pilihan
>   pemilik toko — dan `jnt` bukan kode yang dipakai API (`jt`), sehingga
>   menyalakan penyaringan tanpa membersihkannya justru **menghapus J&T** dari
>   semua kutipan ongkir.
> - Kolom **`store_devices.autoread`**, **`last_inbound_at`**,
>   **`last_inbound_note`** — dasar panel *Jalur terima chat pembeli* di tab
>   WhatsApp (lihat [Jalur pesan masuk WhatsApp](#-jalur-pesan-masuk-whatsapp-webhook-fonnte)).
>   `autoread` sengaja dibiarkan NULL untuk baris lama: nilai itulah penanda
>   bahwa setelan device belum pernah dipastikan, sehingga sinkronisasi berikutnya
>   memperbaikinya sekali.
>
> Selama fungsi RPC itu belum ada, aplikasi tetap jalan: pembatas laju jatuh ke
> peta in-memory per instance dan penyimpanan pesan jatuh ke read-modify-write
> yang lama. Keduanya hanya lebih lemah, bukan mati.

### 4. Jalankan dev server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

---

## 🚚 Ekspedisi, Total & Pembayaran

Diatur pemilik toko di **Dashboard → Pengaturan Toko**, dan semuanya bermuara ke
satu balasan WhatsApp: rincian pesanan → subtotal → **total bayar per ekspedisi**
→ cara bayar.

### Ekspedisi yang dilayani (`stores.active_couriers`)

Ceklis merek ekspedisi (bukan 16 kode layanan) dari `COURIER_GROUPS` di
[`lib/couriers.ts`](./lib/couriers.ts). Satu grup memayungi beberapa
`courier_code` dari Mengantar — `jne` mencakup `jne` + `jnecargo`, dan `jt` juga
menerima alias historis `jnt`.

**Kosong = semua ekspedisi ditawarkan**, bukan "tidak ada satu pun". Penyaringan
punya dua perilaku yang sengaja tidak simetris:

| Keadaan | Hasil | Alasan |
|---|---|---|
| Tidak ada yang diceklis | **semua** tarif dikembalikan (fail-open) | Pemilik yang belum mengatur apa pun tidak boleh mendapat bot yang mengutip nol ekspedisi. |
| Ada ceklis, hasil saring kosong | **kosong**, tanpa fallback (fail-closed) | Mengutip kurir yang tokonya tidak punya akun lebih merugikan daripada berkata jujur bahwa rute itu belum dilayani. |

Penyaringan dilakukan di **satu tempat**, `calculateMengantarOngkir`
([`lib/mengantar.ts`](./lib/mengantar.ts)) — mencakup jalur live maupun mock —
jadi balasan bot dan panel "Tes ongkir" di dashboard mustahil berbeda daftar.

Opsional, **kurir toko sendiri** (`stores.local_courier`): satu opsi manual
dengan label, tarif flat, dan estimasi. Tarif `0`/kosong berarti "tanya dulu" →
opsinya diletakkan **paling bawah** dan tidak pernah dicetak sebagai `Rp 0`.

### Penjumlahan total

`resolveOrderDraft` di [`lib/ai.ts`](./lib/ai.ts) membaca produk & jumlahnya dari
pesan pembeli, lalu `buildOngkirReply`
([`lib/reply-format.ts`](./lib/reply-format.ts)) menjumlahkannya dengan ongkir
tiap ekspedisi. Pencocokan produk berlapis: nama lengkap → semua kata kunci
(urutan bebas) → satu kata khas yang hanya dimiliki **tepat satu** produk. Kata
yang cocok ke lebih dari satu produk **tidak ditebak** — bot menanyakan yang mana,
sehingga toko dengan "Kaos Polos" dan "Kaos Raglan" tidak salah mengambil.

Dua pagar kejujuran angka:

- Tarif dari jalur **mock** ditulis "Perkiraan total", bukan "Total bayar".
  Estimasi lunak tidak boleh menjadi angka pasti hanya karena dijumlahkan.
- Total hanya muncul bila ada produk yang benar-benar cocok. Tidak ada yang
  cocok → bot minta pembeli menyebut produk & jumlahnya.

### Instruksi pembayaran

`stores.payment_accounts` (maks 3 rekening/e-wallet), `cod_enabled`, dan
`payment_note`. Rekening tanpa nama bank atau tanpa nomor dijatuhkan — lebih baik
hilang daripada sampai ke pembeli setengah jadi. Selama belum ada rekening
tersimpan, prompt Gemini secara eksplisit **melarang** menyebut nomor rekening apa
pun; yang sudah ada hanya boleh dikutip apa adanya, tidak boleh dikarang.

### Gaya jawaban AI

`ai_tone` (`ramah` / `santai` / `formal` / `singkat`) plus dua toggle
`ai_include_total` & `ai_include_payment`. Keduanya dibaca dengan `?? true` di
[`lib/reply-engine.ts`](./lib/reply-engine.ts), supaya baris yang belum pernah
disimpan sejak migrasi tidak diam-diam kehilangan blok yang tidak pernah
dimatikan pemiliknya.

Pratinjau balasan di dashboard dirender oleh `buildOngkirReply` — **fungsi yang
sama** dengan yang dipakai bot. Pratinjau yang disusun ulang secara terpisah pasti
menyimpang cepat atau lambat, dan pemilik toko akan mengatur sesuatu yang berbeda
dari yang benar-benar diterima pembelinya.

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

**Tidak perlu menyetel apa pun di dashboard Midtrans.** Dashboard hanya punya
**satu** *Payment Notification URL* untuk **seluruh akun**, jadi kalau akun yang
sama dipakai beberapa project, project yang mengisi kolom itu terakhir akan
menelan semua notifikasi — project lain ordernya tersangkut `PENDING` walau
uangnya sudah masuk.

Karena itu `/api/checkout` mengirim URL webhook-nya sendiri di setiap transaksi
lewat HTTP header ([docs](https://docs.midtrans.com/reference/override-notification-url)):

```
X-Override-Notification: https://DOMAIN-ANDA/api/midtrans/notification
```

| `MIDTRANS_NOTIFICATION_MODE` | Efek |
|---|---|
| `override` *(default)* | URL dashboard **diabaikan** untuk transaksi ini; hanya webhook project ini yang dipanggil. Pilihan yang benar untuk akun bersama. |
| `append` | URL dashboard **tetap** dapat notifikasi, webhook project ini ditambahkan (Midtrans membatasi total 3 URL). |
| `off` | Header tidak dikirim — murni mengandalkan URL dashboard (perilaku lama). |

URL-nya dihitung dari `MIDTRANS_NOTIFICATION_URL` bila diisi, kalau tidak dari
**semua domain aplikasi** (`NEXT_PUBLIC_BASE_URL` + `NEXT_PUBLIC_ALT_BASE_URLS`),
masing-masing + `/api/midtrans/notification`.

Beberapa penjaga yang sengaja ada:

- **URL yang tidak mungkin dijangkau tidak pernah dikirim.** `localhost`,
  jaringan privat, dan port non-80/443 di-skip (dengan peringatan di log) dan
  header-nya batal — mengoverride URL dashboard dengan alamat mati akan membuat
  notifikasi hilang total, bukan sekadar tertunda. Untuk uji webhook di lokal,
  jalankan tunnel (`ngrok http 3000`) lalu isi `MIDTRANS_NOTIFICATION_URL` dengan
  URL ngrok + `/api/midtrans/notification`.
- **Notifikasi project lain tidak merusak apa pun.** Server key satu akun sama
  untuk semua project, jadi signature notifikasi project lain pun valid di sini.
  Order yang tidak dikenal dijawab `200 {"ignored":true}` dan dicatat di log,
  bukan diperlakukan sebagai pembayaran.

---

## 🌐 Dua domain untuk satu aplikasi

Aplikasi ini dilayani di lebih dari satu domain. Konfigurasinya:

```env
NEXT_PUBLIC_BASE_URL=https://balestoko.my.id          # SATU domain kanonik
NEXT_PUBLIC_ALT_BASE_URLS=https://balestoko.vercel.app # domain lainnya, dipisah koma
```

`NEXT_PUBLIC_BASE_URL` sengaja tetap satu nilai: ia yang didaftarkan ke Fonnte
sebagai URL webhook device dan dipakai `metadataBase` (SEO). Kalau nilainya ikut
berubah mengikuti domain yang sedang dibuka, URL webhook device akan
**bolak-balik diperbaiki** setiap kali dashboard diakses dari domain berbeda.

Yang sadar-domain hanya dua hal:

| Hal | Perilaku |
|---|---|
| **Webhook Midtrans** | **Kedua** domain didaftarkan sekaligus di header override, jadi pembayaran tetap teraktivasi walau satu domain kena masalah DNS/SSL. Notifikasi ganda aman — transisi ke `PAID` pakai PATCH bersyarat `status=neq.PAID`, jadi hanya satu yang menang dan langganan tidak mungkin diperpanjang dua kali. |
| **Redirect setelah bayar** | Pembeli pulang ke domain yang **dia** pakai. Cookie sesi terikat host, jadi checkout di `balestoko.my.id` yang dilempar ke `balestoko.vercel.app` akan tampak logout. |

Header `Origin` datang dari klien, jadi hanya domain yang **terdaftar di ENV**
yang dihormati sebagai tujuan redirect (`resolveCallbackBaseUrl` di
`lib\webhook-url.ts`). Origin asing jatuh ke domain kanonik — kalau tidak, siapa
pun bisa membuat transaksi yang mengembalikan pembeli ke halaman "pembayaran
berhasil" palsu di domain miliknya.

Yang perlu diingat saat menambah/mengganti domain:

- Tambahkan domainnya ke `NEXT_PUBLIC_ALT_BASE_URLS` lalu **deploy ulang**
  (variabel `NEXT_PUBLIC_*` ikut di-bake saat build).
- Batas Midtrans 3 URL notifikasi: domain kanonik + 2 domain lain.
- Cookie sesi tidak dibagi antar domain — pemilik toko yang login di
  `balestoko.my.id` tetap harus login lagi di `balestoko.vercel.app`.
- Setelah pindah domain kanonik, buka tab **WhatsApp** di dashboard sekali agar
  URL webhook tiap device disinkronkan ke domain baru.

---

## 📥 Jalur pesan masuk WhatsApp (webhook Fonnte)

Bot punya **dua jalur yang terpisah total**, dan membedakannya adalah kunci saat
bot tampak "sehat tapi bisu":

```
JALUR KIRIM   aplikasi ──► POST api.fonnte.com/send ──► WhatsApp pembeli
              dipakai: balasan bot, OTP reset password, tombol
              "Uji coba balasan AI" di dashboard

JALUR TERIMA  pembeli ──► WhatsApp ──► Fonnte ──► POST /api/fonnte/webhook
              dipakai: HANYA chat pembeli sungguhan
              syarat: URL webhook device terdaftar + `auto read` device MENYALA
```

**Uji coba balasan AI tidak menguji jalur terima.** Ia memanggil Gemini dari
server lalu mengirim lewat `/send`, tanpa sekali pun melewati webhook — jadi ia
tetap berhasil walau jalur terima mati. Kalau uji coba berbalas tapi chat pembeli
tidak, penyebabnya hampir pasti ada di jalur terima, bukan di AI atau di device.

Semuanya dipasang otomatis oleh aplikasi — tidak ada yang perlu disetel manual di
dashboard Fonnte:

| Kapan | Yang dilakukan |
|---|---|
| Nomor baru dibuat (`POST /api/fonnte/devices`) | Daftarkan URL webhook + nyalakan `auto read` |
| QR dibuka (`GET /api/fonnte/qr`) | Baca setelan **nyata** di Fonnte, perbaiki bila melenceng |
| Tab WhatsApp dibuka / tombol segarkan | Sama, untuk semua nomor toko sekaligus |
| Pesan masuk dengan secret lama/kosong | Dilayani sekali, sambil setelan device diperbaiki |

Tab WhatsApp menampilkan panel **Jalur terima chat pembeli** per nomor: status URL
webhook, status `auto read`, dan **kapan pesan masuk terakhir benar-benar tiba**
beserta apa yang terjadi padanya (dibalas AI / diabaikan karena kuota / ditolak
karena secret / dst). Tanpa catatan itu, "belum ada pembeli yang chat" dan "chat
pembeli tidak pernah sampai" terlihat sama persis dari dashboard. Bila ada yang
melenceng, tombol **Perbaiki otomatis** mendorong ulang setelannya ke Fonnte.

### Kalau chat pembeli masih tidak dibalas

1. **Panel jalur terima bilang "belum siap"** → tekan *Perbaiki otomatis*. Kalau
   gagal, pesan galatnya berasal langsung dari Fonnte.
2. **Peringatan `NEXT_PUBLIC_BASE_URL` muncul** → variabelnya masih `localhost`
   atau IP privat. Isi domain publik aplikasi, deploy ulang, buka tab WhatsApp.
3. **Panel bilang siap, tapi "pesan masuk terakhir" tetap kosong** → Fonnte tidak
   memanggil webhook sama sekali. Cek log deployment; bila kosong juga, cek di
   dashboard Fonnte apakah device masih tertaut dan domainnya tidak terhalang
   proteksi (mis. Vercel Preview Protection pada domain preview).
4. **Ada catatan "Diabaikan: …"** → jalur terima sehat, pesan sengaja tidak
   dibalas. Alasannya tertulis: masa aktif toko berakhir, nomor di luar kuota
   paket, kuota percakapan bulanan habis, atau batas laju per nomor.

---

## 🔄 Masa Aktif Langganan

Harga di `lib/packages.ts` berbunyi **/bulan**, jadi masa aktifnya memang dibatasi
per bulan — bukan sekali bayar seumur hidup.

```
Pembayaran PAID
   │
   ├─ updateOrderStatus() PATCH bersyarat: ?order_id=eq.X&status=neq.PAID
   │     └─ 0 baris ⇒ notifikasi duplikat, DIABAIKAN (langganan tidak dobel)
   │
   └─ applyPaidOrderToStore()
         ├─ akun BARU     ⇒ buat store + password_hash dari order
         └─ akun ADA      ⇒ HANYA is_paid / package_id / subscription_ends_at
                             (nama toko, nomor, dan kata sandi tidak disentuh)

subscription_ends_at = max(sekarang, sisa langganan) + 30 hari
```

- **Perpanjangan menambah sisa hari**, tidak menghanguskannya
  (`subscriptionEndAfterPayment` di `lib/packages.ts`).
- Satu fungsi memutuskan "toko ini masih aktif atau tidak": `isStoreActive()`.
  Dipakai webhook Fonnte (menolak memproses pesan), endpoint uji coba, dan
  `storeActivityState()` yang mengisi layar terkunci di dashboard.
- **Akun nonaktif tetap boleh login.** Ini disengaja: memperpanjang butuh sesi
  yang membuktikan kepemilikan email, jadi memblokir login akan mengunci
  pelanggan tepat ketika mereka ingin membayar. Yang mati adalah layanannya.
- Dashboard memperingatkan **7 hari sebelum** langganan berakhir, lalu menampilkan
  layar "Masa langganan telah berakhir" dengan tautan perpanjang.

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
    auth/login/route.ts          # login + pembatas brute force
    auth/session/route.ts        # siapa yang login (dipakai modal checkout)
    auth/reset/request/route.ts  # kirim OTP reset (anti-enumerasi)
    auth/reset/confirm/route.ts  # verifikasi OTP + cabut sesi lama
    fonnte/devices/route.ts      # kelola nomor WA toko + TEGAKKAN batas paket
    fonnte/qr/route.ts           # QR pairing per nomor
    fonnte/webhook/route.ts      # penerima pesan masuk → balasan AI
    test-reply/route.ts          # uji coba balasan dari dashboard (wajib login)
    store/route.ts               # baca/tulis konfigurasi toko + status masa aktif
components/                      # Navbar, Hero, Features, Pricing, CheckoutModal, dst.
  dashboard/                     # komponen per tab + helper tampilan
lib/
  packages.ts                    # sumber tunggal paket, harga, batas nomor & masa aktif
  midtrans.ts                    # helper Snap REST + override URL notifikasi + verifikasi signature
  supabase.ts                    # klien PostgREST (server-only)
  auth.ts                        # hash password, cookie sesi, pencabutan sesi
  ai.ts                          # deteksi intent, berat kirim, format balasan WA
  fonnte.ts                      # provisioning device + kirim WA
  reply-engine.ts                # intent + Gemini + pengiriman balasan
middleware.ts                    # penjaga rute /dashboard (tanda tangan saja)
supabase/
  schema.sql                     # DDL tabel + fungsi RPC (rate limit, simpan pesan)
```

---

## 🔒 Catatan Keamanan

- **Harga dihitung di server** berdasarkan `packageId`, tidak pernah dari input browser — mencegah manipulasi harga.
- **Batas nomor WhatsApp ditegakkan di server** (`lib/packages.ts` → `maxDevicesForPackage`): penambahan nomor ditolak di `POST /api/fonnte/devices`, dan nomor di luar kuota (mis. sisa 3 nomor dari masa trial lalu berlangganan Starter) tidak dilayani webhook. Dashboard menandai nomor mana yang tidak aktif supaya bukan kematian senyap.
- **Balasan selalu keluar dari device milik toko itu sendiri.** Tidak ada fallback ke `FONNTE_TOKEN` (account token) saat mengirim balasan, jadi pesan satu toko tidak mungkin keluar lewat nomor toko lain.
- **Kuota percakapan bulanan ditegakkan di server** (`monthlyConversationLimit` → `checkConversationQuota`): Starter dibatasi 1.000 percakapan per bulan kalender WIB, Pro tanpa batas. Diperiksa **sebelum** Gemini dipanggil, karena di situlah biaya AI + kirim WhatsApp muncul. Satu pembeli = satu percakapan (bukan per pesan); pembeli yang percakapannya sudah aktif bulan ini tidak pernah terputus di tengah tanya-jawab; dan hitungan yang gagal diperlakukan sebagai lolos agar satu query error tidak mematikan bot toko berbayar. Jalur uji coba dashboard memakai kuota yang sama supaya bot tidak terlihat sehat saat kuotanya sudah habis.
- **Memori percakapan AI digating per paket** (`aiContextMessagesForPackage`): riwayat chat tetap dibaca untuk semua paket (dipakai mendeteksi sapaan pertama), tetapi hanya paket Pro yang riwayatnya ikut masuk ke prompt Gemini. Batasnya dibaca dari `lib/packages.ts`, bukan dari input klien.
- **Batas bulan dihitung dari satu fungsi bersama** (`monthStartMs` di `lib/packages.ts`, file yang aman dipakai client): penegak kuota di server dan meter pemakaian di dashboard mustahil memakai batas bulan yang berbeda.
- **Service Role key hanya dipakai di server** (`lib/supabase.ts`). Jangan pernah meng-import file itu dari komponen client. Token device tidak pernah dikirim ke browser — API selalu memetakannya lewat `toPublicDevice()` yang hanya membocorkan `has_token: true/false`.
- **Webhook memverifikasi signature** `SHA512(order_id + status_code + gross_amount + server_key)` dengan timing-safe compare sebelum memperbarui status.
- **URL notifikasi dikunci per-transaksi, bukan lewat dashboard** (`resolveNotificationTarget` di `lib\midtrans.ts`). Satu akun Midtrans punya satu Payment Notification URL untuk semua project, jadi mengandalkan dashboard berarti project yang mengisinya terakhir menelan notifikasi milik project lain. Header `X-Override-Notification` dikirim di setiap Snap request berisi **semua** domain aplikasi, dan URL yang tidak publik (localhost/jaringan privat/port non-standar) sengaja TIDAK dikirim supaya override tidak pernah mengganti URL dashboard dengan alamat mati. Webhook juga mengabaikan `order_id` yang tidak ada di database ini — signature notifikasi project lain memang valid karena server key-nya sama.
- **Redirect setelah bayar pakai daftar domain, bukan header `Origin` apa adanya** (`resolveCallbackBaseUrl` di `lib\webhook-url.ts`). Pembeli harus pulang ke domain yang dia pakai (cookie sesi terikat host), tapi `Origin` dikendalikan klien: tanpa pembatasan, siapa pun bisa membuat transaksi yang melempar pembeli ke halaman "pembayaran berhasil" palsu. Hanya domain di `NEXT_PUBLIC_BASE_URL`/`NEXT_PUBLIC_ALT_BASE_URLS` yang dihormati; sisanya jatuh ke domain kanonik.
- **Notifikasi pembayaran idempoten.** Transisi ke PAID dijalankan lewat PATCH bersyarat `?order_id=eq.X&status=neq.PAID`, jadi Midtrans yang mengirim notifikasi yang sama dua kali tidak bisa memperpanjang langganan dua kali.
- **Pembayaran tidak bisa dipakai mengambil alih akun.** Checkout atas email yang sudah terdaftar wajib menyertakan sesi milik email itu (jika tidak: `409 needsLogin`), dan pada akun yang sudah ada pembayaran hanya menyentuh `is_paid` / `package_id` / `subscription_ends_at` — nama toko, nomor WhatsApp, dan kata sandi tidak pernah ditimpa oleh alur pembayaran. Dua lapis ini berdiri sendiri: sink-nya tetap aman walau pemanggilnya berubah.
- **Reset password mencabut sesi lama.** Sukses reset menulis `password_changed_at`, dan `getSessionEmail()` menolak cookie yang terbit sebelum waktu itu (payload sesi menyimpan `iat`). Tanpa ini, korban pengambilalihan bisa mengganti password tapi penyerang tetap login sampai TTL 7 hari habis. Query yang gagal memilih **tidak** memaksa logout — satu error Supabase tidak boleh mengeluarkan semua pelanggan.
- **OTP reset dibatasi percobaannya.** OTP 6 digit berlaku 10 menit; 5 kali salah membatalkan OTP-nya (`reset_otp_attempts`), jadi masa berlaku itu tidak cukup untuk menembak sejuta kombinasi.
- **Endpoint reset tidak membocorkan email mana yang terdaftar.** Responsnya selalu identik — termasuk saat batas laju tercapai — dan tidak lagi mengirim petunjuk nomor WhatsApp tujuan.
- **Pembatas laju ditegakkan di database**, bukan di memori proses (`rate_limits` + RPC `bump_rate_limit`): satu deployment serverless berjalan di banyak instance, jadi peta in-memory sebenarnya berarti "batas × jumlah instance". Berlaku untuk login (per email & per IP), permintaan/konfirmasi reset, dan pesan WhatsApp masuk. Semuanya **fail-open**: kalau RPC-nya tidak ada, pembatas jatuh ke peta lokal alih-alih menolak semua permintaan.
- **Middleware bukan lapisan otorisasi.** `middleware.ts` berjalan di Edge dan hanya memeriksa tanda tangan + kedaluwarsa cookie. Penegakan sebenarnya ada di route API (`getSessionEmail()`, plus kepemilikan data dikunci lewat `store_id=eq.<store sesi>` di query). Jangan pernah menaruh satu-satunya pemeriksaan kepemilikan di middleware.
- **RLS aktif tanpa policy publik** pada `orders`, `stores`, `store_devices`, `products`, `conversations`, dan `rate_limits` — semuanya hanya bisa diakses via Service Role dari server.
- **Katalog produk dibatasi 300 per toko.** Bukan soal ruang penyimpanan: seluruh katalog ikut masuk ke prompt Gemini, jadi katalog tanpa batas berarti prompt tanpa batas.
- **Berat ongkir dihitung dari produk yang disebut pembeli**, bukan dari produk pertama di katalog seperti sebelumnya. Toko dengan produk campur (gantungan kunci 50 g dan karpet 8 kg) dulu salah kutip di setiap percakapan. Bila tidak ada produk yang cocok, dipakai `default_weight` milik toko dan balasan WhatsApp menyebut angka itu terus terang sebagai perkiraan.

---

## 🛠️ Tech Stack

Next.js 15 · React 19 · TypeScript · Tailwind CSS 3 · Lucide Icons · Midtrans Snap · Supabase (PostgREST)
