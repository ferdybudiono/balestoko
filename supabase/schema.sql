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
  customer_name         text default 'Pembeli WA',
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

-- 6. Tabel Rate Limits (pembatas laju lintas-instance)
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
create or replace function public.append_conversation_message(
  p_store_id uuid,
  p_phone text,
  p_user_msg text,
  p_assistant_reply text,
  p_intent text default null,
  p_destination_city text default null,
  p_max_messages integer default 200
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
    store_id, customer_phone, messages, last_intent, destination_city, updated_at
  )
  values (
    p_store_id, p_phone, public.trim_jsonb_tail(v_new, p_max_messages),
    p_intent, p_destination_city, v_now
  )
  on conflict (store_id, customer_phone) do update
    set messages         = public.trim_jsonb_tail(conversations.messages || v_new, p_max_messages),
        last_intent      = coalesce(p_intent, conversations.last_intent),
        destination_city = coalesce(p_destination_city, conversations.destination_city),
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
grant execute on function public.append_conversation_message(uuid, text, text, text, text, text, integer) to service_role;
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

