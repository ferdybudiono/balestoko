/**
 * Klien Supabase minimalis lewat PostgREST (REST API bawaan Supabase) —
 * tanpa menambah dependency @supabase/supabase-js.
 *
 * Semua fungsi di sini SERVER-ONLY karena memakai SERVICE_ROLE_KEY.
 * Jangan pernah import file ini dari komponen client.
 *
 * Desain "graceful degradation": kalau env Supabase belum di-set, fungsi
 * tidak melempar error fatal — hanya mengembalikan {ok:false} + warning,
 * supaya alur pembayaran tetap jalan saat development.
 */

const TABLE = "orders";

function getConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured(): boolean {
  return getConfig() !== null;
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
  snap_token?: string | null;
  raw_notification?: Record<string, unknown> | null;
}

interface DbResult {
  ok: boolean;
  error?: string;
  skipped?: boolean;
}

function headers(key: string, prefer: string): HeadersInit {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

/** Insert order baru (status awal PENDING) ke tabel `orders`. */
export async function insertPendingOrder(
  order: OrderRecord
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) {
    console.warn(
      "[supabase] Env belum di-set — lewati simpan order. (order_id=%s)",
      order.order_id
    );
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`${cfg.url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify(order),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[supabase] insert gagal:", res.status, text);
      return { ok: false, error: `insert ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[supabase] insert exception:", err);
    return { ok: false, error: String(err) };
  }
}

/** Update status order (dipanggil dari webhook notifikasi Midtrans). */
export async function updateOrderStatus(
  orderId: string,
  status: string,
  rawNotification?: Record<string, unknown>
): Promise<DbResult> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, skipped: true };

  try {
    const url = `${cfg.url}/rest/v1/${TABLE}?order_id=eq.${encodeURIComponent(
      orderId
    )}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: headers(cfg.key, "return=minimal"),
      body: JSON.stringify({
        status,
        raw_notification: rawNotification ?? null,
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[supabase] update gagal:", res.status, text);
      return { ok: false, error: `update ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[supabase] update exception:", err);
    return { ok: false, error: String(err) };
  }
}
