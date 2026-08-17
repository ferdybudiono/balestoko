import { formatFonntePhone, setFonnteWebhook } from "@/lib/fonnte";
import { updateStoreDevice, upsertStore, type StoreDeviceRecord, type StoreRecord } from "@/lib/supabase";

/**
 * URL webhook Fonnte — satu sumber kebenaran.
 *
 * Dipakai `/api/fonnte/qr` & `/api/fonnte/devices` (saat provisioning device) dan
 * `/api/fonnte/webhook` (saat memperbaiki device lama). Kalau tempat-tempat itu
 * menghitung URL dengan cara berbeda, sinkronisasi jadi kejar-kejaran yang tidak
 * pernah selesai.
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
export function isWebhookUrlSynced(device: Pick<StoreDeviceRecord, "webhook_url">): boolean {
  if (!process.env.FONNTE_WEBHOOK_SECRET) return true;
  return (device.webhook_url || "").includes("secret=");
}

/**
 * Nama device di Fonnte. Dibatasi 2–30 karakter oleh Fonnte, dan karena satu
 * toko kini bisa punya beberapa nomor, akhiran 4 digit terakhir dipakai supaya
 * device bisa dibedakan di dashboard Fonnte.
 */
export function fonnteDeviceName(storeName: string | undefined, phone: string): string {
  const base = (storeName || "Toko").trim() || "Toko";
  const suffix = phone.replace(/\D/g, "").slice(-4);
  return `${base.slice(0, 24)}-${suffix}`.slice(0, 30);
}

/**
 * Sinkronkan URL webhook sebuah device ke `desired` bila berbeda (idempoten).
 * Mengembalikan true jika setelah pemanggilan ini URL sudah sesuai.
 */
export async function syncDeviceWebhookUrl(params: {
  store: StoreRecord;
  device: StoreDeviceRecord;
  desired: string;
}): Promise<boolean> {
  const { store, device, desired } = params;
  if (device.webhook_url === desired) return true;
  if (!device.fonnte_token) return false;

  const phone = formatFonntePhone(device.phone || "");
  if (phone.replace(/\D/g, "").length < 10) return false;

  const hook = await setFonnteWebhook(
    device.fonnte_token,
    fonnteDeviceName(store.store_name, phone),
    phone,
    desired
  );
  if (!hook.success) {
    console.warn("[webhook-url] gagal menyinkronkan URL webhook device:", hook.error);
    return false;
  }

  if (device.id) {
    await updateStoreDevice(device.id, { webhook_url: desired });
  }
  // Cerminkan ke `stores` untuk device utama — dan untuk device hasil fallback
  // legacy (tanpa `id`), di mana kolom `stores` adalah satu-satunya tempat simpan.
  if (device.is_primary || !device.id) {
    if (store.email) await upsertStore({ email: store.email, webhook_url: desired });
  }
  return true;
}
