-- =====================================================================
--  Skema Database Lengkap Bot WA CS AI + Mengantar API + Fonnte + Midtrans
--  Jalankan di Supabase: Dashboard -> SQL Editor -> New query -> Run
-- =====================================================================

-- 1. Tabel Orders (Transaksi Pembayaran Midtrans)
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_id          text unique not null,          -- ORDER-PRO-<ts>-<rand>
  package_id        text not null,                 -- 'starter' | 'pro'
  package_name      text not null,
  gross_amount      integer not null,              -- Rupiah, tanpa desimal
  status            text not null default 'PENDING',-- PENDING | PAID | FAILED | CHALLENGE
  customer_name     text not null,
  customer_phone    text not null,
  customer_email    text not null,
  store_name        text not null,
  password_hash     text,                           -- hash password (scrypt) — HANYA untuk akun baru; null pada perpanjangan
  coupon_code       text,                           -- kode kupon yang dipakai (mis. 'ferdybudiono'), null jika tanpa kupon
  is_renewal        boolean not null default false, -- true = perpanjangan/upgrade akun yang SUDAH ada
  snap_token        text,
  raw_notification  jsonb,                          -- payload webhook Midtrans terakhir
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 2. Tabel Stores (Pengaturan Toko, Token Fonnte, Mengantar API & Prompt AI)
create table if not exists public.stores (
  id                    uuid primary key default gen_random_uuid(),
  email                 text unique not null,
  store_name            text not null,
  password_hash         text,                           -- hash password login (scrypt)
  customer_name         text,
  customer_phone        text,
  is_paid               boolean not null default false,
  -- Default sengaja paket TERKECIL: baris yang package_id-nya gagal terisi tidak
  -- boleh otomatis mendapat hak paket termahal.
  package_id            text default 'starter',

  -- Langganan & Trial
  --   trial_ends_at        : akhir masa uji coba 7 hari
  --   subscription_ends_at : akhir periode berbayar. `/bulan` di halaman harga
  --                          hanya jujur kalau kolom ini ada dan ditegakkan —
  --                          tanpa ini satu kali bayar = akses selamanya.
  trial_ends_at         timestamptz,
  subscription_ends_at  timestamptz,
  coupon_used           text,                           -- kode kupon yang sudah pernah dipakai akun ini (sekali pakai)

  -- Reset Password via WhatsApp OTP
  reset_otp_hash        text,                           -- hash (scrypt) dari OTP reset password
  reset_otp_expires     timestamptz,                    -- kedaluwarsa OTP reset (mis. 10 menit)
  reset_otp_attempts    integer not null default 0,     -- percobaan OTP gagal; OTP dibatalkan setelah batas
  -- Sesi yang diterbitkan SEBELUM waktu ini ditolak. Diisi setiap password
  -- berubah, supaya reset password benar-benar mengeluarkan penyerang.
  password_changed_at   timestamptz,

  -- Fonnte WA Settings
  fonnte_token          text,
  fonnte_device_status  text default 'DISCONNECTED',
  webhook_url           text,                            -- URL webhook incoming chat yang sudah disinkronkan ke device
  
  -- Mengantar API (Ongkir) Settings
  mengantar_api_key     text,
  origin_subdistrict_id text default '3171010',      -- Contoh default: Jakarta Pusat / Gambir
  origin_city_name      text default 'Jakarta Pusat',
  default_weight        integer default 1000,          -- Gram (1 kg)
  -- Ekspedisi yang dilayani toko (kode grup dari lib/couriers.ts).
  -- NULL / array kosong = SEMUA ekspedisi ditawarkan. Sengaja tanpa default:
  -- default yang restriktif akan membatasi toko ke ekspedisi yang tidak pernah
  -- dipilih pemiliknya (lihat blok migrasi di akhir file).
  active_couriers       text[],

  -- Ongkir kurir toko sendiri: {enabled, label, cost, etd}. cost 0 = "tanya dulu".
  local_courier         jsonb,

  -- Pembayaran
  payment_accounts      jsonb   not null default '[]'::jsonb,  -- maks 3: {type,name,number,holder}
  cod_enabled           boolean not null default false,
  payment_note          text,

  -- AI CS Agent Configuration
  ai_prompt_system      text default 'Kamu adalah Customer Service AI yang ramah dan profesional. Tugasmu adalah menyapa pembeli dengan hangat, menjawab pertanyaan produk, dan membantu mengecek tarif ongkos kirim (ongkir) menggunakan kurir ekspedisi.',
  greeting_message      text default 'Halo! Selamat datang di toko kami 👋 Ada yang bisa kami bantu mengenai produk atau cek tarif ongkir ke kota Kakak?',
  ai_tone               text    not null default 'ramah',   -- ramah | santai | formal | singkat
  ai_include_total      boolean not null default true,      -- jumlahkan produk + ongkir di balasan
  ai_include_payment    boolean not null default true,      -- sertakan instruksi pembayaran

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 3. Tabel Products (Katalog Produk Toko untuk AI CS)
create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid references public.stores(id) on delete cascade,
  name                  text not null,
  price                 integer not null,
  weight                integer not null default 1000, -- Gram
  stock                 integer not null default 100,
  description           text,
  created_at            timestamptz not null default now()
);

-- 4. Tabel Conversations (Riwayat Chat WhatsApp Pembeli)
create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid references public.stores(id) on delete cascade,
  customer_phone        text not null,
  -- Nama & alamat DIPANCING oleh AI lalu direkam di sini. Dipakai label
  -- "nama + kota" di riwayat chat dashboard dan sebagai identitas pesanan.
  customer_name         text default 'Pembeli WA',
  customer_address      text,
  messages              jsonb not null default '[]'::jsonb, -- Array of {role: 'user'|'assistant', content: text, timestamp: text}
  last_intent           text, -- 'GREETING' | 'ONGKIR_CHECK' | 'PRODUCT_INQUIRY' | 'ORDER'
  destination_city      text,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint store_phone_unique unique (store_id, customer_phone)
);

-- 5. Tabel Store Devices (Nomor WhatsApp per toko — Starter 1, Pro 3)
--
--    Sebelumnya satu toko hanya bisa satu nomor karena token device disimpan di
--    kolom tunggal `stores.fonnte_token`. Tabel ini memisahkannya jadi satu baris
--    per nomor. `stores.fonnte_token` / `fonnte_device_status` / `webhook_url`
--    tetap diisi sebagai CERMIN device utama supaya kode lama (mis. OTP reset
--    password) tidak perlu ikut berubah.
create table if not exists public.store_devices (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references public.stores(id) on delete cascade,
  label                 text,                            -- nama bebas, mis. 'CS 1', 'Admin Gudang'
  phone                 text not null,                   -- nomor device, disimpan 62xxx
  fonnte_token          text,                            -- DEVICE token hasil add-device
  device_status         text not null default 'DISCONNECTED',
  webhook_url           text,                            -- URL webhook yang sudah tersinkron ke device ini
  -- Fonnte TIDAK memanggil webhook pesan masuk bila `auto read` device mati,
  -- dan device hasil add-device tidak menyalakannya sendiri. Kolom ini memisahkan
  -- "URL webhook sudah terpasang" dari "webhook benar-benar akan dipanggil".
  -- NULL = belum pernah diurus (baris pra-perbaikan) → akan disinkronkan sekali.
  autoread              boolean,
  -- Jejak jalur TERIMA. Tanpa ini "belum ada pembeli yang chat" dan "chat pembeli
  -- tidak pernah sampai ke aplikasi" terlihat sama persis dari dashboard.
  last_inbound_at       timestamptz,                     -- pesan masuk terakhir TIBA dari Fonnte
  last_inbound_note     text,                            -- hasilnya: 'Dibalas AI' / alasan diabaikan
  is_primary            boolean not null default false,  -- device untuk pesan non-percakapan (OTP reset)
  -- Produk yang DIJAWAB nomor ini (array id produk, jsonb).
  -- `[]` / NULL = nomor umum: menjawab SEMUA produk toko. Paket Pro punya 3 nomor,
  -- jadi satu nomor bisa dikhususkan untuk sebagian katalog saja — katalog yang
  -- masuk ke prompt AI & pencocokan pesanan mengikuti daftar ini.
  product_ids           jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Nomor WhatsApp wajib unik lintas seluruh sistem: Fonnte menolak device dengan
-- nomor kembar, dan webhook merutekan pesan masuk berdasarkan nomor penerima —
-- nomor yang dipakai dua toko akan mengirim pesan pembeli ke toko yang salah.
create unique index if not exists store_devices_phone_uidx on public.store_devices (phone);
create index if not exists store_devices_store_idx on public.store_devices (store_id);
create index if not exists store_devices_token_idx on public.store_devices (fonnte_token);
-- Tepat satu device utama per toko.
create unique index if not exists store_devices_primary_uidx
  on public.store_devices (store_id) where is_primary;

-- 6. Tabel Buyer Orders (daftar pesanan pembeli hasil rekaman AI)
--
--    JANGAN dicampur dengan `public.orders` — tabel itu adalah pembayaran
--    LANGGANAN SaaS (Midtrans). Ini pesanan PEMBELI di toko pelanggan kami:
--    satu baris per pesanan yang berhasil AI kumpulkan dari chat WhatsApp,
--    ditampilkan sebagai tabel (mirip spreadsheet) di dashboard dengan toggle
--    "sudah diproses".
create table if not exists public.buyer_orders (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references public.stores(id) on delete cascade,
  -- Nomor WhatsApp toko yang menerima pesanan ini. `set null` supaya menghapus
  -- nomor tidak menghapus riwayat pesanan yang sudah masuk.
  device_id             uuid references public.store_devices(id) on delete set null,
  customer_phone        text not null,
  customer_name         text,
  customer_address      text,
  destination_city      text,
  -- [{name, units, price, weight, line_total}] — snapshot saat pesanan dibuat,
  -- bukan referensi ke `products`: harga/nama produk boleh berubah nanti, tapi
  -- pesanan yang sudah tercatat tidak boleh ikut berubah.
  items                 jsonb   not null default '[]'::jsonb,
  subtotal              integer not null default 0,
  weight_gram           integer not null default 0,
  shipping_courier      text,
  shipping_cost         integer,
  note                  text,
  status                text not null default 'new',   -- 'new' | 'done'
  done_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists buyer_orders_store_idx on public.buyer_orders (store_id, created_at desc);
create index if not exists buyer_orders_phone_idx on public.buyer_orders (store_id, customer_phone);
-- Satu pesanan BERJALAN per pembeli. Chat lanjutan menambah/mengubah pesanan yang
-- sama, bukan membuat baris baru setiap kali pembeli menyebut produk. Setelah
-- ditandai 'done' slotnya kosong lagi, jadi pesanan berikutnya jadi baris baru.
create unique index if not exists buyer_orders_open_uidx
  on public.buyer_orders (store_id, customer_phone) where status = 'new';

-- 7. Tabel Rate Limits (pembatas laju lintas-instance)
--
--    Peta in-memory hanya berlaku per instance serverless: dua region yang
--    melayani nomor yang sama masing-masing punya hitungan sendiri, jadi batas
--    8 pesan/menit bisa jadi 8 × jumlah instance. Tabel ini memindahkan
--    hitungannya ke satu tempat yang dilihat semua instance.
create table if not exists public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  hits          integer not null default 0,
  updated_at    timestamptz not null default now()
);

create index if not exists rate_limits_updated_idx on public.rate_limits (updated_at);

-- Indexing
create index if not exists orders_order_id_idx on public.orders (order_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists stores_email_idx on public.stores (email);
create index if not exists stores_fonnte_token_idx on public.stores (fonnte_token);
create index if not exists conversations_store_phone_idx on public.conversations (store_id, customer_phone);
-- Dipakai hitungan kuota bulanan (store_id + updated_at >= awal bulan) dan
-- pemuatan daftar percakapan dashboard yang selalu diurutkan updated_at desc.
create index if not exists conversations_store_updated_idx
  on public.conversations (store_id, updated_at desc);

-- RLS Enablement
-- Tanpa policy publik = hanya bisa diakses Service Role dari server. `products`
-- dan `conversations` ikut dinyalakan: aplikasi memang tidak memakai anon key,
-- tapi RLS yang mati akan membuka kedua tabel itu begitu ada satu saja yang pakai.
alter table public.orders enable row level security;
alter table public.stores enable row level security;
alter table public.store_devices enable row level security;
alter table public.products enable row level security;
alter table public.conversations enable row level security;
alter table public.buyer_orders enable row level security;
alter table public.rate_limits enable row level security;

-- Auto-update timestamp trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

drop trigger if exists trg_stores_updated_at on public.stores;
create trigger trg_stores_updated_at before update on public.stores for each row execute function public.set_updated_at();

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();

drop trigger if exists trg_store_devices_updated_at on public.store_devices;
create trigger trg_store_devices_updated_at before update on public.store_devices for each row execute function public.set_updated_at();

drop trigger if exists trg_buyer_orders_updated_at on public.buyer_orders;
create trigger trg_buyer_orders_updated_at before update on public.buyer_orders for each row execute function public.set_updated_at();

-- =====================================================================
--  FUNGSI RPC (dipanggil server lewat /rest/v1/rpc/<nama>)
-- =====================================================================

-- Ambil `p_max` elemen TERAKHIR sebuah array jsonb, urutannya dipertahankan.
create or replace function public.trim_jsonb_tail(p_arr jsonb, p_max integer)
returns jsonb language sql immutable as $$
  select case
    when p_max is null or p_arr is null or jsonb_array_length(p_arr) <= p_max then p_arr
    else (
      select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
      from jsonb_array_elements(p_arr) with ordinality as t(elem, ord)
      where ord > jsonb_array_length(p_arr) - p_max
    )
  end;
$$;

-- Tambahkan satu pasang pesan (pembeli + balasan bot) ke sebuah percakapan.
--
-- KENAPA RPC, bukan PATCH biasa: `messages` adalah satu kolom jsonb, jadi
-- menambah pesan lewat PostgREST berarti baca-array → tambah di memori →
-- tulis-ulang seluruh array. Dua pesan yang datang hampir bersamaan (pembeli
-- mengirim dua chat beruntun, atau dua instance serverless memproses paralel)
-- akan saling menimpa dan satu pesan hilang. Di dalam fungsi ini seluruh
-- operasi terjadi dalam SATU pernyataan SQL, jadi tidak ada celah lost-update.
--
-- `p_max_messages` memangkas riwayat lama supaya satu baris tidak tumbuh tanpa
-- batas (setiap balasan membaca & menulis ulang kolom ini).
--
-- `p_customer_name` / `p_customer_address` = hasil "pancingan" AI. Keduanya
-- ditulis dengan `coalesce(nullif(...), nilai lama)` supaya pesan berikutnya yang
-- tidak menyebut nama TIDAK menghapus nama yang sudah didapat.
--
-- Tanda tangan lama (7 argumen) DIBUANG dulu: `create or replace` dengan daftar
-- argumen berbeda menghasilkan OVERLOAD, dan PostgREST yang memanggil pakai
-- named-argument akan gagal dengan "function is not unique".
drop function if exists public.append_conversation_message(uuid, text, text, text, text, text, integer);

create or replace function public.append_conversation_message(
  p_store_id uuid,
  p_phone text,
  p_user_msg text,
  p_assistant_reply text,
  p_intent text default null,
  p_destination_city text default null,
  p_max_messages integer default 200,
  p_customer_name text default null,
  p_customer_address text default null
) returns setof public.conversations
language plpgsql as $$
declare
  v_now timestamptz := now();
  v_stamp text := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new jsonb;
begin
  v_new := jsonb_build_array(
    jsonb_build_object('role', 'user', 'content', p_user_msg, 'timestamp', v_stamp),
    jsonb_build_object('role', 'assistant', 'content', p_assistant_reply, 'timestamp', v_stamp)
  );

  return query
  insert into public.conversations (
    store_id, customer_phone, messages, last_intent, destination_city,
    customer_name, customer_address, updated_at
  )
  values (
    p_store_id, p_phone, public.trim_jsonb_tail(v_new, p_max_messages),
    p_intent, p_destination_city,
    coalesce(nullif(btrim(p_customer_name), ''), 'Pembeli WA'),
    nullif(btrim(p_customer_address), ''),
    v_now
  )
  on conflict (store_id, customer_phone) do update
    set messages         = public.trim_jsonb_tail(conversations.messages || v_new, p_max_messages),
        last_intent      = coalesce(p_intent, conversations.last_intent),
        destination_city = coalesce(p_destination_city, conversations.destination_city),
        customer_name    = coalesce(nullif(btrim(p_customer_name), ''), conversations.customer_name),
        customer_address = coalesce(nullif(btrim(p_customer_address), ''), conversations.customer_address),
        updated_at       = v_now
  returning *;
end;
$$;

-- Pembatas laju sliding-window sederhana yang dilihat SEMUA instance.
-- Mengembalikan {allowed, hits, retry_after}. Satu pernyataan upsert, jadi dua
-- request bersamaan tidak bisa sama-sama lolos dengan hitungan yang sama.
create or replace function public.bump_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max integer
) returns jsonb
language plpgsql as $$
declare
  v_now    timestamptz := now();
  v_cutoff timestamptz := now() - make_interval(secs => p_window_seconds);
  v_hits   integer;
  v_start  timestamptz;
begin
  -- Bersihkan sisa kunci lama sesekali supaya tabel tidak tumbuh tanpa batas
  -- (tanpa perlu cron). 1 dari ~200 pemanggilan sudah lebih dari cukup.
  if random() < 0.005 then
    delete from public.rate_limits where updated_at < v_now - interval '1 day';
  end if;

  insert into public.rate_limits as rl (key, window_start, hits, updated_at)
  values (p_key, v_now, 1, v_now)
  on conflict (key) do update
    set hits         = case when rl.window_start < v_cutoff then 1 else rl.hits + 1 end,
        window_start = case when rl.window_start < v_cutoff then v_now else rl.window_start end,
        updated_at   = v_now
  returning rl.hits, rl.window_start into v_hits, v_start;

  return jsonb_build_object(
    'allowed', v_hits <= p_max,
    'hits', v_hits,
    'retry_after',
      greatest(0, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - v_now))::integer)
  );
end;
$$;

grant execute on function public.trim_jsonb_tail(jsonb, integer) to service_role;
grant execute on function public.append_conversation_message(uuid, text, text, text, text, text, integer, text, text) to service_role;
grant execute on function public.bump_rate_limit(text, integer, integer) to service_role;

-- =====================================================================
--  MIGRASI untuk DB yang sudah ada (aman dijalankan berulang)
-- =====================================================================
alter table public.orders add column if not exists password_hash text;
alter table public.orders add column if not exists coupon_code text;
alter table public.stores add column if not exists password_hash text;
alter table public.stores add column if not exists trial_ends_at timestamptz;
alter table public.stores add column if not exists coupon_used text;
alter table public.stores add column if not exists reset_otp_hash text;
alter table public.stores add column if not exists reset_otp_expires timestamptz;
alter table public.stores add column if not exists webhook_url text;

-- Langganan berbayar & pengerasan reset password.
alter table public.orders add column if not exists is_renewal boolean not null default false;
alter table public.stores add column if not exists subscription_ends_at timestamptz;
alter table public.stores add column if not exists reset_otp_attempts integer not null default 0;
alter table public.stores add column if not exists password_changed_at timestamptz;

-- Default paket diturunkan ke yang TERKECIL. Baris lama tidak ikut berubah;
-- ini hanya menutup jalur "kolom tidak terisi → dapat Pro" untuk baris baru.
alter table public.stores alter column package_id set default 'starter';

-- Toko yang SUDAH berbayar sebelum kolom masa berlaku ada: beri satu periode
-- penuh dihitung dari sekarang. Jangan pakai created_at — itu akan langsung
-- menonaktifkan pelanggan yang sedang aktif dan membayar dengan itikad baik.
update public.stores
   set subscription_ends_at = now() + interval '30 days'
 where is_paid is true
   and subscription_ends_at is null;

-- Pindahkan device yang sudah ada di `stores` menjadi baris `store_devices`
-- utama. Hanya jalan untuk toko yang belum punya baris device sama sekali,
-- jadi aman diulang dan tidak menimpa nomor yang ditambahkan lewat dashboard.
--
-- Syarat `fonnte_token` terisi itu penting: hanya token yang membuktikan device
-- benar-benar ada di Fonnte. `customer_phone` selalu terisi sejak pendaftaran,
-- jadi toko yang belum pernah scan QR justru harus dibiarkan kosong supaya
-- dashboard menampilkan form "tambah nomor" (yang membuat device-nya), bukan
-- baris tanpa token yang tombol Scan QR-nya mentok.
insert into public.store_devices (store_id, label, phone, fonnte_token, device_status, webhook_url, is_primary)
select
  s.id,
  'Nomor utama',
  -- Normalkan ke 62xxx supaya cocok dengan field `device` pada webhook Fonnte.
  case
    when regexp_replace(s.customer_phone, '\D', '', 'g') like '62%'
      then regexp_replace(s.customer_phone, '\D', '', 'g')
    when regexp_replace(s.customer_phone, '\D', '', 'g') like '0%'
      then '62' || substr(regexp_replace(s.customer_phone, '\D', '', 'g'), 2)
    else '62' || regexp_replace(s.customer_phone, '\D', '', 'g')
  end,
  s.fonnte_token,
  coalesce(s.fonnte_device_status, 'DISCONNECTED'),
  s.webhook_url,
  true
from public.stores s
where s.customer_phone is not null
  and length(regexp_replace(s.customer_phone, '\D', '', 'g')) >= 9
  and s.fonnte_token is not null
  and s.fonnte_token <> ''
  and not exists (select 1 from public.store_devices d where d.store_id = s.id)
on conflict (phone) do nothing;

-- Ekspedisi yang dilayani, kurir toko, pembayaran, & gaya jawaban AI.
alter table public.stores add column if not exists active_couriers text[];
alter table public.stores add column if not exists local_courier jsonb;
alter table public.stores add column if not exists payment_accounts jsonb not null default '[]'::jsonb;
alter table public.stores add column if not exists cod_enabled boolean not null default false;
alter table public.stores add column if not exists payment_note text;
alter table public.stores add column if not exists ai_tone text not null default 'ramah';
alter table public.stores add column if not exists ai_include_total boolean not null default true;
alter table public.stores add column if not exists ai_include_payment boolean not null default true;

-- PENTING. `active_couriers` sudah ada sejak lama dengan default
-- array['jne','jnt','sicepat','pos'], tapi belum pernah DIBACA maupun DITULIS
-- oleh aplikasi. Begitu penyaringan ekspedisi dinyalakan, default itu berubah
-- menjadi regresi di setiap toko yang sudah jalan:
--   1. toko dibatasi ke 4 ekspedisi yang tidak pernah dipilih pemiliknya, dan
--   2. `jnt` bukan kode yang dikembalikan API (kodenya `jt`), jadi J&T justru
--      HILANG TOTAL dari kutipan — persis kurir terpopuler di Indonesia.
-- Karena itu default dilepas dan semantiknya menjadi: NULL/kosong = semua
-- ekspedisi. Baris yang isinya PERSIS sama dengan default lama pasti belum
-- pernah disentuh pemiliknya, jadi aman dikosongkan.
alter table public.stores alter column active_couriers drop default;
update public.stores set active_couriers = null
 where active_couriers is not null
   and active_couriers @> array['jne', 'jnt', 'sicepat', 'pos']
   and active_couriers <@ array['jne', 'jnt', 'sicepat', 'pos'];

-- Nilai `ai_tone` di luar daftar yang dikenal dikembalikan ke default supaya
-- prompt AI tidak pernah menerima nada yang tidak punya instruksi.
update public.stores set ai_tone = 'ramah'
 where ai_tone is null or ai_tone not in ('ramah', 'santai', 'formal', 'singkat');

-- Diagnosa jalur TERIMA per nomor (webhook pesan masuk Fonnte).
--
-- `autoread` SENGAJA dibiarkan NULL untuk baris yang sudah ada: itulah penanda
-- "belum pernah dinyalakan". Semua device yang tersambung sebelum ini punya URL
-- webhook yang benar tapi auto read mati, sehingga Fonnte tidak pernah memanggil
-- webhook-nya — bot tampak sehat di dashboard namun bisu saat pembeli chat.
-- NULL membuat sinkronisasi berikutnya (buka tab WhatsApp) memperbaikinya sekali.
alter table public.store_devices add column if not exists autoread boolean;
alter table public.store_devices add column if not exists last_inbound_at timestamptz;
alter table public.store_devices add column if not exists last_inbound_note text;

-- Alamat pembeli yang dipancing AI (nama sudah ada sejak awal sebagai
-- `customer_name`, tapi dulu tidak pernah ditulis aplikasi).
alter table public.conversations add column if not exists customer_address text;

-- Cakupan produk per nomor WhatsApp. `[]` = nomor umum (semua produk).
-- Sengaja default `[]` dan NOT NULL supaya kode tidak perlu membedakan
-- "belum diatur" dari "umum" — keduanya berarti hal yang sama.
alter table public.store_devices add column if not exists product_ids jsonb not null default '[]'::jsonb;

-- Daftar pesanan pembeli. Tabel + indeks + RLS + trigger-nya sudah dibuat di
-- bagian atas file dengan `if not exists`, jadi tidak ada yang perlu diulang di
-- sini; baris ini hanya memastikan kolom yang ditambahkan setelah rilis pertama
-- ikut menyusul di database yang sudah jalan.
alter table public.buyer_orders add column if not exists shipping_courier text;
alter table public.buyer_orders add column if not exists shipping_cost integer;
alter table public.buyer_orders add column if not exists note text;

-- Ambil alih percakapan oleh manusia.
--
-- `ai_paused` = AI DIAM di percakapan ini; pemilik toko yang menjawab sendiri.
-- Dinyalakan otomatis begitu pemilik mengirim balasan manual dari dashboard,
-- karena itulah tanda paling jujur bahwa ia sedang menangani pembeli ini. Tanpa
-- ini bot dan manusia menjawab pertanyaan yang sama dengan isi yang berbeda.
--
-- `last_seen_at` = kapan pemilik toko terakhir MEMBUKA percakapan ini di
-- dashboard. Dibandingkan dengan `updated_at` untuk menandai chat belum dibaca.
alter table public.conversations add column if not exists ai_paused boolean not null default false;
alter table public.conversations add column if not exists ai_paused_at timestamptz;
alter table public.conversations add column if not exists last_seen_at timestamptz;

-- Foto produk. URL saja (dihosting di luar, mis. Supabase Storage/CDN) — tidak
-- ada kolom biner supaya baris katalog tetap ringan saat dikirim ke prompt AI.
alter table public.products add column if not exists image_url text;

-- Daur hidup pesanan pembeli: 'new' → 'paid' → 'shipped' → 'done'.
--
-- Sebelumnya hanya ada 'new' | 'done', jadi pemilik toko tidak punya tempat
-- mencatat "sudah dibayar" atau nomor resi dan harus memakai buku catatan lain.
-- Tidak ada CHECK constraint pada `status`: menambah status baru nanti tidak
-- boleh butuh migrasi yang mengubah constraint di database yang sudah jalan.
--
-- CATATAN PENTING soal `buyer_orders_open_uidx` (partial unique where status =
-- 'new'): slot "pesanan berjalan" tetap hanya untuk status 'new'. Begitu pemilik
-- menandai 'paid', pesanan itu terkunci dari penggabungan otomatis dan chat
-- berikutnya dari pembeli yang sama membuat baris BARU. Itu memang yang
-- diinginkan — barang yang sudah dibayar tidak boleh diam-diam bertambah isi.
alter table public.buyer_orders add column if not exists payment_proof_url text;
alter table public.buyer_orders add column if not exists paid_at timestamptz;
alter table public.buyer_orders add column if not exists tracking_number text;
alter table public.buyer_orders add column if not exists shipped_at timestamptz;

create index if not exists buyer_orders_status_idx on public.buyer_orders (store_id, status);

-- Pemberitahuan keluar untuk pemilik toko.
--
-- `alert_phone` = nomor WhatsApp PRIBADI pemilik (bukan nomor toko). Peringatan
-- "nomor terputus" harus dikirim ke nomor lain, sebab nomor yang terputus itu
-- justru yang tidak bisa mengirim apa pun.
alter table public.stores add column if not exists alert_phone text;
alter table public.stores add column if not exists notify_enabled boolean not null default true;
alter table public.stores add column if not exists last_quota_alert_at timestamptz;
alter table public.stores add column if not exists last_quota_alert_pct integer;

-- Anti-spam peringatan per nomor: satu kabar per kejadian, bukan tiap polling.
alter table public.store_devices add column if not exists last_alert_at timestamptz;
alter table public.store_devices add column if not exists last_alert_kind text;

-- Login tambahan per toko (pegawai/admin kedua).
--
-- SENGAJA tabel terpisah, bukan mengubah `stores.email` yang unik: jalur login
-- pemilik yang sudah berjalan tidak boleh tersentuh sama sekali. Login mencoba
-- `stores` dulu, baru jatuh ke tabel ini — pelanggan yang sudah bayar tidak
-- mungkin kehilangan akses karena fitur ini.
create table if not exists public.store_members (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores(id) on delete cascade,
  email               text not null,
  password_hash       text not null,
  role                text not null default 'staff',   -- 'staff' | 'admin'
  password_changed_at timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Satu email = satu akun di SELURUH sistem, termasuk lintas toko: kalau tidak,
-- `getSessionEmail()` tidak bisa memutuskan toko mana yang dimaksud sebuah sesi.
create unique index if not exists store_members_email_uidx on public.store_members (lower(email));
create index if not exists store_members_store_idx on public.store_members (store_id);

alter table public.store_members enable row level security;

drop trigger if exists trg_store_members_updated_at on public.store_members;
create trigger trg_store_members_updated_at before update on public.store_members
  for each row execute function public.set_updated_at();

-- Email akun toko: satu identitas, tanpa peduli huruf besar/kecil.
--
-- `stores.email unique` di atas bersifat CASE-SENSITIVE, jadi `Budi@Gmail.com`
-- dan `budi@gmail.com` bisa hidup berdampingan sebagai DUA akun. Itu bukan
-- kejanggalan kosmetik: checkout mencari toko berdasarkan email, dan kalau
-- pelanggan mengetik huruf yang berbeda dari saat mendaftar, pembayarannya
-- dihitung sebagai akun baru — uang masuk, akun lamanya tetap kedaluwarsa, dan
-- nomor WhatsApp-nya tidak bisa dipindahkan ke akun baru itu karena
-- `store_devices_phone_uidx` unik untuk seluruh sistem.
--
-- Dua langkah, dan urutannya penting: rapikan datanya dulu, baru pasang indeks.
--
-- PERIKSA DULU sebelum menjalankan. Indeks di bawah akan GAGAL bila masih ada
-- dua akun yang hanya berbeda huruf, dan pasangan seperti itu HARUS digabung
-- manual (pilih yang punya `store_devices`/`buyer_orders`) — bukan dihapus
-- sembarangan, karena salah satunya bisa milik pelanggan yang sudah bayar:
--
--   select lower(email), count(*), array_agg(email)
--   from public.stores group by 1 having count(*) > 1;
--
update public.stores set email = lower(email) where email <> lower(email);
update public.orders set customer_email = lower(customer_email)
  where customer_email is not null and customer_email <> lower(customer_email);

create unique index if not exists stores_email_lower_uidx on public.stores (lower(email));

-- Pengingat masa aktif akan berakhir (dikirim oleh cron harian).
--
-- Anti-ulangnya meniru `last_quota_alert_pct`: yang disimpan adalah AMBANG
-- terakhir yang sudah dikabari (3 = H-3, 1 = H-1, 0 = hari-H atau sesudahnya),
-- bukan sekadar waktu kirimnya. Tanpa itu cron harian akan mengirim pesan yang
-- sama setiap hari, dan pengingat yang berisik adalah pengingat yang diabaikan.
--
-- Waktunya (`last_expiry_alert_at`) dipakai untuk hal berbeda: catatan yang lebih
-- tua dari jendela pengingat tanggal akhir yang SEKARANG dianggap milik periode
-- sebelumnya dan diabaikan. Itulah yang membuat perpanjangan otomatis membuka
-- kembali pengingat — tanpa itu, ambang 0 yang tersimpan akan membungkam
-- pengingat selamanya. Logikanya di `lib/notify.ts`.
alter table public.stores add column if not exists last_expiry_alert_days integer;
alter table public.stores add column if not exists last_expiry_alert_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
--  RPC: kurangi stok beberapa produk sekaligus, atomik.
--
--  KENAPA RPC: mengurangi stok lewat REST butuh baca-lalu-tulis, dan dua pesanan
--  yang masuk bersamaan akan sama-sama membaca stok lama lalu menuliskan hasil
--  yang sama — satu pesanan hilang dari hitungan. `stock - units` dievaluasi di
--  dalam satu pernyataan UPDATE, jadi tidak ada celah di antaranya.
--
--  `greatest(0, ...)` supaya stok tidak pernah negatif walau pesanan lolos
--  (mis. dua pembeli mengambil unit terakhir pada detik yang sama). Nol berarti
--  "habis" dan langsung tercermin di prompt AI berikutnya.
--
--  p_items: [{"name": "...", "units": 2}] atau [{"id": "<uuid>", "units": 2}].
--  Nama dipakai bila id tidak ada, karena pesanan menyimpan SNAPSHOT nama produk.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.decrement_product_stock(
  p_store_id uuid,
  p_items    jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    jsonb;
  v_units   integer;
  v_id      uuid;
  v_name    text;
  v_touched integer := 0;
  v_hit     integer;
begin
  if p_store_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_units := coalesce((v_item ->> 'units')::integer, 0);
    if v_units <= 0 then
      continue;
    end if;

    begin
      v_id := nullif(v_item ->> 'id', '')::uuid;
    exception when others then
      v_id := null;
    end;
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');

    if v_id is not null then
      update public.products
         set stock = greatest(0, stock - v_units)
       where id = v_id and store_id = p_store_id;
    elsif v_name is not null then
      update public.products
         set stock = greatest(0, stock - v_units)
       where store_id = p_store_id and lower(name) = lower(v_name);
    else
      continue;
    end if;

    get diagnostics v_hit = row_count;
    v_touched := v_touched + v_hit;
  end loop;

  return v_touched;
end;
$$;


-- ────────────────────────────────────────────────────────────────────────────
--  HAK AKSES RPC: cabut EXECUTE dari peran publik.
--
--  Postgres memberi EXECUTE kepada PUBLIC pada SETIAP fungsi baru, dan Supabase
--  menambah default privilege untuk `anon` + `authenticated` di schema public.
--  Untuk `decrement_product_stock` gabungan itu berbahaya: fungsi tersebut
--  `security definer`, jadi ia berjalan sebagai pemiliknya dan MELEWATI RLS.
--  Tanpa pencabutan di bawah, siapa pun yang memegang anon key — dan kunci itu
--  memang dirancang untuk ditempel di browser — cukup menebak/mengetahui satu
--  UUID toko untuk memanggil
--
--    POST /rest/v1/rpc/decrement_product_stock
--
--  dan mengosongkan stok toko mana pun.
--
--  Tiga fungsi lain BUKAN `security definer`, jadi RLS sudah menahan mereka.
--  Pencabutannya tetap dipasang sebagai pertahanan berlapis: kalau suatu hari
--  salah satunya dinaikkan menjadi `security definer`, hak aksesnya sudah benar
--  sejak sebelum perubahan itu dibuat.
--
--  Aplikasi tidak terpengaruh: semua pemanggilan memakai SERVICE ROLE key, dan
--  peran itu tetap mendapat EXECUTE lewat `grant` di atas serta di blok ini.
--
--  Dijalankan lewat DO block, bukan pernyataan `revoke` telanjang, karena
--  `revoke ... from anon` akan menggagalkan seluruh skrip pada Postgres biasa
--  yang tidak punya peran bawaan Supabase. Blok ini aman diulang.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_fn   text;
  v_role text;
begin
  for v_fn in
    select unnest(array[
      'public.decrement_product_stock(uuid, jsonb)',
      'public.trim_jsonb_tail(jsonb, integer)',
      'public.bump_rate_limit(text, integer, integer)',
      'public.append_conversation_message(uuid, text, text, text, text, text, integer, text, text)'
    ])
  loop
    execute format('revoke execute on function %s from public', v_fn);

    for v_role in
      select rolname from pg_roles where rolname in ('anon', 'authenticated')
    loop
      execute format('revoke execute on function %s from %I', v_fn, v_role);
    end loop;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.decrement_product_stock(uuid, jsonb) to service_role';
  end if;
end;
$$;
