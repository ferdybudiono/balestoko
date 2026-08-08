-- =====================================================================
--  Skema tabel `orders` untuk BotWA CS AI
--  Jalankan di Supabase: Dashboard -> SQL Editor -> New query -> Run
-- =====================================================================

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
  snap_token        text,
  raw_notification  jsonb,                          -- payload webhook Midtrans terakhir
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Index bantu untuk pencarian & laporan
create index if not exists orders_order_id_idx  on public.orders (order_id);
create index if not exists orders_status_idx    on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- =====================================================================
--  Row Level Security
--  Aplikasi mengakses tabel ini HANYA dari server memakai SERVICE_ROLE_KEY,
--  yang otomatis mem-bypass RLS. Jadi cukup aktifkan RLS tanpa policy publik
--  agar tabel tidak bisa dibaca/ditulis dari anon/public key.
-- =====================================================================
alter table public.orders enable row level security;

-- (Opsional) auto-update kolom updated_at pada setiap UPDATE
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
