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
  password_hash     text,                           -- hash password (scrypt) — disalin ke stores saat PAID
  coupon_code       text,                           -- kode kupon yang dipakai (mis. 'ferdybudiono'), null jika tanpa kupon
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
  package_id            text default 'pro',

  -- Trial & Kupon
  trial_ends_at         timestamptz,                    -- akhir masa uji coba 7 hari (null jika bukan/atau sudah bayar)
  coupon_used           text,                           -- kode kupon yang sudah pernah dipakai akun ini (sekali pakai)

  -- Reset Password via WhatsApp OTP
  reset_otp_hash        text,                           -- hash (scrypt) dari OTP reset password
  reset_otp_expires     timestamptz,                    -- kedaluwarsa OTP reset (mis. 10 menit)

  -- Fonnte WA Settings
  fonnte_token          text,
  fonnte_device_status  text default 'DISCONNECTED',
  webhook_url           text,                            -- URL webhook incoming chat yang sudah disinkronkan ke device
  
  -- Mengantar API (Ongkir) Settings
  mengantar_api_key     text,
  origin_subdistrict_id text default '3171010',      -- Contoh default: Jakarta Pusat / Gambir
  origin_city_name      text default 'Jakarta Pusat',
  default_weight        integer default 1000,          -- Gram (1 kg)
  active_couriers       text[] default array['jne', 'jnt', 'sicepat', 'pos'],
  
  -- AI CS Agent Configuration
  ai_prompt_system      text default 'Kamu adalah Customer Service AI yang ramah dan profesional. Tugasmu adalah menyapa pembeli dengan hangat, menjawab pertanyaan produk, dan membantu mengecek tarif ongkos kirim (ongkir) menggunakan kurir ekspedisi.',
  greeting_message      text default 'Halo! Selamat datang di toko kami 👋 Ada yang bisa kami bantu mengenai produk atau cek tarif ongkir ke kota Kakak?',
  
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

-- Indexing
create index if not exists orders_order_id_idx on public.orders (order_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists stores_email_idx on public.stores (email);
create index if not exists stores_fonnte_token_idx on public.stores (fonnte_token);
create index if not exists conversations_store_phone_idx on public.conversations (store_id, customer_phone);

-- RLS Enablement
alter table public.orders enable row level security;
alter table public.stores enable row level security;

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
