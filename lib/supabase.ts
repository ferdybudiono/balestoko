/**
 * Klien Supabase PostgREST (REST API bawaan Supabase) —
 * tanpa memerlukan SDK tambahan.
 *
 * Semua fungsi di sini SERVER-ONLY karena memakai SERVICE_ROLE_KEY.
 */

import { maxDevicesForPackage, monthStartMs, subscriptionEndAfterPayment } from "@/lib/packages";
import type { LocalCourierConfig } from "@/lib/couriers";
import type { PaymentAccount } from "@/lib/reply-format";

function getConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured(): boolean {
  return getConfig() !== null;
}

export interface StoreRecord {
  id?: string;
  email: string;
  store_name: string;
  password_hash?: string;
  customer_name?: string;
  customer_phone?: string;
  is_paid?: boolean;
  package_id?: string;
  /** Akhir masa uji coba 7 hari (ISO). Null bila bukan trial / sudah bayar. */
  trial_ends_at?: string | null;
  /** Akhir periode berbayar (ISO). Ditegakkan `isStoreActive` — lihat catatan di sana. */
  subscription_ends_at?: string | null;
  /** Kode kupon yang sudah pernah dipakai akun ini (sekali pakai). */
  coupon_used?: string | null;
  /** Hash (scrypt) OTP reset password + kedaluwarsanya. */
  reset_otp_hash?: string | null;
  reset_otp_expires?: string | null;
  /** Percobaan OTP gagal berturut-turut; OTP dibatalkan setelah batas. */
  reset_otp_attempts?: number | null;
  /** Sesi yang diterbitkan sebelum waktu ini ditolak (mencabut sesi lama). */
  password_changed_at?: string | null;
  fonnte_token?: string;
  fonnte_device_status?: string;
  /** URL webhook incoming chat yang sudah disinkronkan ke device (idempotensi). */
  webhook_url?: string | null;
  mengantar_api_key?: string;
  origin_subdistrict_id?: string;
  origin_city_name?: string;
  default_weight?: number;
  /**
   * Kode grup ekspedisi yang dilayani toko (lihat `lib/couriers.ts`).
   * NULL / array kosong = semua ekspedisi ditawarkan.
   */
  active_couriers?: string[] | null;
  /** Kurir toko sendiri: `{enabled, label, cost, etd}`; cost 0 = "tanya dulu". */
  local_courier?: LocalCourierConfig | null;
  /** Rekening/e-wallet tujuan transfer (maks 3). */
  payment_accounts?: PaymentAccount[] | null;
  cod_enabled?: boolean | null;
  payment_note?: string | null;
  ai_prompt_system?: string;
  greeting_message?: string;
  /** `ramah` | `santai` | `formal` | `singkat`. */
  ai_tone?: string | null;
  /** Jumlahkan subtotal produk + ongkir pada balasan ongkir. */
  ai_include_total?: boolean | null;
  /** Sertakan blok instruksi pembayaran pada balasan ongkir. */
  ai_include_payment?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Satu nomor WhatsApp (device Fonnte) milik sebuah toko.
 *
 * Jumlah baris per toko dibatasi paketnya (`maxDevicesForPackage`). Device
 * `is_primary` dipakai untuk pesan non-percakapan seperti OTP reset password,
 * dan tokennya dicerminkan ke `stores.fonnte_token`.
 */
export interface StoreDeviceRecord {
  id?: string;
  store_id: string;
  label?: string | null;
  phone: string;
  fonnte_token?: string | null;
  device_status?: string | null;
  webhook_url?: string | null;
  /**
   * `autoread` device di Fonnte terakhir kali kita nyalakan/lihat.
   *
   * Fonnte tidak memanggil webhook pesan masuk kalau auto read mati, jadi kolom
   * ini yang membedakan "webhook sudah terpasang" dari "webhook benar-benar
   * akan dipanggil". `null` = belum pernah diurus (device pra-perbaikan).
   */
  autoread?: boolean | null;
  /** Kapan pesan masuk dari Fonnte terakhir kali TIBA untuk nomor ini. */
  last_inbound_at?: string | null;
  /** Apa yang terjadi pada pesan masuk terakhir ("Dibalas AI", alasan diabaikan, …). */
  last_inbound_note?: string | null;
  is_primary?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProductRecord {
  id?: string;
  store_id: string;
  name: string;
  price: number;
  weight: number;
  stock?: number;
  description?: string;
  created_at?: string;
}

export interface ConversationRecord {
  id?: string;
  store_id: string;
  customer_phone: string;
  customer_name?: string;
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>;
  last_intent?: string;
  destination_city?: string;
  updated_at?: string;
  created_at?: string;
}

export interface OrderRecord {
  order_id: string;
  package_id: string;
  package_name: string;
  gross_amount: number;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  store_name: string;
  /** Hash password akun BARU. Null pada perpanjangan — lihat `is_renewal`. */
  password_hash?: string | null;
  coupon_code?: string | null;
  /**
   * Order ini memperpanjang / meng-upgrade akun yang SUDAH ada.
   * Dipakai untuk audit; penegakannya sendiri tidak bergantung pada flag ini
   * (`applyPaidOrderToStore` selalu memeriksa ulang keberadaan toko).
   */
  is_renewal?: boolean;
  snap_token?: string | null;
  raw_notification?: Record<string, unknown> | null;
}

/** Field langganan yang dibutuhkan untuk menilai keaktifan sebuah toko. */
type ActivityFields = Pick<StoreRecord, "is_paid" | "trial_ends_at" | "subscription_ends_at">;

/**
 * Apakah toko masih boleh mengakses layanan?
 *
 * Aktif bila **periode berbayarnya belum lewat**, atau masih dalam masa uji coba
 * yang belum kedaluwarsa.
 *
 * Catatan penting soal `subscription_ends_at` yang kosong: halaman harga menjual
 * `/bulan`, jadi `is_paid` saja TIDAK boleh berarti akses selamanya. Tetapi baris
 * peninggalan versi lama (dan DB yang belum menjalankan migrasi kolom ini) tidak
 * punya tanggal akhir sama sekali — memperlakukannya sebagai kedaluwarsa akan
 * mematikan pelanggan yang sedang membayar. Jadi kolom kosong = masih aktif, dan
 * `schema.sql` mengisinya satu periode ke depan saat migrasi dijalankan.
 */
export function isStoreActive(store: ActivityFields | null | undefined): boolean {
  if (!store) return false;

  if (store.is_paid) {
    if (!store.subscription_ends_at) return true; // baris lama / belum termigrasi
    const ends = new Date(store.subscription_ends_at).getTime();
    if (Number.isFinite(ends) && ends > Date.now()) return true;
    // Langganan berbayar lewat — masih boleh lanjut kalau trialnya (jarang) aktif.
  }

  if (store.trial_ends_at) {
    const ends = new Date(store.trial_ends_at).getTime();
    return Number.isFinite(ends) && ends > Date.now();
  }
  return false;
}

/**
 * Kenapa toko tidak aktif — supaya dashboard bisa membedakan "trial habis, ayo
 * langganan" dari "langganan habis, ayo perpanjang". Keduanya sama-sama diblokir
 * bot, tapi kalimat yang benar berbeda.
 */
export type StoreActivityState = "active" | "trial" | "trial_expired" | "subscription_expired" | "inactive";

export function storeActivityState(store: ActivityFields | null | undefined): StoreActivityState {
  if (!store) return "inactive";
  const paidActive =
    !!store.is_paid &&
    (!store.subscription_ends_at || new Date(store.subscription_ends_at).getTime() > Date.now());
  if (paidActive) return "active";

  const trialEnds = store.trial_ends_at ? new Date(store.trial_ends_at).getTime() : NaN;
  const trialActive = Number.isFinite(trialEnds) && trialEnds > Date.now();
  if (trialActive) return "trial";

  if (store.is_paid) return "subscription_expired";
  if (Number.isFinite(trialEnds)) return "trial_expired";
  return "inactive";
}

interface DbResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  skipped?: boolean;
  /** Operasi tidak dijalankan karena state-nya sudah tercapai (notifikasi duplikat). */
  duplicate?: boolean;
}

function headers(key: string, prefer: string = "return=representation"): HeadersInit {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer
  };
}

// ---------------- ORDER METHODS ----------------

export async function insertPendingOrder(order: OrderRecord): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) {
    console.warn("[supabase] Env belum di-set — lewati insert order.");
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`${cfg.url}/rest/v1/orders`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(order),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Terapkan sebuah order yang LUNAS ke tabel `stores`.
 *
 * Dua aturan yang tidak boleh dilanggar di sini:
 *
 * 1. **Kalau tokonya sudah ada, jangan pernah menimpa kredensial & identitasnya.**
 *    Order menyimpan `password_hash` dari form checkout. Menyalinnya ke baris yang
 *    sudah ada berarti: (a) pelanggan sah yang checkout ulang untuk upgrade tanpa
 *    sadar mereset password / nama toko / nomornya sendiri, dan (b) siapa pun yang
 *    tahu email orang lain bisa membayar paket lalu mengambil alih akun itu dengan
 *    password pilihannya. Perpanjangan hanya menyentuh field HAK PAKAI.
 *
 * 2. **Masa berlaku dihitung dari akhir periode yang masih ada**, supaya
 *    perpanjangan lebih awal tidak menghanguskan sisa hari yang sudah dibayar.
 */
async function applyPaidOrderToStore(order: OrderRecord): Promise<DbResult<StoreRecord>> {
  const email = (order.customer_email || "").trim();
  if (!email) return { ok: false, error: "order tanpa customer_email" };

  const existing = await getStoreByEmail(email);
  const subscriptionEndsAt = subscriptionEndAfterPayment(existing?.subscription_ends_at);

  // Field hak pakai — satu-satunya yang boleh berubah pada perpanjangan.
  const entitlement = {
    is_paid: true,
    package_id: order.package_id,
    subscription_ends_at: subscriptionEndsAt,
    // Pembayaran lunas → hentikan masa trial (akun sudah penuh).
    trial_ends_at: null,
    // Tandai kupon terpakai supaya tidak bisa dipakai lagi oleh akun ini.
    ...(order.coupon_code ? { coupon_used: order.coupon_code } : {})
  };

  if (existing) {
    console.info(
      `[supabase] order ${order.order_id} diterapkan sebagai PERPANJANGAN untuk ${email} ` +
        `(paket ${order.package_id}, aktif s/d ${subscriptionEndsAt}).`
    );
    return upsertStore({ email, ...entitlement });
  }

  // Akun baru: di sinilah — dan hanya di sini — kredensial dari form dipakai.
  return upsertStore({
    email,
    store_name: order.store_name,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    ...(order.password_hash ? { password_hash: order.password_hash } : {}),
    ...entitlement
  });
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  rawNotification?: Record<string, unknown>
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    // Midtrans boleh mengirim notifikasi yang SAMA berkali-kali (retry, atau
    // settlement menyusul capture). Untuk PAID, transisinya dikunci dengan
    // `status=neq.PAID`: hanya request yang benar-benar mengubah status akan
    // mengembalikan baris, jadi masa langganan mustahil diperpanjang dua kali
    // oleh satu pembayaran.
    const paidTransition = status === "PAID";
    const url =
      `${cfg.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}` +
      (paidTransition ? "&status=neq.PAID" : "");

    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({
        status,
        raw_notification: rawNotification ?? null,
        updated_at: new Date().toISOString()
      }),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `update ${res.status}: ${text}` };
    }

    const updated = await res.json();
    const rows = Array.isArray(updated) ? updated : [];

    if (paidTransition && rows.length === 0) {
      // Sudah PAID sebelumnya (notifikasi duplikat) — bukan error, dan TIDAK
      // boleh diterapkan ulang ke `stores`.
      console.info(`[supabase] order ${orderId} sudah berstatus PAID, notifikasi duplikat diabaikan.`);
      return { ok: true, data: [], duplicate: true };
    }

    if (paidTransition && rows.length > 0) {
      const applied = await applyPaidOrderToStore(rows[0] as OrderRecord);
      if (!applied.ok) {
        console.error(`[supabase] order ${orderId} PAID tapi gagal mengaktifkan toko:`, applied.error);
      }
    }

    return { ok: true, data: updated };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- STORE METHODS ----------------

export async function getStoreByEmail(email: string): Promise<StoreRecord | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  try {
    const url = `${cfg.url}/rest/v1/stores?email=eq.${encodeURIComponent(email)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreRecord) : null;
  } catch {
    return null;
  }
}

export async function getStoreByFonnteToken(token: string): Promise<StoreRecord | null> {
  const cfg = getConfig();
  if (!cfg || !token) return null;

  try {
    const url = `${cfg.url}/rest/v1/stores?fonnte_token=eq.${encodeURIComponent(token)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreRecord) : null;
  } catch {
    return null;
  }
}

export async function upsertStore(store: Partial<StoreRecord> & { email: string }): Promise<DbResult<StoreRecord>> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const existing = await getStoreByEmail(store.email);
    let res: Response;

    if (existing && existing.id) {
      // Update
      const url = `${cfg.url}/rest/v1/stores?id=eq.${existing.id}`;
      res = await fetch(url, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({ ...store, updated_at: new Date().toISOString() }),
        cache: "no-store"
      });
    } else {
      // Insert
      res = await fetch(`${cfg.url}/rest/v1/stores`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify(store),
        cache: "no-store"
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `store upsert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Bentuk-bentuk nomor yang mungkin tersimpan untuk satu nomor WA yang sama.
 *
 * Nomor bisa masuk sebagai 62xxx, 08xxx, atau angka mentah tergantung dari mana
 * datangnya (input user, payload Fonnte, data lama). Pencarian harus mencoba
 * semuanya, kalau tidak pesan masuk gagal dirutekan hanya karena selisih format.
 */
function phoneCandidates(phone: string): string[] {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 8) return [];
  const wa62 = digits.startsWith("62")
    ? digits
    : digits.startsWith("0")
    ? "62" + digits.slice(1)
    : "62" + digits;
  return Array.from(new Set([wa62, "0" + wa62.slice(2), digits]));
}

export async function getStoreById(id: string): Promise<StoreRecord | null> {
  const cfg = getConfig();
  if (!cfg || !id) return null;

  try {
    const url = `${cfg.url}/rest/v1/stores?id=eq.${encodeURIComponent(id)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreRecord) : null;
  } catch {
    return null;
  }
}

// ---------------- STORE DEVICE METHODS ----------------

export async function listStoreDevices(storeId: string): Promise<StoreDeviceRecord[]> {
  const cfg = getConfig();
  if (!cfg || !storeId) return [];

  try {
    const url = `${cfg.url}/rest/v1/store_devices?store_id=eq.${encodeURIComponent(
      storeId
    )}&order=is_primary.desc,created_at.asc`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) return [];
    return (await res.json()) as StoreDeviceRecord[];
  } catch {
    return [];
  }
}

/**
 * Bentuk device yang AMAN dikirim ke browser.
 *
 * Satu definisi dipakai semua endpoint: kalau pemetaan ini disalin-tempel per
 * route, cukup satu yang lupa membuang `fonnte_token` dan token device toko bocor
 * ke browser (bisa dipakai mengirim WhatsApp atas nama toko itu).
 */
export interface PublicStoreDevice {
  id?: string;
  label: string | null;
  phone: string;
  device_status: string;
  is_primary: boolean;
  has_token: boolean;
  created_at?: string;
  /**
   * Diagnosa jalur TERIMA (pesan pembeli → webhook). Tanpa ini pemilik toko
   * tidak punya cara membedakan "belum ada yang chat" dari "bot tidak pernah
   * menerima chat", dua kondisi yang tampak identik dari dashboard.
   *
   * CATATAN: `webhook_url` sengaja TIDAK ada di sini. URL aslinya memuat
   * `FONNTE_WEBHOOK_SECRET` yang berlaku untuk SEMUA tenant — bila ikut terkirim,
   * pemilik toko mana pun bisa memalsukan pesan masuk untuk nomor toko lain.
   * `/api/fonnte/devices` menambahkannya khusus untuk panel diagnosa, dan wajib
   * melewatkannya lewat `redactWebhookUrl` lebih dulu.
   */
  autoread: boolean | null;
  last_inbound_at: string | null;
  last_inbound_note: string | null;
}

export function toPublicDevice(device: StoreDeviceRecord): PublicStoreDevice {
  return {
    id: device.id,
    label: device.label || null,
    phone: device.phone,
    device_status: device.device_status || "DISCONNECTED",
    is_primary: !!device.is_primary,
    has_token: !!device.fonnte_token,
    created_at: device.created_at,
    autoread: device.autoread ?? null,
    last_inbound_at: device.last_inbound_at || null,
    last_inbound_note: device.last_inbound_note || null
  };
}

/**
 * Daftar device untuk ditampilkan/dikelola, dengan jaring pengaman migrasi.
 *
 * `legacy: true` berarti tabel `store_devices` belum ada atau belum terisi untuk
 * toko ini, sementara kolom lama `stores.fonnte_token` menunjukkan ada device
 * yang sudah tersambung. Dalam kondisi itu nomornya tetap kita tampilkan (biar
 * dashboard tidak terlihat "kosong" padahal bot jalan), tapi penambahan dan
 * penghapusan nomor harus ditolak sampai SQL-nya dijalankan.
 */
export async function listStoreDevicesCompat(
  store: StoreRecord
): Promise<{ devices: StoreDeviceRecord[]; legacy: boolean }> {
  const devices = await listStoreDevices(store.id || "");
  if (devices.length > 0) return { devices, legacy: false };
  // Hanya `fonnte_token` yang membuktikan device pernah dibuat. `customer_phone`
  // selalu terisi sejak pendaftaran, jadi tidak bisa dipakai sebagai penanda.
  if (store.fonnte_token) {
    return { devices: [legacyDeviceFromStore(store, store.customer_phone || "")], legacy: true };
  }
  return { devices: [], legacy: false };
}

/**
 * Device utama sebuah toko — dipakai jalur yang memang harus memakai satu nomor
 * tetap (OTP reset password, uji kirim default).
 */
export async function getPrimaryStoreDevice(store: StoreRecord): Promise<StoreDeviceRecord | null> {
  const { devices } = await listStoreDevicesCompat(store);
  return devices.find((d) => d.is_primary) || devices[0] || null;
}

/**
 * Apakah device ini masih dalam kuota nomor paketnya?
 *
 * Menolak penambahan nomor saja tidak cukup: toko yang trial (kuota Pro, 3 nomor)
 * lalu berlangganan Starter akan tetap punya 3 nomor tersambung. Tanpa
 * pemeriksaan ini, batas paket hanya berlaku bagi yang belum pernah trial.
 *
 * Urutannya sama dengan yang ditampilkan dashboard (`is_primary` dulu, lalu yang
 * terlama), jadi nomor yang "di luar kuota" bisa ditunjukkan ke user — bukan mati
 * diam-diam.
 *
 * Biaya query ditekan: device utama selalu lolos tanpa query (batas terkecil pun
 * 1 nomor), jadi toko Starter satu-nomor tidak pernah membayar tambahan ini.
 */
export async function isDeviceWithinPlanLimit(
  store: StoreRecord,
  device: StoreDeviceRecord
): Promise<boolean> {
  if (device.is_primary) return true;

  const limit = maxDevicesForPackage(store.package_id);
  const devices = await listStoreDevices(store.id || "");
  if (devices.length <= limit) return true;

  return devices.slice(0, limit).some((d) => d.id === device.id);
}

export async function getStoreDeviceByPhone(phone: string): Promise<StoreDeviceRecord | null> {
  const cfg = getConfig();
  const candidates = phoneCandidates(phone);
  if (!cfg || candidates.length === 0) return null;

  try {
    const orExpr = `or=(${candidates.map((c) => `phone.eq.${c}`).join(",")})`;
    const url = `${cfg.url}/rest/v1/store_devices?${orExpr}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreDeviceRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Cari toko + device penerima berdasarkan NOMOR device WhatsApp.
 *
 * Webhook Fonnte mengirim field `device` = nomor device penerima (payload masuk
 * memang tidak memuat token), jadi ini jalur utama perutean pesan masuk.
 *
 * FALLBACK: bila tabel `store_devices` belum ada (migrasi belum dijalankan) atau
 * nomornya belum termigrasi, jatuh ke cara lama lewat `stores.customer_phone`
 * dan device disusun dari kolom-kolom `stores`. Tanpa ini, men-deploy kode ini
 * sebelum menjalankan SQL-nya akan mematikan seluruh bot.
 */
export async function getStoreAndDeviceByPhone(
  phone: string
): Promise<{ store: StoreRecord; device: StoreDeviceRecord } | null> {
  const device = await getStoreDeviceByPhone(phone);
  if (device?.store_id) {
    const store = await getStoreById(device.store_id);
    if (store) return { store, device };
  }

  const legacy = await getStoreByLegacyDevicePhone(phone);
  if (!legacy) return null;
  return { store: legacy, device: legacyDeviceFromStore(legacy, phone) };
}

/**
 * Cari toko + device berdasarkan DEVICE token.
 *
 * Payload webhook Fonnte tidak memuat token, jadi ini hanya jalur cadangan bila
 * suatu konfigurasi mengirimkannya lewat body/header.
 */
export async function getStoreAndDeviceByToken(
  token: string
): Promise<{ store: StoreRecord; device: StoreDeviceRecord } | null> {
  const cfg = getConfig();
  if (!cfg || !token) return null;

  try {
    const url = `${cfg.url}/rest/v1/store_devices?fonnte_token=eq.${encodeURIComponent(token)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (res.ok) {
      const list = await res.json();
      const device = Array.isArray(list) && list.length > 0 ? (list[0] as StoreDeviceRecord) : null;
      if (device?.store_id) {
        const store = await getStoreById(device.store_id);
        if (store) return { store, device };
      }
    }
  } catch {
    // Lanjut ke fallback legacy di bawah.
  }

  const legacy = await getStoreByFonnteToken(token);
  if (!legacy) return null;
  return { store: legacy, device: legacyDeviceFromStore(legacy, legacy.customer_phone || "") };
}

/** Susun device dari kolom-kolom `stores` (data pra-`store_devices`). */
function legacyDeviceFromStore(store: StoreRecord, phone: string): StoreDeviceRecord {
  return {
    store_id: store.id || "",
    phone: store.customer_phone || phone,
    fonnte_token: store.fonnte_token,
    device_status: store.fonnte_device_status,
    webhook_url: store.webhook_url,
    is_primary: true
  };
}

/** Pencarian device gaya lama (pra-`store_devices`) — hanya untuk fallback. */
async function getStoreByLegacyDevicePhone(phone: string): Promise<StoreRecord | null> {
  const cfg = getConfig();
  const candidates = phoneCandidates(phone);
  if (!cfg || candidates.length === 0) return null;

  try {
    const orExpr = `or=(${candidates.map((c) => `customer_phone.eq.${c}`).join(",")})`;
    const url = `${cfg.url}/rest/v1/stores?${orExpr}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as StoreRecord) : null;
  } catch {
    return null;
  }
}

export async function insertStoreDevice(
  device: Omit<StoreDeviceRecord, "id">
): Promise<DbResult<StoreDeviceRecord>> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/store_devices`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(device),
      cache: "no-store"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `device insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function updateStoreDevice(
  id: string,
  patch: Partial<StoreDeviceRecord>
): Promise<DbResult<StoreDeviceRecord>> {
  const cfg = getConfig();
  if (!cfg || !id) return { ok: false, skipped: true };

  try {
    const url = `${cfg.url}/rest/v1/store_devices?id=eq.${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      cache: "no-store"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `device update ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Hapus device. `storeId` ikut disaring supaya request dari satu toko tidak bisa
 * menghapus nomor toko lain hanya dengan menebak id.
 */
export async function deleteStoreDevice(id: string, storeId: string): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg || !id || !storeId) return { ok: false, skipped: true };

  try {
    const url = `${cfg.url}/rest/v1/store_devices?id=eq.${encodeURIComponent(
      id
    )}&store_id=eq.${encodeURIComponent(storeId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `device delete ${res.status}: ${text}` };
    }
    const data = await res.json();
    // Array kosong = tidak ada baris yang cocok (id milik toko lain / sudah hilang).
    if (Array.isArray(data) && data.length === 0) {
      return { ok: false, error: "Device tidak ditemukan." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- PRODUCT METHODS ----------------

export async function getProductsByStoreId(storeId: string): Promise<ProductRecord[]> {
  const cfg = getConfig();
  if (!cfg || !storeId) return [];

  try {
    const url = `${cfg.url}/rest/v1/products?store_id=eq.${encodeURIComponent(storeId)}&order=created_at.desc`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return [];
    return (await res.json()) as ProductRecord[];
  } catch {
    return [];
  }
}

export async function insertProduct(product: Omit<ProductRecord, "id">): Promise<DbResult<ProductRecord>> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/products`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(product),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `product insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Update produk, DIBATASI ke produk milik `storeId`.
 * Filter store_id ada di query, jadi PostgREST sendiri yang menegakkan
 * kepemilikan — tidak perlu fetch-lalu-cek (yang rawan race).
 * Mengembalikan ok:false + notFound bila tidak ada baris yang cocok.
 */
export async function updateProduct(
  productId: string,
  storeId: string,
  patch: Partial<Omit<ProductRecord, "id" | "store_id">>
): Promise<DbResult<ProductRecord> & { notFound?: boolean }> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };
  if (!productId || !storeId) return { ok: false, error: "ID produk / toko kosong." };

  try {
    const url = `${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(
      productId
    )}&store_id=eq.${encodeURIComponent(storeId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(patch),
      cache: "no-store"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `product update ${res.status}: ${text}` };
    }

    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, notFound: true, error: "Produk tidak ditemukan." };
    return { ok: true, data: row as ProductRecord };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Hapus produk, DIBATASI ke produk milik `storeId` (kepemilikan via query). */
export async function deleteProduct(
  productId: string,
  storeId: string
): Promise<DbResult & { notFound?: boolean }> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };
  if (!productId || !storeId) return { ok: false, error: "ID produk / toko kosong." };

  try {
    const url = `${cfg.url}/rest/v1/products?id=eq.${encodeURIComponent(
      productId
    )}&store_id=eq.${encodeURIComponent(storeId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return { ok: false, error: `product delete ${res.status}` };

    // `return=representation` memberi array baris yang benar-benar terhapus:
    // kosong berarti produk bukan milik toko ini (atau sudah hilang).
    const data = await res.json().catch(() => []);
    if (Array.isArray(data) && data.length === 0) {
      return { ok: false, notFound: true, error: "Produk tidak ditemukan." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- CONVERSATION METHODS ----------------

export async function getConversation(storeId: string, phone: string): Promise<ConversationRecord | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  try {
    const url = `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(
      storeId
    )}&customer_phone=eq.${encodeURIComponent(phone)}&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as ConversationRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Jumlah percakapan toko pada bulan kalender berjalan (WIB) — dipakai menegakkan
 * kuota paket Starter.
 *
 * Menghitung BARIS, bukan pesan: satu pembeli yang chat berkali-kali tetap satu
 * percakapan. Memakai `Prefer: count=exact` + header `Content-Range` supaya
 * barisnya tidak perlu ditarik semua hanya untuk dihitung.
 *
 * Mengembalikan `null` bila hitungan gagal (Supabase belum dikonfigurasi, error
 * jaringan, header tidak terbaca). Pemanggil WAJIB memperlakukan `null` sebagai
 * "tidak tahu" dan MEMBIARKAN pesan lewat — memblokir bot toko yang membayar
 * karena satu query gagal jauh lebih merugikan daripada melayani beberapa
 * percakapan di atas kuota.
 */
export async function countConversationsThisMonth(storeId: string): Promise<number | null> {
  const cfg = getConfig();
  if (!cfg || !storeId) return null;

  try {
    const since = new Date(monthStartMs()).toISOString();
    const url =
      `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(storeId)}` +
      `&updated_at=gte.${encodeURIComponent(since)}&select=id&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "count=exact"),
      cache: "no-store"
    });
    if (!res.ok) return null;

    // Format: "0-0/123" — atau "*/123" bila rentangnya kosong.
    const total = (res.headers.get("content-range") || "").split("/")[1];
    const parsed = Number(total);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Jumlah produk milik satu toko.
 *
 * Dipakai menegakkan batas jumlah produk saat menambah. Mengembalikan `null`
 * bila hitungan gagal — pemanggilnya yang memutuskan; di sini kegagalan hitung
 * TIDAK boleh diperlakukan sebagai "sudah penuh", karena itu memblokir pemilik
 * toko menambah produk hanya gara-gara satu query bermasalah.
 */
export async function countProducts(storeId: string): Promise<number | null> {
  const cfg = getConfig();
  if (!cfg || !storeId) return null;

  try {
    const url =
      `${cfg.url}/rest/v1/products?store_id=eq.${encodeURIComponent(storeId)}` +
      `&select=id&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "count=exact"),
      cache: "no-store"
    });
    if (!res.ok) return null;

    const total = (res.headers.get("content-range") || "").split("/")[1];
    const parsed = Number(total);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Percakapan terbaru sebuah toko, terurut dari yang paling baru diperbarui.
 *
 * `limit` wajib punya nilai default yang masuk akal: dashboard memuat ulang
 * daftar ini setiap kali polling, dan toko yang sudah lama jalan bisa punya
 * puluhan ribu percakapan — mengirim semuanya ke browser tiap 30 detik membuat
 * dashboard makin berat seiring toko makin sukses.
 */
export const CONVERSATIONS_PAGE_SIZE = 200;

export async function getAllConversations(
  storeId: string,
  limit: number = CONVERSATIONS_PAGE_SIZE
): Promise<ConversationRecord[]> {
  const cfg = getConfig();
  if (!cfg) return [];

  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));

  try {
    const url =
      `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(storeId)}` +
      `&order=updated_at.desc&limit=${safeLimit}`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });

    if (!res.ok) return [];
    return (await res.json()) as ConversationRecord[];
  } catch {
    return [];
  }
}

/**
 * Batas panjang riwayat per percakapan yang disimpan di DB.
 *
 * Kolom `messages` dibaca & ditulis ulang setiap balasan, jadi riwayat yang
 * tumbuh tanpa batas membuat setiap balasan makin mahal — untuk percakapan yang
 * paling aktif, yang justru paling sering dibalas.
 */
const MAX_STORED_MESSAGES = 200;

/**
 * Simpan satu pasang pesan (pembeli + balasan bot) ke sebuah percakapan.
 *
 * Jalur utama memakai RPC `append_conversation_message` yang melakukan
 * upsert + append + pemangkasan dalam SATU pernyataan SQL. Ini penting: dua
 * pesan yang datang hampir bersamaan tidak boleh saling menimpa.
 *
 * Bila RPC belum ada (DB belum menjalankan `supabase/schema.sql` versi terbaru),
 * fungsi ini jatuh ke jalur baca-ubah-tulis yang lama supaya bot tetap membalas —
 * dengan peringatan di log, karena jalur itu punya celah lost-update.
 */
export async function saveConversationMessage(
  storeId: string,
  phone: string,
  userMsg: string,
  assistantReply: string,
  intent?: string,
  destinationCity?: string
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/append_conversation_message`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({
        p_store_id: storeId,
        p_phone: phone,
        p_user_msg: userMsg,
        p_assistant_reply: assistantReply,
        p_intent: intent ?? null,
        p_destination_city: destinationCity ?? null,
        p_max_messages: MAX_STORED_MESSAGES
      }),
      cache: "no-store"
    });

    if (res.ok) return { ok: true };

    // 404 = fungsi belum ada di DB ini. Selain itu, kegagalan nyata.
    if (res.status !== 404) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `append rpc ${res.status}: ${text}` };
    }

    console.warn(
      "[supabase] RPC append_conversation_message belum ada — memakai jalur baca-ubah-tulis " +
        "yang bisa kehilangan pesan saat dua chat datang bersamaan. Jalankan ulang supabase/schema.sql."
    );
    return saveConversationMessageLegacy(storeId, phone, userMsg, assistantReply, intent, destinationCity);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Jalur lama: baca array, tambah di memori, tulis ulang. Rawan lost-update. */
async function saveConversationMessageLegacy(
  storeId: string,
  phone: string,
  userMsg: string,
  assistantReply: string,
  intent?: string,
  destinationCity?: string
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const existing = await getConversation(storeId, phone);
    const nowStr = new Date().toISOString();

    const newMessages = existing && Array.isArray(existing.messages) ? [...existing.messages] : [];

    newMessages.push({ role: "user", content: userMsg, timestamp: nowStr });
    newMessages.push({ role: "assistant", content: assistantReply, timestamp: nowStr });

    const trimmed = newMessages.slice(-MAX_STORED_MESSAGES);

    let res: Response;
    if (existing && existing.id) {
      const url = `${cfg.url}/rest/v1/conversations?id=eq.${existing.id}`;
      res = await fetch(url, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          messages: trimmed,
          last_intent: intent || existing.last_intent,
          destination_city: destinationCity || existing.destination_city,
          updated_at: nowStr
        }),
        cache: "no-store"
      });
    } else {
      res = await fetch(`${cfg.url}/rest/v1/conversations`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          store_id: storeId,
          customer_phone: phone,
          messages: trimmed,
          last_intent: intent,
          destination_city: destinationCity
        }),
        cache: "no-store"
      });
    }

    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- RATE LIMIT (lintas instance) ----------------

export interface RateLimitVerdict {
  allowed: boolean;
  hits: number;
  retryAfterSec: number;
  /** `false` = pemeriksaan DB tidak tersedia; pemanggil harus pakai cadangan lokal. */
  enforced: boolean;
}

/**
 * Naikkan hitungan untuk sebuah kunci dan putuskan apakah masih di bawah batas.
 *
 * Ditegakkan di database, bukan di memori proses, karena satu deployment
 * serverless bisa berjalan di banyak instance sekaligus — batas in-memory
 * sebenarnya berarti "batas × jumlah instance".
 *
 * Kalau DB/RPC tidak tersedia, `enforced: false` dikembalikan dan permintaan
 * DIIZINKAN: pembatas laju adalah pelindung biaya, bukan gerbang kebenaran, dan
 * memblokir seluruh bot pelanggan karena satu query gagal lebih merugikan.
 */
export async function bumpRateLimit(
  key: string,
  windowSeconds: number,
  max: number
): Promise<RateLimitVerdict> {
  const cfg = getConfig();
  const fallback: RateLimitVerdict = { allowed: true, hits: 0, retryAfterSec: 0, enforced: false };
  if (!cfg || !key) return fallback;

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/bump_rate_limit`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({ p_key: key, p_window_seconds: windowSeconds, p_max: max }),
      cache: "no-store"
    });
    if (!res.ok) {
      if (res.status === 404) {
        console.warn(
          "[supabase] RPC bump_rate_limit belum ada — pembatas laju hanya berlaku per instance. " +
            "Jalankan ulang supabase/schema.sql."
        );
      }
      return fallback;
    }

    const data = (await res.json()) as { allowed?: boolean; hits?: number; retry_after?: number };
    return {
      allowed: data.allowed !== false,
      hits: Number(data.hits) || 0,
      retryAfterSec: Math.max(0, Number(data.retry_after) || 0),
      enforced: true
    };
  } catch {
    return fallback;
  }
}

/**
 * Metadata autentikasi sebuah akun — query ringan khusus untuk validasi sesi.
 * Sengaja hanya memilih kolom yang dibutuhkan supaya tidak menarik seluruh baris
 * (termasuk token pihak ketiga) di setiap request yang terautentikasi.
 *
 * `undefined` = query gagal / env belum di-set (pemanggil harus gagal-terbuka),
 * `null` = akunnya memang tidak ada.
 */
export async function getStoreAuthMeta(
  email: string
): Promise<{ password_changed_at: string | null } | null | undefined> {
  const cfg = getConfig();
  if (!cfg || !email) return undefined;

  try {
    const url =
      `${cfg.url}/rest/v1/stores?email=eq.${encodeURIComponent(email)}` +
      `&select=password_changed_at&limit=1`;
    const res = await fetch(url, { headers: headers(cfg.key, "return=representation"), cache: "no-store" });
    if (!res.ok) return undefined;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return null;
    return { password_changed_at: list[0]?.password_changed_at ?? null };
  } catch {
    return undefined;
  }
}

