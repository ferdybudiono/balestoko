import crypto from "crypto";
import { isReachableBaseUrl, knownBaseUrls } from "@/lib/webhook-url";

/**
 * Helper Midtrans Snap tanpa SDK — cukup fetch + HTTP Basic Auth.
 * Docs: https://docs.midtrans.com/reference/backend-integration
 */

const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";

const SNAP_BASE_URL = IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";

function getServerKey(): string {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key) {
    throw new Error(
      "MIDTRANS_SERVER_KEY belum di-set. Salin .env.example ke .env.local dan isi kuncinya."
    );
  }
  return key;
}

/** Header Authorization: Basic base64(serverKey + ":") */
function authHeader(): string {
  const token = Buffer.from(`${getServerKey()}:`).toString("base64");
  return `Basic ${token}`;
}

// ---------------- NOTIFICATION URL OVERRIDE ----------------

/**
 * URL webhook milik project INI dikirim PER-TRANSAKSI, bukan mengandalkan
 * "Payment Notification URL" di dashboard Midtrans.
 *
 * Alasannya: satu akun Midtrans dipakai untuk beberapa project, dan dashboard
 * hanya menyediakan SATU Payment Notification URL untuk seluruh akun. Tanpa
 * override, siapa pun yang mengisi kolom itu terakhir akan "memenangkan" semua
 * notifikasi: project lain jadi tidak pernah tahu pembayarannya lunas, order
 * tersangkut PENDING selamanya, dan langganan tidak pernah aktif walau uangnya
 * sudah masuk. Dengan header di bawah, setiap transaksi membawa alamat balasannya
 * sendiri — dashboard tidak perlu disetel lagi dan project lain tidak tersentuh.
 *
 * Project ini sendiri dilayani di beberapa domain, jadi yang didaftarkan bukan
 * satu URL melainkan semua domain aplikasi (maks. 3). Notifikasi ganda tidak
 * berbahaya dan justru menyelamatkan pembayaran bila satu domain bermasalah.
 *
 * Docs: https://docs.midtrans.com/reference/override-notification-url
 *   X-Override-Notification -> ganti URL dashboard untuk transaksi ini
 *   X-Append-Notification   -> tambahkan di atas URL dashboard
 * Maksimal 3 URL, dipisah koma. Bila keduanya dikirim, override yang dipakai.
 */
const NOTIFICATION_PATH = "/api/midtrans/notification";
const MAX_OVERRIDE_URLS = 3;
// Mode append: URL dashboard ikut dihitung terhadap batas 3, jadi sisakan slot.
const MAX_APPEND_URLS = 2;

export type NotificationMode = "override" | "append" | "off";

export type NotificationHeaderName =
  | "X-Override-Notification"
  | "X-Append-Notification";

export interface NotificationTarget {
  mode: NotificationMode;
  /** null = header tidak dikirim, Midtrans memakai URL dari dashboard. */
  header: NotificationHeaderName | null;
  urls: string[];
  /** Kenapa sebagian/semua URL tidak dipakai — untuk log & diagnosa. */
  reason?: string;
}

/** URL webhook Midtrans untuk sebuah base URL aplikasi. */
export function buildMidtransNotificationUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}${NOTIFICATION_PATH}`;
}

/**
 * Lengkapi entri `MIDTRANS_NOTIFICATION_URL` yang hanya berisi domain.
 *
 * Menulis `https://balestoko.my.id` (tanpa path) adalah salah tulis yang wajar,
 * dan akibatnya tidak kelihatan: Midtrans mem-POST ke halaman depan, dapat 200
 * dari landing page, dan status order tidak pernah berubah. Karena aplikasi ini
 * hanya punya satu endpoint webhook, entri tanpa path selalu berarti base URL.
 */
function withNotificationPath(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return buildMidtransNotificationUrl(parsed.origin);
    }
  } catch {
    // Bukan URL absolut — biarkan, nanti ditolak `isDeliverableNotificationUrl`.
  }
  return url;
}

function readNotificationMode(): NotificationMode {
  const raw = (process.env.MIDTRANS_NOTIFICATION_MODE || "override")
    .trim()
    .toLowerCase();
  if (raw === "append" || raw === "off") return raw;
  return "override";
}

/**
 * Midtrans hanya mau mengirim notifikasi ke URL publik dengan port standar
 * (80/443). URL localhost/jaringan privat/port aneh tidak ditolak dengan pesan
 * jelas — notifikasinya sekadar tidak pernah datang. Lebih baik header-nya tidak
 * dikirim sama sekali (jatuh ke URL dashboard, perilaku lama) daripada MENGGANTI
 * URL dashboard dengan alamat yang mustahil dijangkau.
 */
function isDeliverableNotificationUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") return false;
  return isReachableBaseUrl(url);
}

/**
 * Tentukan header + URL notifikasi untuk satu request charge/Snap.
 *
 * Prioritas:
 *   1. `MIDTRANS_NOTIFICATION_URL` (boleh 1–3 URL dipisah koma) — untuk kasus
 *      URL webhook berbeda dari domain aplikasi (mis. lewat tunnel/proxy).
 *      Entri tanpa path otomatis dilengkapi `/api/midtrans/notification`.
 *   2. SEMUA domain aplikasi dari ENV: `NEXT_PUBLIC_BASE_URL` +
 *      `NEXT_PUBLIC_ALT_BASE_URLS`, masing-masing + path webhook. Project ini
 *      dilayani di lebih dari satu domain, dan mendaftarkan semuanya membuat
 *      pembayaran tetap teraktivasi walau satu domain sedang bermasalah
 *      (DNS/sertifikat). Notifikasi ganda aman: transisi ke PAID dijalankan
 *      lewat PATCH bersyarat `status=neq.PAID`, jadi hanya satu yang menang.
 *   3. `baseUrl` dari pemanggil — hanya dipakai bila ENV di atas kosong
 *      (dev/preview yang belum di-set).
 */
export function resolveNotificationTarget(baseUrl?: string): NotificationTarget {
  const mode = readNotificationMode();
  if (mode === "off") {
    return {
      mode,
      header: null,
      urls: [],
      reason:
        "MIDTRANS_NOTIFICATION_MODE=off — memakai Payment Notification URL dari dashboard Midtrans.",
    };
  }

  const explicit = (process.env.MIDTRANS_NOTIFICATION_URL || "").trim();
  const envBases = knownBaseUrls();
  const bases = envBases.length > 0 ? envBases : [(baseUrl || "").trim()].filter(Boolean);

  const candidates = explicit
    ? explicit
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
        .map(withNotificationPath)
    : bases.map(buildMidtransNotificationUrl);

  if (candidates.length === 0) {
    return {
      mode,
      header: null,
      urls: [],
      reason:
        "MIDTRANS_NOTIFICATION_URL, NEXT_PUBLIC_BASE_URL, dan NEXT_PUBLIC_ALT_BASE_URLS semuanya kosong.",
    };
  }

  const usable: string[] = [];
  const rejected: string[] = [];
  for (const url of candidates) {
    if (!isDeliverableNotificationUrl(url)) {
      rejected.push(url);
      continue;
    }
    if (!usable.includes(url)) usable.push(url);
  }

  if (usable.length === 0) {
    return {
      mode,
      header: null,
      urls: [],
      reason:
        `URL notifikasi (${rejected.join(", ")}) bukan URL publik berport standar, ` +
        "jadi header override TIDAK dikirim dan Midtrans memakai URL dashboard. " +
        "Isi NEXT_PUBLIC_BASE_URL (atau MIDTRANS_NOTIFICATION_URL) dengan domain publik aplikasi.",
    };
  }

  const limit = mode === "append" ? MAX_APPEND_URLS : MAX_OVERRIDE_URLS;
  const urls = usable.slice(0, limit);
  const dropped = [...rejected, ...usable.slice(limit)];

  return {
    mode,
    header: mode === "append" ? "X-Append-Notification" : "X-Override-Notification",
    urls,
    reason: dropped.length
      ? `URL berikut diabaikan (tidak publik atau melewati batas ${limit}): ${dropped.join(", ")}`
      : undefined,
  };
}

// Log sekali per pesan: route checkout dipanggil terus-menerus, dan peringatan
// konfigurasi yang sama berulang ribuan kali hanya menenggelamkan log lain.
const warnedNotificationMessages = new Set<string>();
function warnNotificationOnce(message: string): void {
  if (warnedNotificationMessages.has(message)) return;
  warnedNotificationMessages.add(message);
  console.warn("[midtrans] %s", message);
}

export interface SnapCustomerDetail {
  first_name: string;
  last_name?: string;
  email: string;
  phone: string;
}

export interface SnapItemDetail {
  id: string;
  price: number;
  quantity: number;
  name: string;
}

export interface CreateSnapParams {
  orderId: string;
  grossAmount: number;
  customer: SnapCustomerDetail;
  items: SnapItemDetail[];
  /** Metadata bebas — ikut tersimpan di transaksi Midtrans. */
  metadata?: Record<string, unknown>;
  callbackFinishUrl?: string;
  /**
   * Base URL aplikasi untuk menghitung URL notifikasi transaksi ini — hanya
   * dipakai bila `NEXT_PUBLIC_BASE_URL`/`NEXT_PUBLIC_ALT_BASE_URLS` dan
   * `MIDTRANS_NOTIFICATION_URL` semuanya kosong (dev/preview).
   */
  notificationBaseUrl?: string;
}

export interface SnapCreateResult {
  token: string;
  redirect_url: string;
}

/**
 * Membuat Snap transaction dan mengembalikan token + redirect_url.
 * Token inilah yang dipakai `snap.pay(token)` di browser untuk memunculkan pop-up.
 */
export async function createSnapTransaction(
  params: CreateSnapParams
): Promise<SnapCreateResult> {
  const body = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.grossAmount,
    },
    credit_card: { secure: true },
    customer_details: params.customer,
    item_details: params.items,
    metadata: params.metadata ?? {},
    callbacks: params.callbackFinishUrl
      ? { finish: params.callbackFinishUrl }
      : undefined,
  };

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authHeader(),
  };

  // URL notifikasi dikunci per-transaksi (lihat blok NOTIFICATION URL OVERRIDE
  // di atas): akun Midtrans yang sama dipakai beberapa project, jadi kolom
  // Payment Notification URL di dashboard tidak bisa jadi sumber kebenaran.
  const notify = resolveNotificationTarget(params.notificationBaseUrl);
  if (notify.header && notify.urls.length > 0) {
    headers[notify.header] = notify.urls.join(",");
  }
  if (notify.reason) warnNotificationOnce(notify.reason);

  const res = await fetch(SNAP_BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const messages = Array.isArray(data.error_messages)
      ? (data.error_messages as string[]).join(", ")
      : `HTTP ${res.status}`;
    throw new Error(`Midtrans menolak transaksi: ${messages}`);
  }

  if (!data.token || !data.redirect_url) {
    throw new Error("Respon Midtrans tidak berisi token/redirect_url.");
  }

  return {
    token: data.token as string,
    redirect_url: data.redirect_url as string,
  };
}

/**
 * Verifikasi signature dari webhook/notification Midtrans.
 * signature_key = SHA512(order_id + status_code + gross_amount + server_key)
 */
export function verifyNotificationSignature(payload: {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
}): boolean {
  const expected = crypto
    .createHash("sha512")
    .update(
      payload.order_id +
        payload.status_code +
        payload.gross_amount +
        getServerKey()
    )
    .digest("hex");

  // Bandingkan dengan timing-safe compare untuk cegah timing attack.
  const a = Buffer.from(expected);
  const b = Buffer.from(payload.signature_key || "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Terjemahkan transaction_status + fraud_status Midtrans ke status order internal.
 */
export function mapMidtransStatus(
  transactionStatus: string,
  fraudStatus?: string
): "PAID" | "PENDING" | "FAILED" | "CHALLENGE" {
  switch (transactionStatus) {
    case "capture":
      return fraudStatus === "challenge" ? "CHALLENGE" : "PAID";
    case "settlement":
      return "PAID";
    case "pending":
      return "PENDING";
    case "deny":
    case "cancel":
    case "expire":
    case "failure":
      return "FAILED";
    default:
      return "PENDING";
  }
}

export const midtransConfig = {
  isProduction: IS_PRODUCTION,
  snapBaseUrl: SNAP_BASE_URL,
  /** Path webhook yang dikirim ke Midtrans sebagai header override. */
  notificationPath: NOTIFICATION_PATH,
};
