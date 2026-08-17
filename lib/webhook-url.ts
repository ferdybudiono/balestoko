import { setFonnteWebhook } from "@/lib/fonnte";
import { upsertStore, type StoreRecord } from "@/lib/supabase";

/**
 * URL webhook Fonnte — satu sumber kebenaran.
 *
 * Dipakai `/api/fonnte/qr` (saat provisioning device) dan `/api/fonnte/webhook`
 * (saat memperbaiki device lama). Kalau dua tempat itu menghitung URL dengan
 * cara berbeda, sinkronisasi jadi kejar-kejaran yang tidak pernah selesai.
 */
export function buildFonnteWebhookUrl(base: string): string {
  const url = `${base.replace(/\/+$/, "")}/api/fonnte/webhook`;
  const secret = process.env.FONNTE_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url;
}

/** Base URL publik aplikasi, dari ENV dengan fallback ke origin request. */
export function resolveBaseUrl(req: Request): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    req.headers.get("origin") ||
    new URL(req.url).origin
  );
}

/** Device sudah memakai URL webhook ber-secret? */
export function isWebhookUrlSynced(store: Pick<StoreRecord, "webhook_url">): boolean {
  if (!process.env.FONNTE_WEBHOOK_SECRET) return true;
  return (store.webhook_url || "").includes("secret=");
}

/**
 * Sinkronkan URL webhook device ke `desired` bila berbeda (idempoten).
 * Mengembalikan true jika setelah pemanggilan ini URL sudah sesuai.
 */
export async function syncStoreWebhookUrl(
  store: StoreRecord,
  desired: string
): Promise<boolean> {
  if (store.webhook_url === desired) return true;
  if (!store.fonnte_token || !store.email) return false;

  const deviceNumber = store.customer_phone || "";
  if (deviceNumber.replace(/\D/g, "").length < 10) return false;

  const deviceName = `${store.store_name || "Toko"}-${(store.id || "").slice(0, 8)}`;
  const hook = await setFonnteWebhook(store.fonnte_token, deviceName, deviceNumber, desired);
  if (!hook.success) {
    console.warn("[webhook-url] gagal menyinkronkan URL webhook device:", hook.error);
    return false;
  }

  await upsertStore({ email: store.email, webhook_url: desired });
  return true;
}
