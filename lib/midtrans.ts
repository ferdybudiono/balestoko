import crypto from "crypto";

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

  const res = await fetch(SNAP_BASE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
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
};
