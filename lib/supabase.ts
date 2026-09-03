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

/**
 * Bentuk kanonik sebuah email di seluruh aplikasi: dipangkas, huruf kecil.
 *
 * Nama domain memang tidak peka huruf besar/kecil, dan tidak ada penyedia email
 * arus utama yang membedakan `Budi` dari `budi` di bagian lokalnya. Jadi satu
 * alamat HARUS selalu bermuara ke SATU akun. Kalau tidak, `Budi@Gmail.com` dan
 * `budi@gmail.com` hidup sebagai dua toko berbeda: pembayaran yang dikirim dengan
 * ejaan yang satu tidak akan pernah menghidupkan akun yang lain, dan pemiliknya
 * tidak punya jalan keluar sendiri karena nomor WhatsApp-nya sudah terpakai di
 * akun pertama (`store_devices_phone_uidx` unik untuk seluruh sistem).
 *
 * Dipasang DI DALAM `getStoreByEmail`/`upsertStore`, bukan cuma dititipkan ke
 * route, supaya tetap benar walau ada jalur baru yang lupa memanggilnya.
 */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * Filter PostgREST untuk mencari satu email — dari yang paling tepat ke paling toleran.
 *
 * Langkah pertama `eq.` pada email ternormalisasi: memakai indeks, dan menjawab
 * semua baris yang sudah dirapikan migrasi `set email = lower(email)`.
 *
 * Langkah kedua `ilike.` HANYA dicoba bila langkah pertama tidak menemukan apa
 * pun — yaitu untuk baris lama yang masih memuat huruf besar di database yang
 * belum dimigrasi. Setelah migrasi jalan, cabang ini tidak akan pernah menemukan
 * apa pun lagi; biayanya satu query terindeks pada jalur "tidak ditemukan" saja
 * (pendaftaran akun baru dan login dengan email asing).
 *
 * KENAPA `ilike` tidak dipakai sebagai langkah pertama: PostgREST mengubah `*` di
 * dalam nilai like/ilike menjadi `%`, dan `%`/`_` diteruskan apa adanya sebagai
 * wildcard SQL. Pola email di route mengizinkan `*`, dan `_` malah lazim di
 * alamat sungguhan — tanpa pengamanan, `*@gmail.com` akan mencocoki BARIS TOKO
 * SEMBARANG, cukup untuk mengirim OTP reset atau memproses checkout ke akun yang
 * salah. Karena itu wildcard di-escape, dan nilai yang masih memuat `*` (PostgREST
 * tidak bisa menyatakannya sebagai literal) tidak dicari lewat jalur ini.
 *
 * DIEKSPOR DEMI TES (`tests/email-filters.test.ts`). Escape di bawah pernah
 * rusak dalam sunyi: backslash-nya ditulis tunggal, `"\$1"`, yang di JavaScript
 * sama saja dengan `"$1"` — rujukan capture group, yakni karakter yang cocok itu
 * sendiri. `%` diganti `%`, `_` diganti `_`, jadi barisnya tidak melakukan apa
 * pun sementara docblock di atas menjelaskan panjang-panjang apa yang seharusnya
 * dicegahnya. Tidak ada tes yang bisa memberi tahu; sekarang ada.
 */
export function emailFilters(column: string, email: string): string[] {
  const clean = normalizeEmail(email);
  if (!clean) return [];

  const filters = [`${column}=eq.${encodeURIComponent(clean)}`];
  if (!clean.includes("*")) {
    const literal = clean.replace(/([%_])/g, "\\$1");
    filters.push(`${column}=ilike.${encodeURIComponent(literal)}`);
  }
  return filters;
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
  /**
   * Nomor WhatsApp PRIBADI pemilik untuk menerima peringatan sistem.
   * Wajib berbeda dari nomor toko: peringatan "nomor terputus" tidak mungkin
   * dikirim lewat nomor yang justru sedang terputus.
   */
  alert_phone?: string | null;
  notify_enabled?: boolean | null;
  /** Anti-spam peringatan kuota: kapan & di persen berapa terakhir dikabari. */
  last_quota_alert_at?: string | null;
  last_quota_alert_pct?: number | null;
  /**
   * Anti-ulang pengingat masa aktif: AMBANG hari terakhir yang sudah dikabari
   * (3 = H-3, 1 = H-1, 0 = hari-H atau sesudahnya) beserta waktunya.
   *
   * Yang disimpan ambangnya, bukan cuma waktunya — kalau tidak, cron harian akan
   * mengirim pesan yang sama setiap hari. Waktunya dipakai untuk hal lain: kalau
   * catatan ini lebih tua dari jendela pengingat tanggal akhir yang SEKARANG, ia
   * milik periode sebelumnya dan diabaikan. Itulah yang membuat perpanjangan
   * otomatis membuka kembali pengingat tanpa perlu disetel ulang dari jalur
   * pembayaran — lihat `lib/notify.ts`.
   */
  last_expiry_alert_days?: number | null;
  last_expiry_alert_at?: string | null;
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
  /**
   * Id produk yang dijawab nomor ini. `[]` (atau tidak ada) = nomor umum:
   * menjawab SELURUH katalog toko.
   *
   * Disimpan sebagai jsonb array of string di database. Paket Pro punya 3 nomor,
   * jadi satu nomor bisa dikhususkan untuk sebagian produk — katalog yang masuk
   * ke prompt AI dan pencocokan pesanan ikut dipersempit.
   */
  product_ids?: string[] | null;
  /** Kapan peringatan terakhir dikirim untuk nomor ini (anti-spam kabar). */
  last_alert_at?: string | null;
  /** Jenis peringatan terakhir, mis. `disconnected` — supaya tidak diulang. */
  last_alert_kind?: string | null;
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
  /** URL foto produk (dihosting di luar). Dikirim sebagai media saat AI mengutip. */
  image_url?: string | null;
  created_at?: string;
}

export interface ConversationRecord {
  id?: string;
  store_id: string;
  customer_phone: string;
  customer_name?: string;
  /** Alamat kirim yang dipancing AI dari chat. */
  customer_address?: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>;
  last_intent?: string;
  destination_city?: string;
  /** AI DIAM di percakapan ini — pemilik toko sedang menjawab sendiri. */
  ai_paused?: boolean | null;
  ai_paused_at?: string | null;
  /** Kapan pemilik terakhir membuka percakapan ini (penanda belum dibaca). */
  last_seen_at?: string | null;
  updated_at?: string;
  created_at?: string;
}

/** Satu baris produk di dalam pesanan pembeli (snapshot, bukan referensi). */
export interface BuyerOrderItem {
  name: string;
  units: number;
  price: number;
  weight: number;
  line_total: number;
}

/**
 * Pesanan PEMBELI hasil rekaman AI.
 *
 * Bukan `OrderRecord` — itu pembayaran langganan SaaS lewat Midtrans. Tabelnya
 * pun berbeda (`buyer_orders` vs `orders`); mencampurnya akan mengacaukan
 * penagihan.
 */
/**
 * Daur hidup pesanan pembeli.
 *
 * `new` adalah satu-satunya status yang dianggap "berjalan": hanya baris `new`
 * yang boleh digabung oleh chat lanjutan pembeli (lihat `getOpenBuyerOrder`).
 * Begitu ditandai `paid`, isinya terkunci — barang yang sudah dibayar tidak boleh
 * diam-diam bertambah karena pembeli menyebut produk lain di chat berikutnya.
 */
export type BuyerOrderStatus = "new" | "paid" | "shipped" | "done";

export const BUYER_ORDER_STATUSES: BuyerOrderStatus[] = ["new", "paid", "shipped", "done"];

export function isBuyerOrderStatus(value: unknown): value is BuyerOrderStatus {
  return typeof value === "string" && (BUYER_ORDER_STATUSES as string[]).includes(value);
}

export interface BuyerOrderRecord {
  id?: string;
  store_id: string;
  device_id?: string | null;
  customer_phone: string;
  customer_name?: string | null;
  customer_address?: string | null;
  destination_city?: string | null;
  items: BuyerOrderItem[];
  subtotal: number;
  weight_gram: number;
  shipping_courier?: string | null;
  shipping_cost?: number | null;
  note?: string | null;
  status?: BuyerOrderStatus;
  done_at?: string | null;
  /** Bukti transfer yang dikirim pembeli (URL). */
  payment_proof_url?: string | null;
  paid_at?: string | null;
  /** Nomor resi ekspedisi — dikabarkan ke pembeli saat status jadi `shipped`. */
  tracking_number?: string | null;
  shipped_at?: string | null;
  created_at?: string;
  updated_at?: string;
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
  /** Baris BARU dibuat (bukan memperbarui yang sudah ada). */
  created?: boolean;
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
  // Normalisasi WAJIB di sini: inilah titik tempat pembayaran lunas diterapkan.
  // Tanpa itu, checkout yang mengetik huruf berbeda dari saat mendaftar membuat
  // baris toko KEDUA — uang masuk, akun lama tetap kedaluwarsa.
  const email = normalizeEmail(order.customer_email);
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

  for (const filter of emailFilters("email", email)) {
    try {
      const url = `${cfg.url}/rest/v1/stores?${filter}&limit=1`;
      const res = await fetch(url, {
        headers: headers(cfg.key, "return=representation"),
        cache: "no-store"
      });

      if (!res.ok) return null;
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) return list[0] as StoreRecord;
    } catch {
      return null;
    }
  }
  return null;
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

  // Email selalu DITULIS dalam bentuk kanonik — termasuk saat memperbarui baris
  // lama, jadi setiap toko yang dipakai ikut dirapikan sendiri tanpa menunggu
  // migrasi dijalankan.
  const payload = { ...store, email: normalizeEmail(store.email) };
  if (!payload.email) return { ok: false, error: "upsertStore tanpa email" };

  try {
    const existing = await getStoreByEmail(payload.email);
    let res: Response;

    if (existing && existing.id) {
      // Update
      const url = `${cfg.url}/rest/v1/stores?id=eq.${existing.id}`;
      res = await fetch(url, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
        cache: "no-store"
      });
    } else {
      // Insert
      res = await fetch(`${cfg.url}/rest/v1/stores`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify(payload),
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
  /** Id produk yang dijawab nomor ini; `[]` = nomor umum (semua produk). */
  product_ids: string[];
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
    last_inbound_note: device.last_inbound_note || null,
    product_ids: normalizeDeviceProductIds(device.product_ids)
  };
}

/**
 * Bersihkan daftar id produk milik sebuah nomor.
 *
 * Dipakai baik saat MENYIMPAN (dari body request) maupun saat MEMBACA (kolom
 * jsonb bisa berisi apa saja bila pernah diisi manual di SQL Editor). `[]`
 * selalu bermakna "nomor umum", jadi nilai tak dikenal dibuang senyap ketimbang
 * membuat nomor berhenti menjawab.
 */
export function normalizeDeviceProductIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || out.includes(id)) continue;
    out.push(id);
    // Katalog dibatasi 300 produk; daftar sepanjang itu sama saja dengan "umum".
    if (out.length >= 300) break;
  }
  return out;
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
 *
 * `customerName` / `customerAddress` hanya dikirim bila pesan ini memang
 * mengandungnya. Nilai kosong berarti "jangan ubah yang sudah tersimpan", bukan
 * "hapus" — pembeli tidak menyebut namanya lagi di setiap chat.
 */
export interface SaveConversationInput {
  storeId: string;
  phone: string;
  userMsg: string;
  assistantReply: string;
  intent?: string;
  destinationCity?: string;
  customerName?: string | null;
  customerAddress?: string | null;
}

export async function saveConversationMessage(input: SaveConversationInput): Promise<DbResult> {
  const { storeId, phone, userMsg, assistantReply, intent, destinationCity } = input;
  const customerName = (input.customerName || "").trim() || null;
  const customerAddress = (input.customerAddress || "").trim() || null;

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
        p_max_messages: MAX_STORED_MESSAGES,
        p_customer_name: customerName,
        p_customer_address: customerAddress
      }),
      cache: "no-store"
    });

    if (res.ok) return { ok: true };

    // 404 = fungsi belum ada di DB ini. Selain itu, kegagalan nyata.
    //
    // Versi RPC LAMA (tanpa dua parameter terakhir) menolak dengan 404 juga —
    // PostgREST tidak menemukan fungsi dengan tanda tangan yang diminta — jadi
    // toko yang belum menjalankan SQL terbaru otomatis memakai jalur lama dan
    // botnya tetap membalas.
    if (res.status !== 404) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `append rpc ${res.status}: ${text}` };
    }

    console.warn(
      "[supabase] RPC append_conversation_message belum ada — memakai jalur baca-ubah-tulis " +
        "yang bisa kehilangan pesan saat dua chat datang bersamaan. Jalankan ulang supabase/schema.sql."
    );
    return saveConversationMessageLegacy({ ...input, customerName, customerAddress });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Jalur lama: baca array, tambah di memori, tulis ulang. Rawan lost-update. */
async function saveConversationMessageLegacy(input: SaveConversationInput): Promise<DbResult> {
  const {
    storeId,
    phone,
    userMsg,
    assistantReply,
    intent,
    destinationCity,
    customerName,
    customerAddress
  } = input;

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
          customer_name: customerName || existing.customer_name,
          customer_address: customerAddress || existing.customer_address,
          updated_at: nowStr
        }),
        cache: "no-store"
      });

      // Kolom `customer_address` mungkin belum ada di DB yang belum dimigrasi.
      // Nama & alamat itu pelengkap; kehilangan seluruh pesan karenanya jauh
      // lebih buruk, jadi ulangi tanpa kolom baru itu.
      if (!res.ok && res.status === 400 && customerAddress) {
        res = await fetch(url, {
          method: "PATCH",
          headers: headers(cfg.key, "return=representation"),
          body: JSON.stringify({
            messages: trimmed,
            last_intent: intent || existing.last_intent,
            destination_city: destinationCity || existing.destination_city,
            customer_name: customerName || existing.customer_name,
            updated_at: nowStr
          }),
          cache: "no-store"
        });
      }
    } else {
      res = await fetch(`${cfg.url}/rest/v1/conversations`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          store_id: storeId,
          customer_phone: phone,
          messages: trimmed,
          last_intent: intent,
          destination_city: destinationCity,
          customer_name: customerName || undefined,
          customer_address: customerAddress || undefined
        }),
        cache: "no-store"
      });

      if (!res.ok && res.status === 400 && customerAddress) {
        res = await fetch(`${cfg.url}/rest/v1/conversations`, {
          method: "POST",
          headers: headers(cfg.key, "return=representation"),
          body: JSON.stringify({
            store_id: storeId,
            customer_phone: phone,
            messages: trimmed,
            last_intent: intent,
            destination_city: destinationCity,
            customer_name: customerName || undefined
          }),
          cache: "no-store"
        });
      }
    }

    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Tambahkan SATU pesan ke sebuah percakapan (tanpa pasangan bicara).
 *
 * Sengaja tidak memakai RPC `append_conversation_message`: RPC itu selalu menulis
 * SEPASANG pesan (pembeli + bot), sedangkan balasan manual pemilik toko — dan pesan
 * pembeli pada percakapan yang AI-nya dijeda — tidak punya pasangan. Memaksakannya
 * berarti menyisipkan pesan kosong ke riwayat, yang lalu ikut terkirim ke prompt AI
 * sebagai giliran bicara palsu.
 *
 * Jalur baca-ubah-tulis di sini dapat kehilangan pesan bila balasan bot datang pada
 * milidetik yang sama. Risikonya kecil dan disengaja: kedua pemakainya justru jalur
 * yang bot-nya sedang TIDAK menulis (`ai_paused`), atau manusia yang mengetik satu
 * per satu.
 */
async function appendConversationEntry(params: {
  storeId: string;
  phone: string;
  role: "user" | "assistant";
  text: string;
  /** `true` = sekalian tandai percakapan sudah dibaca (balasan manual). */
  markSeen: boolean;
  /**
   * `true` = pesan ini ditulis MANUSIA, bukan bot.
   *
   * Disimpan sebagai kunci tambahan di dalam JSON pesan — kolomnya tidak berubah,
   * dan pembangun prompt AI hanya membaca `role`/`content`, jadi penanda ini tidak
   * mengubah apa pun yang dilihat model. Yang dibelinya: dashboard bisa berhenti
   * melabeli balasan pemilik toko sebagai "AI CS", sebuah kekeliruan yang persis
   * muncul pada percakapan paling sensitif — yang diambil alih manusia.
   */
  manual?: boolean;
}): Promise<DbResult> {
  const { storeId, phone, role, text, markSeen, manual } = params;
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const existing = await getConversation(storeId, phone);
    const nowStr = new Date().toISOString();
    const entry = { role, content: text, timestamp: nowStr, ...(manual ? { manual: true } : {}) };

    if (!existing?.id) {
      const res = await fetch(`${cfg.url}/rest/v1/conversations`, {
        method: "POST",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          store_id: storeId,
          customer_phone: phone,
          messages: [entry],
          updated_at: nowStr
        }),
        cache: "no-store"
      });
      return { ok: res.ok, error: res.ok ? undefined : `insert ${res.status}` };
    }

    const messages = Array.isArray(existing.messages) ? [...existing.messages, entry] : [entry];
    const body: Record<string, unknown> = {
      messages: messages.slice(-MAX_STORED_MESSAGES),
      updated_at: nowStr
    };
    // Membalas sendiri = percakapan ini sudah dibaca. Tanpa ini balasan manual
    // sendiri akan memunculkan penanda "belum dibaca".
    if (markSeen) body.last_seen_at = nowStr;

    const res = await fetch(`${cfg.url}/rest/v1/conversations?id=eq.${existing.id}`, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(body),
      cache: "no-store"
    });

    // Kolom `last_seen_at` belum ada di DB yang belum dimigrasi — pesannya jauh
    // lebih penting daripada penanda baca, jadi ulangi tanpa kolom itu.
    if (!res.ok && res.status === 400 && markSeen) {
      const retry = await fetch(`${cfg.url}/rest/v1/conversations?id=eq.${existing.id}`, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({
          messages: messages.slice(-MAX_STORED_MESSAGES),
          updated_at: nowStr
        }),
        cache: "no-store"
      });
      return { ok: retry.ok, error: retry.ok ? undefined : `patch ${retry.status}` };
    }

    return { ok: res.ok, error: res.ok ? undefined : `patch ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Balasan manual pemilik toko — sekaligus menandai percakapan sudah dibaca. */
export async function appendManualReply(params: {
  storeId: string;
  phone: string;
  text: string;
}): Promise<DbResult> {
  return appendConversationEntry({ ...params, role: "assistant", markSeen: true, manual: true });
}

/**
 * Pesan pembeli yang TIDAK dibalas bot (percakapan sedang ditangani manusia).
 *
 * Wajib tetap dicatat: kalau pesan pembeli hilang hanya karena AI dijeda, pemilik
 * toko membuka chat dan tidak melihat apa yang baru saja ditanyakan. Tidak menandai
 * sudah dibaca — pesan yang belum dijawab siapa pun memang belum dibaca.
 */
export async function appendBuyerMessage(params: {
  storeId: string;
  phone: string;
  text: string;
}): Promise<DbResult> {
  return appendConversationEntry({ ...params, role: "user", markSeen: false });
}

/**
 * Nyalakan/matikan mode "AI diam" untuk satu percakapan.
 *
 * `skipped: true` bila kolomnya belum ada (schema belum dimigrasi) — pemanggil
 * memakai itu untuk memberi pesan "jalankan schema.sql terbaru" ketimbang
 * mengaku berhasil padahal AI tetap akan menjawab.
 */
export async function setConversationAiPaused(
  storeId: string,
  phone: string,
  paused: boolean
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg || !storeId || !phone) return { ok: false, skipped: true };

  try {
    const url =
      `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(storeId)}` +
      `&customer_phone=eq.${encodeURIComponent(phone)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({
        ai_paused: paused,
        ai_paused_at: paused ? new Date().toISOString() : null
      }),
      cache: "no-store"
    });

    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    if (isMissingSchema(res.status)) return { ok: false, skipped: true };
    return { ok: false, error: `${res.status}: ${text}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Tandai percakapan sudah dibaca pemilik toko (mematikan lencana belum dibaca). */
export async function markConversationSeen(storeId: string, phone: string): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg || !storeId || !phone) return { ok: false, skipped: true };

  try {
    const url =
      `${cfg.url}/rest/v1/conversations?store_id=eq.${encodeURIComponent(storeId)}` +
      `&customer_phone=eq.${encodeURIComponent(phone)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key),
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      cache: "no-store"
    });

    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    if (isMissingSchema(res.status)) return { ok: false, skipped: true };
    return { ok: false, error: `${res.status}: ${text}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Kurangi stok produk sesuai isi pesanan — atomik, lewat RPC.
 *
 * Dipanggil TEPAT SEKALI per pesanan (saat baris `buyer_orders` baru dibuat),
 * bukan setiap kali pesanan diperbarui: kalau tidak, pembeli yang mengirim tiga
 * pesan lanjutan akan mengurangi stok tiga kali untuk barang yang sama.
 *
 * Kegagalan di sini tidak boleh menggagalkan apa pun — pembeli sudah menerima
 * balasannya. Stok yang tidak berkurang adalah masalah kecil; webhook yang gagal
 * lalu dikirim ulang Fonnte akan mengulang seluruh balasan.
 */
export async function decrementProductStock(
  storeId: string,
  items: Array<{ name?: string | null; id?: string | null; units: number }>
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg || !storeId) return { ok: false, skipped: true };

  const payload = items
    .filter((i) => Number(i.units) > 0)
    .map((i) => ({ id: i.id || null, name: i.name || null, units: Math.floor(Number(i.units)) }));
  if (payload.length === 0) return { ok: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/decrement_product_stock`, {
      method: "POST",
      headers: headers(cfg.key),
      body: JSON.stringify({ p_store_id: storeId, p_items: payload }),
      cache: "no-store"
    });

    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    if (isMissingSchema(res.status)) return { ok: false, skipped: true };
    return { ok: false, error: `${res.status}: ${text}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

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

export type RpcStatus = "ok" | "missing" | "unknown";

export interface DatabaseHealth {
  /** `false` = kredensial Supabase belum diisi; pemeriksaan di bawah tidak berarti. */
  configured: boolean;
  /**
   * Apakah pembatas laju BENAR-BENAR ditegakkan saat ini.
   *
   * Pertanyaan paling mahal kalau jawabannya salah, dan paling sunyi kalau
   * rusak: `bumpRateLimit` sengaja gagal-terbuka, jadi hilangnya RPC-nya tidak
   * menimbulkan satu gejala pun — login, ganti kata sandi, reset, dan
   * pendaftaran uji coba semuanya berjalan tanpa batas, dan satu-satunya
   * jejaknya adalah `console.warn` di log yang tidak ada yang membacanya.
   */
  rateLimitEnforced: boolean;
  rpc: Record<string, RpcStatus>;
  /** Masalah yang ditemukan, sudah dalam bahasa manusia. Kosong = sehat. */
  problems: string[];
}

/**
 * Cek keberadaan satu RPC TANPA efek samping.
 *
 * Caranya sengaja lewat galat: argumennya dikirim dengan tipe yang pasti gagal
 * di-cast (`p_store_id` bukan UUID). Kalau PostgREST menjawab 404/`PGRST202`,
 * fungsinya memang tidak ada di schema cache. Galat APA PUN yang lain justru
 * membuktikan fungsinya ADA — ia sudah dipanggil dan baru kemudian menolak
 * datanya, jadi tidak ada satu baris pun yang tertulis.
 */
async function probeRpc(
  cfg: { url: string; key: string },
  name: string,
  body: Record<string, unknown>
): Promise<RpcStatus> {
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: headers(cfg.key),
      body: JSON.stringify(body),
      cache: "no-store"
    });
    if (res.ok) return "ok";
    const detail = await res.text();
    if (res.status === 404 || detail.includes("PGRST202")) return "missing";
    return "ok";
  } catch {
    return "unknown";
  }
}

/**
 * Pemeriksaan kesehatan database — untuk OPERATOR, bukan untuk pemilik toko.
 *
 * KENAPA ADA: empat RPC di `supabase/schema.sql` ditambahkan setelah deployment
 * pertama. Kalau schema-nya belum dijalankan ulang, tiga di antaranya punya jalur
 * cadangan yang bekerja tanpa suara — dan `bump_rate_limit` yang hilang berarti
 * penebakan kata sandi tidak dibatasi apa pun. Tidak ada satu layar pun yang
 * memberitahukannya. `/api/health/db` memakai fungsi ini supaya jawabannya bisa
 * dilihat kapan saja, bukan dicari di log.
 *
 * Semua pemeriksaan aman dijalankan di produksi: tiga RPC diprobe dengan argumen
 * yang pasti ditolak sebelum menulis apa pun, dan `bump_rate_limit` dipanggil
 * dengan kunci khusus + batas sangat tinggi supaya tidak pernah memblokir siapa
 * pun. Dijalankan paralel karena keempatnya saling bebas.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const cfg = getConfig();
  if (!cfg) {
    return {
      configured: false,
      rateLimitEnforced: false,
      rpc: {},
      problems: [
        "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi — " +
          "aplikasi berjalan tanpa database."
      ]
    };
  }

  const BAD_UUID = "bukan-uuid";
  const [rateLimit, trim, append, stock] = await Promise.all([
    bumpRateLimit("healthcheck:db", 60, 1_000_000),
    probeRpc(cfg, "trim_jsonb_tail", { p_arr: [], p_max: 1 }),
    probeRpc(cfg, "append_conversation_message", {
      p_store_id: BAD_UUID,
      p_phone: "",
      p_user_msg: "",
      p_assistant_reply: ""
    }),
    probeRpc(cfg, "decrement_product_stock", { p_store_id: BAD_UUID, p_items: [] })
  ]);

  const rpc: Record<string, RpcStatus> = {
    bump_rate_limit: rateLimit.enforced ? "ok" : "missing",
    trim_jsonb_tail: trim,
    append_conversation_message: append,
    decrement_product_stock: stock
  };

  const problems: string[] = [];
  if (!rateLimit.enforced) {
    problems.push(
      "RPC bump_rate_limit tidak menjawab — pembatas laju TIDAK ditegakkan. " +
        "Login, reset kata sandi, dan pendaftaran uji coba saat ini tanpa batas. " +
        "Jalankan ulang supabase/schema.sql."
    );
  }
  for (const [name, status] of Object.entries(rpc)) {
    if (name === "bump_rate_limit" || status === "ok") continue;
    problems.push(
      status === "missing"
        ? `RPC ${name} belum ada di database. Jalankan ulang supabase/schema.sql.`
        : `RPC ${name} tidak bisa diperiksa (database tidak menjawab).`
    );
  }

  return { configured: true, rateLimitEnforced: rateLimit.enforced, rpc, problems };
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
  const filters = emailFilters("email", email);
  if (!cfg || filters.length === 0) return undefined;

  for (const filter of filters) {
    try {
      const url =
        `${cfg.url}/rest/v1/stores?${filter}` +
        `&select=password_changed_at&limit=1`;
      const res = await fetch(url, { headers: headers(cfg.key, "return=representation"), cache: "no-store" });
      if (!res.ok) return undefined;
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        return { password_changed_at: list[0]?.password_changed_at ?? null };
      }
    } catch {
      return undefined;
    }
  }
  return null;
}

// ---------------- PESANAN PEMBELI (buyer_orders) ----------------

/** Batas baris yang dikirim ke dashboard sekali muat. */
export const BUYER_ORDERS_PAGE_SIZE = 200;

/**
 * `true` bila kegagalan PostgREST berarti "tabel/kolom belum ada".
 *
 * Dipakai supaya kode yang dideploy SEBELUM `supabase/schema.sql` dijalankan
 * tidak membuat bot berhenti membalas — pesanan tidak tercatat (dan itu terlihat
 * di dashboard), tapi chat pembeli tetap dijawab.
 */
function isMissingSchema(status: number): boolean {
  return status === 404 || status === 400;
}

/**
 * Daftar pesanan pembeli sebuah toko, terbaru di atas.
 *
 * `null` = tabel belum ada (SQL terbaru belum dijalankan). Dibedakan dari `[]`
 * karena dashboard perlu menampilkan ajakan menjalankan migrasi, bukan
 * "belum ada pesanan".
 */
export async function listBuyerOrders(storeId: string): Promise<BuyerOrderRecord[] | null> {
  const cfg = getConfig();
  if (!cfg || !storeId) return [];

  try {
    const url =
      `${cfg.url}/rest/v1/buyer_orders?store_id=eq.${encodeURIComponent(storeId)}` +
      `&order=created_at.desc&limit=${BUYER_ORDERS_PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) {
      if (isMissingSchema(res.status)) return null;
      console.error("[supabase] listBuyerOrders gagal:", res.status);
      return [];
    }
    const list = await res.json();
    return Array.isArray(list) ? (list as BuyerOrderRecord[]) : [];
  } catch (err) {
    console.error("[supabase] listBuyerOrders error:", err);
    return [];
  }
}

/** Pesanan yang masih BERJALAN (belum ditandai selesai) untuk satu pembeli. */
export async function getOpenBuyerOrder(
  storeId: string,
  phone: string
): Promise<BuyerOrderRecord | null> {
  const cfg = getConfig();
  if (!cfg || !storeId || !phone) return null;

  try {
    const url =
      `${cfg.url}/rest/v1/buyer_orders?store_id=eq.${encodeURIComponent(storeId)}` +
      `&customer_phone=eq.${encodeURIComponent(phone)}&status=eq.new` +
      `&order=created_at.desc&limit=1`;
    const res = await fetch(url, {
      headers: headers(cfg.key, "return=representation"),
      cache: "no-store"
    });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? (list[0] as BuyerOrderRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Catat / segarkan pesanan pembeli.
 *
 * Satu pesanan BERJALAN per pembeli: chat lanjutan memperbarui baris yang sama
 * (pembeli menambah barang, menyebut alamat, memilih ekspedisi) alih-alih
 * menumpuk baris baru setiap kali. Setelah toko menandainya selesai, pesanan
 * berikutnya menjadi baris baru.
 *
 * Kegagalan di sini TIDAK boleh menggagalkan balasan — pemanggil hanya mencatat
 * log. Itu sebabnya `skipped` dipakai untuk "tabelnya belum ada".
 */
export async function recordBuyerOrder(
  order: Omit<BuyerOrderRecord, "id" | "created_at" | "updated_at">
): Promise<DbResult<BuyerOrderRecord>> {
  const cfg = getConfig();
  if (!cfg || !order.store_id || !order.customer_phone) return { ok: false, skipped: true };

  const payload: Record<string, unknown> = {
    store_id: order.store_id,
    device_id: order.device_id || null,
    customer_phone: order.customer_phone,
    items: order.items || [],
    subtotal: Math.max(0, Math.round(order.subtotal || 0)),
    weight_gram: Math.max(0, Math.round(order.weight_gram || 0)),
    status: "new"
  };
  // Nilai kosong DIBUANG dari payload, bukan dikirim sebagai null: pesan
  // lanjutan yang tidak menyebut alamat tidak boleh menghapus alamat yang sudah
  // didapat dari pesan sebelumnya.
  if (order.customer_name) payload.customer_name = order.customer_name;
  if (order.customer_address) payload.customer_address = order.customer_address;
  if (order.destination_city) payload.destination_city = order.destination_city;
  if (order.shipping_courier) payload.shipping_courier = order.shipping_courier;
  if (typeof order.shipping_cost === "number") payload.shipping_cost = order.shipping_cost;
  if (order.note) payload.note = order.note;

  try {
    const existing = await getOpenBuyerOrder(order.store_id, order.customer_phone);

    if (existing?.id) {
      // Daftar barang hanya ditimpa bila pesan ini memang menyebut produk.
      const patch = { ...payload };
      delete patch.store_id;
      delete patch.customer_phone;
      delete patch.status;
      if (!order.items || order.items.length === 0) {
        delete patch.items;
        delete patch.subtotal;
        delete patch.weight_gram;
      }

      const res = await fetch(
        `${cfg.url}/rest/v1/buyer_orders?id=eq.${encodeURIComponent(existing.id)}`,
        {
          method: "PATCH",
          headers: headers(cfg.key, "return=representation"),
          body: JSON.stringify(patch),
          cache: "no-store"
        }
      );
      if (!res.ok) {
        if (isMissingSchema(res.status)) return { ok: false, skipped: true };
        const text = await res.text().catch(() => "");
        return { ok: false, error: `buyer order update ${res.status}: ${text}` };
      }
      const data = await res.json();
      return { ok: true, created: false, data: Array.isArray(data) ? data[0] : data };
    }

    const res = await fetch(`${cfg.url}/rest/v1/buyer_orders`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    if (!res.ok) {
      // 409 = indeks unik "satu pesanan berjalan per pembeli" menahan dua chat
      // yang datang hampir bersamaan. Itu justru hasil yang benar: pesanannya
      // sudah tercatat oleh request yang menang.
      //
      // `created` SENGAJA false di sini: request yang menang-lah yang mengurangi
      // stok. Menandainya `true` membuat stok berkurang dua kali untuk satu
      // pesanan yang sama.
      if (res.status === 409) return { ok: true, duplicate: true, created: false };
      if (isMissingSchema(res.status)) return { ok: false, skipped: true };
      const text = await res.text().catch(() => "");
      return { ok: false, error: `buyer order insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, created: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Ubah status pesanan pembeli mengikuti daur hidup `new → paid → shipped → done`.
 *
 * `storeId` ikut disaring di PostgREST supaya satu toko tidak bisa mengubah
 * pesanan toko lain hanya dengan menebak id.
 *
 * Stempel waktu ditulis SEKALI per tahap yang dilewati dan tidak pernah dihapus
 * saat status dikembalikan: `paid_at` sebuah pesanan yang lalu dikoreksi kembali
 * ke `new` tetap menjadi catatan bahwa pembayarannya pernah dikonfirmasi. Yang
 * dibersihkan hanya `done_at`, karena "selesai" adalah keadaan, bukan riwayat.
 */
export async function setBuyerOrderStatus(
  id: string,
  storeId: string,
  status: BuyerOrderStatus,
  extra?: { tracking_number?: string | null; payment_proof_url?: string | null; note?: string | null }
): Promise<DbResult<BuyerOrderRecord>> {
  const cfg = getConfig();
  if (!cfg || !id || !storeId) return { ok: false, skipped: true };

  const nowStr = new Date().toISOString();
  const body: Record<string, unknown> = {
    status,
    done_at: status === "done" ? nowStr : null
  };
  if (status === "paid" || status === "shipped" || status === "done") body.paid_at = nowStr;
  if (status === "shipped" || status === "done") body.shipped_at = nowStr;
  if (extra && typeof extra.tracking_number === "string") {
    body.tracking_number = extra.tracking_number.trim() || null;
  }
  if (extra && typeof extra.payment_proof_url === "string") {
    body.payment_proof_url = extra.payment_proof_url.trim() || null;
  }
  if (extra && typeof extra.note === "string") body.note = extra.note.trim() || null;

  try {
    const url =
      `${cfg.url}/rest/v1/buyer_orders?id=eq.${encodeURIComponent(id)}` +
      `&store_id=eq.${encodeURIComponent(storeId)}`;
    let res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify(body),
      cache: "no-store"
    });

    // DB yang belum menjalankan migrasi terbaru tidak punya kolom tahapan.
    // Statusnya tetap harus bisa diubah — pemilik toko yang sedang menandai
    // pesanan tidak boleh terhenti hanya karena kolom stempel waktu belum ada.
    if (!res.ok && res.status === 400) {
      res = await fetch(url, {
        method: "PATCH",
        headers: headers(cfg.key, "return=representation"),
        body: JSON.stringify({ status, done_at: status === "done" ? nowStr : null }),
        cache: "no-store"
      });
    }

    if (!res.ok) {
      if (isMissingSchema(res.status)) return { ok: false, skipped: true };
      const text = await res.text().catch(() => "");
      return { ok: false, error: `buyer order status ${res.status}: ${text}` };
    }
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { ok: false, error: "Pesanan tidak ditemukan." };
    return { ok: true, data: row as BuyerOrderRecord };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Hapus satu pesanan (mis. salah rekam). Disaring `store_id` juga. */
export async function deleteBuyerOrder(id: string, storeId: string): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg || !id || !storeId) return { ok: false, skipped: true };

  try {
    const url =
      `${cfg.url}/rest/v1/buyer_orders?id=eq.${encodeURIComponent(id)}` +
      `&store_id=eq.${encodeURIComponent(storeId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: headers(cfg.key, "return=minimal"),
      cache: "no-store"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `buyer order delete ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------- ANGGOTA TOKO (login tambahan) ----------------

/**
 * Satu login tambahan milik sebuah toko (pegawai / admin kedua).
 *
 * Tabel terpisah dari `stores` dengan alasan yang disengaja: `stores.email` unik
 * dan menjadi identitas pemilik + tujuan tagihan. Menjadikan `stores` tabel
 * multi-user berarti menyentuh jalur login yang sudah dipakai pelanggan berbayar.
 */
export interface StoreMemberRecord {
  id?: string;
  store_id: string;
  email: string;
  password_hash?: string;
  role?: "staff" | "admin";
  password_changed_at?: string | null;
  last_login_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Bentuk yang boleh dikirim ke browser — tanpa hash password. */
export interface PublicStoreMember {
  id?: string;
  email: string;
  role: "staff" | "admin";
  last_login_at?: string | null;
  created_at?: string;
}

export function toPublicMember(m: StoreMemberRecord): PublicStoreMember {
  return {
    id: m.id,
    email: m.email,
    role: m.role === "admin" ? "admin" : "staff",
    last_login_at: m.last_login_at ?? null,
    created_at: m.created_at
  };
}

/**
 * Cari anggota berdasarkan email (case-insensitive).
 *
 * `null` juga dikembalikan bila tabelnya belum ada. Itu penting: login pemilik
 * toko memanggil fungsi ini sebagai jalur CADANGAN, dan database yang belum
 * dimigrasi tidak boleh membuat halaman login error.
 */
export async function getStoreMemberByEmail(email: string): Promise<StoreMemberRecord | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  // Lewat `emailFilters`, bukan `ilike` telanjang: `insertStoreMember` sudah
  // menyimpan email huruf kecil dan indeksnya `lower(email)`, jadi `eq.` memang
  // sudah tepat — sekaligus menutup celah wildcard `_`/`%`/`*` yang dibawa
  // `ilike` mentah (alasan lengkapnya di `emailFilters`).
  for (const filter of emailFilters("email", email)) {
    try {
      const url = `${cfg.url}/rest/v1/store_members?${filter}&limit=1`;
      const res = await fetch(url, { headers: headers(cfg.key), cache: "no-store" });
      if (!res.ok) return null;
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) return list[0] as StoreMemberRecord;
    } catch {
      return null;
    }
  }
  return null;
}

export async function listStoreMembers(storeId: string): Promise<StoreMemberRecord[] | null> {
  const cfg = getConfig();
  if (!cfg || !storeId) return [];

  try {
    const url =
      `${cfg.url}/rest/v1/store_members?store_id=eq.${encodeURIComponent(storeId)}` +
      `&order=created_at.asc&limit=50`;
    const res = await fetch(url, { headers: headers(cfg.key), cache: "no-store" });
    if (!res.ok) return isMissingSchema(res.status) ? null : [];
    return (await res.json()) as StoreMemberRecord[];
  } catch {
    return [];
  }
}

export async function insertStoreMember(
  member: Omit<StoreMemberRecord, "id" | "created_at" | "updated_at">
): Promise<DbResult<StoreMemberRecord>> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.url}/rest/v1/store_members`, {
      method: "POST",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({
        store_id: member.store_id,
        email: (member.email || "").trim().toLowerCase(),
        password_hash: member.password_hash,
        role: member.role === "admin" ? "admin" : "staff"
      }),
      cache: "no-store"
    });

    if (res.status === 409) {
      return { ok: false, duplicate: true, error: "Email itu sudah dipakai akun lain." };
    }
    if (!res.ok) {
      if (isMissingSchema(res.status)) return { ok: false, skipped: true };
      const text = await res.text().catch(() => "");
      return { ok: false, error: `member insert ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function deleteStoreMember(id: string, storeId: string): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg || !id || !storeId) return { ok: false, skipped: true };

  try {
    const url =
      `${cfg.url}/rest/v1/store_members?id=eq.${encodeURIComponent(id)}` +
      `&store_id=eq.${encodeURIComponent(storeId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: headers(cfg.key, "return=minimal"),
      cache: "no-store"
    });
    if (!res.ok) {
      if (isMissingSchema(res.status)) return { ok: false, skipped: true };
      const text = await res.text().catch(() => "");
      return { ok: false, error: `member delete ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Perbarui satu baris anggota tim — dibatasi pada `store_id` pemiliknya.
 *
 * `store_id` ikut jadi filter, bukan hanya `id`: tanpa itu satu UUID yang tertebak
 * (atau tertukar) bisa mengubah kredensial anggota tim toko LAIN. Sama seperti
 * `deleteStoreMember`.
 *
 * Dipakai untuk menyetel ulang kata sandi anggota oleh pemilik toko. Kolom
 * `password_changed_at` inilah yang membuat penyetelan itu mencabut sesi anggota
 * tersebut — `getSessionActor()` menolak token yang terbit sebelum waktu itu.
 */
export async function updateStoreMember(
  id: string,
  storeId: string,
  patch: Partial<Pick<StoreMemberRecord, "password_hash" | "role" | "password_changed_at">>
): Promise<DbResult<StoreMemberRecord> & { notFound?: boolean }> {
  const cfg = getConfig();
  if (!cfg || !id || !storeId) return { ok: false, skipped: true };

  try {
    const url =
      `${cfg.url}/rest/v1/store_members?id=eq.${encodeURIComponent(id)}` +
      `&store_id=eq.${encodeURIComponent(storeId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=representation"),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      cache: "no-store"
    });

    if (!res.ok) {
      if (isMissingSchema(res.status)) return { ok: false, skipped: true };
      const text = await res.text().catch(() => "");
      return { ok: false, error: `member update ${res.status}: ${text}` };
    }

    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    // PATCH yang tidak mengenai baris apa pun tetap 200 dengan array kosong —
    // itu berarti anggotanya bukan milik toko ini (atau sudah dihapus).
    if (!row) return { ok: false, notFound: true, error: "Anggota tidak ditemukan." };
    return { ok: true, data: row as StoreMemberRecord };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function touchStoreMemberLogin(id: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg || !id) return;
  try {
    await fetch(`${cfg.url}/rest/v1/store_members?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify({ last_login_at: new Date().toISOString() }),
      cache: "no-store"
    });
  } catch {
    // Stempel login terakhir itu hiasan; kegagalannya tidak boleh menggagalkan login.
  }
}

// ---------------- BUKU CATATAN PERINGATAN (anti-spam) ----------------

/**
 * Catat bahwa peringatan `kind` sudah dikirim untuk sebuah nomor.
 *
 * Tanpa ini setiap polling dashboard (25 detik sekali) akan mengirim ulang
 * peringatan yang sama — pemilik toko diberi 140 pesan WhatsApp per jam untuk
 * satu nomor yang terputus, dan itu membuat peringatannya diabaikan.
 */
export async function noteDeviceAlert(deviceId: string, kind: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg || !deviceId) return;
  try {
    await fetch(`${cfg.url}/rest/v1/store_devices?id=eq.${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify({ last_alert_at: new Date().toISOString(), last_alert_kind: kind }),
      cache: "no-store"
    });
  } catch {
    // Kolomnya mungkin belum ada. Kegagalan di sini hanya berarti peringatan
    // berikutnya bisa terkirim lebih cepat dari seharusnya.
  }
}

/** Bersihkan catatan peringatan setelah nomor pulih, supaya kabar berikutnya terkirim. */
export async function clearDeviceAlert(deviceId: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg || !deviceId) return;
  try {
    await fetch(`${cfg.url}/rest/v1/store_devices?id=eq.${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify({ last_alert_at: null, last_alert_kind: null }),
      cache: "no-store"
    });
  } catch {
    // Lihat catatan di `noteDeviceAlert`.
  }
}

export async function noteQuotaAlert(storeId: string, pct: number): Promise<void> {
  const cfg = getConfig();
  if (!cfg || !storeId) return;
  try {
    await fetch(`${cfg.url}/rest/v1/stores?id=eq.${encodeURIComponent(storeId)}`, {
      method: "PATCH",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify({
        last_quota_alert_at: new Date().toISOString(),
        last_quota_alert_pct: Math.round(pct)
      }),
      cache: "no-store"
    });
  } catch {
    // Lihat catatan di `noteDeviceAlert`.
  }
}


/**
 * Kolom yang dibaca cron pengingat masa aktif.
 *
 * Disebut satu per satu, BUKAN `select=*`: kalau migrasi kolom anti-ulang belum
 * dijalankan, permintaan ini gagal dengan jelas di sini. Dengan `select=*` kolom
 * itu hanya "tidak ada" — dan cron akan mengirim pengingat yang sama setiap hari
 * karena penanda "sudah dikabari" tidak pernah bisa dibaca maupun ditulis.
 */
const EXPIRY_SELECT_COLUMNS = [
  "id",
  "email",
  "store_name",
  "customer_name",
  "customer_phone",
  "alert_phone",
  "notify_enabled",
  "package_id",
  "is_paid",
  "trial_ends_at",
  "subscription_ends_at",
  "last_expiry_alert_days",
  "last_expiry_alert_at"
].join(",");

/**
 * Toko yang tanggal akhir masa aktifnya jatuh di dalam rentang `fromIso..toIso`.
 *
 * Dua tanggal diperiksa sekaligus karena keduanya bisa menjadi batas hidup sebuah
 * toko: `trial_ends_at` untuk akun yang belum pernah bayar, `subscription_ends_at`
 * untuk yang sudah. Penyaringan ambang yang sebenarnya (H-3 / H-1 / hari-H)
 * dikerjakan pemanggil dengan `daysUntil`, jadi rentang di sini sengaja dilebihkan
 * supaya pembulatan hari tidak pernah menjatuhkan toko yang seharusnya masuk.
 */
export async function listStoresNearExpiry(params: {
  fromIso: string;
  toIso: string;
  limit?: number;
}): Promise<
  { ok: true; stores: StoreRecord[] } | { ok: false; needsMigration: boolean; error: string }
> {
  const cfg = getConfig();
  if (!cfg) {
    return { ok: false, needsMigration: false, error: "Supabase belum dikonfigurasi." };
  }

  const from = encodeURIComponent(params.fromIso);
  const to = encodeURIComponent(params.toIso);
  const limit = Math.max(1, Math.min(params.limit || 500, 1000));

  const or =
    `or=(and(trial_ends_at.gte.${from},trial_ends_at.lte.${to}),` +
    `and(subscription_ends_at.gte.${from},subscription_ends_at.lte.${to}))`;

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/stores?select=${EXPIRY_SELECT_COLUMNS}&${or}` +
        `&order=updated_at.asc&limit=${limit}`,
      { headers: headers(cfg.key), cache: "no-store" }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Tabel `stores` sudah pasti ada (seluruh aplikasi memakainya), jadi 400 di
      // sini praktis selalu berarti kolom anti-ulangnya yang belum dibuat.
      const needsMigration = res.status === 400 && text.includes("last_expiry_alert");
      return { ok: false, needsMigration, error: `stores expiry ${res.status}: ${text}` };
    }

    const data = await res.json();
    return { ok: true, stores: Array.isArray(data) ? (data as StoreRecord[]) : [] };
  } catch (err) {
    return { ok: false, needsMigration: false, error: String(err) };
  }
}

/**
 * Catat bahwa pengingat masa aktif pada ambang `days` sudah dikirim.
 *
 * Dicatat walau pengirimannya GAGAL — pola yang sama dengan `noteDeviceAlert`.
 * Kalau tidak, toko yang nomor WhatsApp-nya bermasalah akan dicoba lagi setiap
 * hari sampai masa aktifnya benar-benar habis.
 *
 * Mengembalikan `false` bila pencatatannya sendiri gagal: itu berarti anti-ulang
 * tidak berfungsi dan cron besok akan mengirim pesan yang sama, jadi pemanggil
 * perlu menyuarakannya, bukan menelannya.
 */
export async function noteExpiryAlert(storeId: string, days: number): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg || !storeId) return false;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/stores?id=eq.${encodeURIComponent(storeId)}`, {
      method: "PATCH",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify({
        last_expiry_alert_at: new Date().toISOString(),
        last_expiry_alert_days: Math.round(days)
      }),
      cache: "no-store"
    });
    return res.ok;
  } catch {
    return false;
  }
}
