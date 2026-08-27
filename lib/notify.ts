/**
 * Pemberitahuan keluar untuk PEMILIK toko (bukan untuk pembeli).
 *
 * Semua kabar penting aplikasi ini sebelumnya hanya muncul di dashboard, yang
 * artinya baru diketahui saat pemilik toko membukanya. Tiga kejadian tidak boleh
 * menunggu selama itu:
 *
 *   • nomor WhatsApp terputus  → bot berhenti membalas SEMUA pembeli;
 *   • kuota percakapan hampir habis → pembeli berikutnya tidak akan dijawab;
 *   • pesanan baru masuk → uang menunggu diproses.
 *
 * Semuanya dikirim lewat WhatsApp memakai device toko itu sendiri. Konsekuensinya
 * disengaja: kabar "nomor terputus" hanya bisa terkirim bila masih ada nomor LAIN
 * yang tersambung. Toko satu-nomor yang nomornya mati memang tidak punya jalur
 * keluar — dan itu lebih baik daripada memakai token akun bersama, yang berarti
 * pesan pemilik toko A keluar dari nomor toko B.
 */

import { sendFonnteMessage } from "@/lib/fonnte";
import {
  clearDeviceAlert,
  listStoreDevices,
  noteDeviceAlert,
  noteQuotaAlert,
  type StoreDeviceRecord,
  type StoreRecord
} from "@/lib/supabase";

/** Nomor tujuan kabar: nomor khusus bila diisi, kalau tidak nomor akun toko. */
function alertTarget(store: StoreRecord): string | null {
  const explicit = (store.alert_phone || "").trim();
  if (explicit) return explicit;
  const fallback = (store.customer_phone || "").trim();
  return fallback || null;
}

/**
 * Device yang dipakai MENGIRIM kabar.
 *
 * `excludeId` dipakai saat yang dikabarkan justru device yang mati: mengirim lewat
 * device yang sedang terputus tidak akan pernah sampai.
 */
function senderDevice(
  devices: StoreDeviceRecord[],
  excludeId?: string | null
): StoreDeviceRecord | null {
  const usable = devices.filter(
    (d) =>
      d.id !== excludeId &&
      (d.fonnte_token || "").trim() &&
      String(d.device_status || "").toLowerCase() === "connected"
  );
  return usable.find((d) => d.is_primary) || usable[0] || null;
}

/**
 * Kirim satu kabar ke pemilik toko. Selalu "best effort".
 *
 * Kegagalan TIDAK pernah dilempar ke atas: semua pemanggilnya berada di jalur yang
 * pekerjaan utamanya sudah selesai (pembeli sudah dibalas, pesanan sudah dicatat).
 * Menggagalkan request karena kabar ke pemilik toko tidak terkirim hanya membuat
 * webhook Fonnte mengirim ulang pesan yang sama.
 */
async function notifyOwner(params: {
  store: StoreRecord;
  text: string;
  /** Jangan kirim lewat device ini (dipakai saat device itulah yang bermasalah). */
  excludeDeviceId?: string | null;
  devices?: StoreDeviceRecord[];
}): Promise<boolean> {
  const { store, text, excludeDeviceId, devices } = params;

  if (store.notify_enabled === false) return false;

  const target = alertTarget(store);
  if (!target) return false;

  try {
    const list = devices || (await listStoreDevices(store.id || ""));
    const sender = senderDevice(list, excludeDeviceId);
    if (!sender?.fonnte_token) return false;

    const sent = await sendFonnteMessage({ target, message: text, token: sender.fonnte_token });
    if (!sent.success) console.warn("[notify] kabar ke pemilik toko gagal:", sent.error);
    return sent.success;
  } catch (err) {
    console.warn("[notify] kabar ke pemilik toko gagal:", String(err));
    return false;
  }
}

/** Jeda minimum antar kabar sejenis untuk satu device/toko. */
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function cooledDown(lastAt: string | null | undefined): boolean {
  if (!lastAt) return true;
  const t = new Date(lastAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= ALERT_COOLDOWN_MS;
}

/**
 * Nomor WhatsApp toko terputus.
 *
 * Anti-spam WAJIB di sini: dashboard memeriksa status device tiap 25 detik, jadi
 * tanpa penahan ini satu nomor mati menghasilkan ±140 pesan WhatsApp per jam ke
 * pemilik toko — dan tagihan Fonnte-nya nyata.
 */
export async function notifyDeviceDisconnected(params: {
  store: StoreRecord;
  device: StoreDeviceRecord;
  devices?: StoreDeviceRecord[];
}): Promise<void> {
  const { store, device, devices } = params;
  if (!device.id) return;

  const sameKind = device.last_alert_kind === "disconnected";
  if (sameKind && !cooledDown(device.last_alert_at)) return;

  const label = device.label || device.phone || "Nomor WhatsApp";
  const ok = await notifyOwner({
    store,
    devices,
    excludeDeviceId: device.id,
    text:
      `⚠️ *Nomor WhatsApp terputus*\n\n` +
      `${label} sedang tidak tersambung, jadi chat pembeli ke nomor itu TIDAK dibalas bot.\n\n` +
      `Buka dashboard → tab Nomor WA → *Sambungkan* dan scan ulang QR-nya ya.`
  });

  // Dicatat walau gagal kirim: kalau tidak, percobaan kirim yang gagal akan
  // diulang tiap 25 detik selamanya.
  await noteDeviceAlert(device.id, "disconnected");
  if (!ok) console.log("[notify] kabar device terputus tidak terkirim untuk", label);
}

/** Nomor tersambung kembali — hanya membersihkan penanda, tanpa kirim pesan. */
export async function notifyDeviceReconnected(device: StoreDeviceRecord): Promise<void> {
  if (!device.id || !device.last_alert_kind) return;
  await clearDeviceAlert(device.id);
}

/** Ambang peringatan kuota, dari yang paling mendesak. */
const QUOTA_STEPS = [100, 90, 80];

/**
 * Kuota percakapan bulanan hampir/sudah habis.
 *
 * Dikirim per-ambang: 80%, 90%, lalu 100%. `last_quota_alert_pct` mencegah
 * pengulangan ambang yang sama, dan tanggalnya dipakai supaya bulan baru bisa
 * memperingatkan lagi dari nol.
 */
export async function notifyQuotaThreshold(params: {
  store: StoreRecord;
  used: number;
  limit: number;
  devices?: StoreDeviceRecord[];
}): Promise<void> {
  const { store, used, limit, devices } = params;
  if (!store.id || limit <= 0) return;

  const pct = Math.floor((used / limit) * 100);
  const step = QUOTA_STEPS.find((s) => pct >= s);
  if (!step) return;

  // Peringatan bulan LALU tidak boleh membungkam bulan ini.
  const lastAt = store.last_quota_alert_at ? new Date(store.last_quota_alert_at) : null;
  const now = new Date();
  const sameMonth =
    !!lastAt &&
    Number.isFinite(lastAt.getTime()) &&
    lastAt.getUTCFullYear() === now.getUTCFullYear() &&
    lastAt.getUTCMonth() === now.getUTCMonth();
  if (sameMonth && (store.last_quota_alert_pct || 0) >= step) return;

  const habis = step >= 100;
  await notifyOwner({
    store,
    devices,
    text: habis
      ? `🚫 *Kuota percakapan bulan ini habis*\n\n` +
        `Terpakai ${used} dari ${limit} percakapan. Pembeli BARU tidak akan dibalas bot sampai bulan depan ` +
        `(percakapan yang sudah berjalan tetap dilayani).\n\n` +
        `Upgrade paket dari dashboard → tab Langganan untuk melanjutkan.`
      : `📊 *Kuota percakapan ${step}%*\n\n` +
        `Terpakai ${used} dari ${limit} percakapan bulan ini.\n\n` +
        `Kalau perkiraannya kurang, upgrade paket dari dashboard → tab Langganan.`
  });

  await noteQuotaAlert(store.id, step);
}

/**
 * Pesanan baru masuk.
 *
 * Tanpa penahan waktu, dan itu memang benar: tiap pesanan adalah kejadian berbeda
 * yang berisi uang. Yang menjaga volumenya adalah pemanggil — kabar ini hanya
 * dikirim saat baris pesanan BARU dibuat, bukan tiap kali pesanan diperbarui.
 */
export async function notifyNewOrder(params: {
  store: StoreRecord;
  customerPhone: string;
  customerName?: string | null;
  items: Array<{ name: string; units: number }>;
  subtotal: number;
  city?: string | null;
  devices?: StoreDeviceRecord[];
}): Promise<void> {
  const { store, customerPhone, customerName, items, subtotal, city, devices } = params;

  const lines = items.map((i) => `• ${i.name} × ${i.units}`).join("\n");
  await notifyOwner({
    store,
    devices,
    text:
      `🛒 *Pesanan baru*\n\n` +
      `${customerName ? `${customerName} — ` : ""}wa.me/${customerPhone.replace(/\D/g, "")}\n` +
      `${lines || "(produk belum terbaca)"}\n` +
      `Subtotal: Rp ${subtotal.toLocaleString("id-ID")}\n` +
      `${city ? `Tujuan: ${city}\n` : ""}` +
      `\nBuka dashboard → tab Pesanan untuk memprosesnya.`
  });
}
