/**
 * Pemberitahuan keluar untuk PEMILIK toko (bukan untuk pembeli).
 *
 * Semua kabar penting aplikasi ini sebelumnya hanya muncul di dashboard, yang
 * artinya baru diketahui saat pemilik toko membukanya. Empat kejadian tidak boleh
 * menunggu selama itu:
 *
 *   • nomor WhatsApp terputus  → bot berhenti membalas SEMUA pembeli;
 *   • kuota percakapan hampir habis → pembeli berikutnya tidak akan dijawab;
 *   • pesanan baru masuk → uang menunggu diproses;
 *   • masa uji coba / langganan akan berakhir → bot akan berhenti total.
 *
 * Semuanya dikirim lewat WhatsApp memakai device toko itu sendiri. Konsekuensinya
 * disengaja: kabar "nomor terputus" hanya bisa terkirim bila masih ada nomor LAIN
 * yang tersambung. Toko satu-nomor yang nomornya mati memang tidak punya jalur
 * keluar — dan itu lebih baik daripada memakai token akun bersama, yang berarti
 * pesan pemilik toko A keluar dari nomor toko B.
 *
 * SATU pengecualian: pengingat masa aktif (`notifyExpiryReminder`) boleh memakai
 * account token `FONNTE_TOKEN` lewat `allowAccountToken`. Alasannya, penerimanya
 * justru sebagian besar TIDAK punya device tersambung — akun uji coba yang belum
 * pernah scan QR adalah audiens utamanya — jadi aturan di atas akan membuat
 * pengingat ini tidak pernah sampai ke siapa pun yang paling membutuhkannya.
 * Isinya pun murni tentang akun penerima sendiri, tidak membawa identitas toko
 * lain seperti balasan pembeli.
 */

import { sendFonnteMessage } from "@/lib/fonnte";
import { daysUntil } from "@/lib/packages";
import {
  bumpRateLimit,
  clearDeviceAlert,
  listStoreDevices,
  noteDeviceAlert,
  noteExpiryAlert,
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
  /**
   * Boleh jatuh ke account token `FONNTE_TOKEN` bila toko ini tidak punya satu pun
   * nomor tersambung. HANYA untuk kabar yang isinya murni soal akun penerima —
   * lihat catatan di kepala berkas ini dan di `FonnteSendOptions.token`.
   */
  allowAccountToken?: boolean;
}): Promise<boolean> {
  const { store, text, excludeDeviceId, devices, allowAccountToken } = params;

  if (store.notify_enabled === false) return false;

  const target = alertTarget(store);
  if (!target) return false;

  try {
    const list = devices || (await listStoreDevices(store.id || ""));
    const sender = senderDevice(list, excludeDeviceId);
    const token = (sender?.fonnte_token || "").trim();
    if (!token && !allowAccountToken) return false;

    // `token: ""` berarti "pakai FONNTE_TOKEN" di `sendFonnteMessage`.
    const sent = await sendFonnteMessage({ target, message: text, token });
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
 * Jeda antar kabar "lokasi asal belum disetel", dalam detik (6 jam).
 *
 * Ditegakkan lewat `bumpRateLimit` — bukan kolom penanda baru di tabel `stores`.
 * Alasannya: kunci `origin-alert:<storeId>` sudah cukup, tidak perlu migrasi, dan
 * penahannya berlaku lintas instance serverless (penahan in-memory berarti
 * "satu pesan per instance per 6 jam", yang bukan penahan).
 */
const ORIGIN_ALERT_WINDOW_SEC = 6 * 60 * 60;

/**
 * Pembeli menanyakan ongkir tapi toko belum menetapkan lokasi asal pengiriman.
 *
 * Ini satu-satunya kelalaian pengaturan yang gejalanya dialami PEMBELI, bukan
 * pemilik toko: botnya tetap ramah, tetap menjawab, hanya menolak menyebut angka
 * ongkir. Tanpa kabar ini pemilik toko tidak punya alasan untuk curiga — dan
 * satu-satunya petunjuk ada di dashboard yang mungkin tidak dibuka berhari-hari,
 * sementara setiap pertanyaan ongkir yang masuk berakhir tanpa harga.
 *
 * Anti-spamnya sengaja gagal-TERTUTUP (`enforced: false` → tidak dikirim), kebalikan
 * dari `bumpRateLimit` di jalur lain. Yang dipertaruhkan di sini bukan balasan ke
 * pembeli — itu sudah terkirim sebelum fungsi ini dipanggil — melainkan tagihan
 * WhatsApp pemilik toko: satu toko ramai tanpa origin bisa menerima ratusan pesan
 * identik per hari. Banner di dashboard tetap menjadi jalur utamanya, jadi
 * kehilangan satu kabar WhatsApp bukan kehilangan informasinya.
 */
export async function notifyOriginMissing(params: {
  store: StoreRecord;
  devices?: StoreDeviceRecord[];
}): Promise<void> {
  const { store, devices } = params;
  if (!store.id) return;

  const gate = await bumpRateLimit(`origin-alert:${store.id}`, ORIGIN_ALERT_WINDOW_SEC, 1);
  if (!gate.enforced || !gate.allowed) return;

  await notifyOwner({
    store,
    devices,
    text:
      `📍 *Lokasi kirim belum disetel*\n\n` +
      `Ada pembeli menanyakan ongkir, tapi bot TIDAK bisa menyebut tarifnya karena ` +
      `lokasi asal pengiriman toko belum dipilih. Pembeli itu diminta menunggu balasan Anda.\n\n` +
      `Buka dashboard → tab Pengaturan Toko → *Lokasi asal pengiriman*, pilih kecamatan ` +
      `dari hasil pencarian, lalu Simpan. Setelah itu ongkir dihitung otomatis.`
  });
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

/** Ambang pengingat masa aktif (hari tersisa), dari yang paling mendesak. */
const EXPIRY_STEPS = [0, 1, 3];

/** Ambang paling awal: H-3. Juga lebar jendela "catatan ini milik periode ini". */
const EXPIRY_FIRST_STEP = 3;

/** Sampai berapa hari SESUDAH tanggal akhir pengingat masih dikirim. */
const EXPIRY_PAST_GRACE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rentang tanggal akhir yang perlu diambil dari database untuk satu putaran cron.
 *
 * Dilebihkan sehari di kedua ujung dari ambang sebenarnya: `daysUntil` membulatkan
 * ke atas, dan jadwal cron bisa bergeser beberapa jam. Penyaringan tepatnya tetap
 * di `notifyExpiryReminder`, jadi kelebihan di sini tidak pernah menghasilkan
 * pesan tambahan — hanya beberapa baris ekstra yang lalu dilewati.
 */
export function expiryReminderWindow(nowMs: number = Date.now()): {
  fromIso: string;
  toIso: string;
} {
  return {
    fromIso: new Date(nowMs - (EXPIRY_PAST_GRACE_DAYS + 1) * DAY_MS).toISOString(),
    toIso: new Date(nowMs + (EXPIRY_FIRST_STEP + 1) * DAY_MS).toISOString()
  };
}

export interface ExpiryReminderOutcome {
  /** Pesan benar-benar terkirim. */
  sent: boolean;
  /** Ambang yang diproses; `null` bila toko ini belum waktunya dikabari. */
  step: number | null;
  kind: "trial" | "subscription" | null;
  /** Penanda anti-ulang berhasil ditulis. `false` = cron besok akan mengulang. */
  noted: boolean;
  /** Alasan singkat untuk log bila tidak dikirim. */
  reason?: string;
}

/** "3 hari lagi" / "besok" / "hari ini" / "sudah berakhir". */
function expiryWhen(days: number): string {
  if (days > 1) return `${days} hari lagi`;
  if (days === 1) return "besok";
  if (days === 0) return "hari ini";
  return "sudah berakhir";
}

/**
 * Masa uji coba / langganan akan berakhir.
 *
 * Ini kabar yang paling mahal kalau tidak ada: uji coba 7 hari dan langganan 30
 * hari sebelumnya mati dalam diam, jadi pemilik toko baru tahu botnya berhenti
 * dari keluhan pembeli. Dikirim pada tiga ambang — H-3, H-1, dan hari-H (termasuk
 * dua hari sesudahnya) — masing-masing tepat sekali.
 *
 * Dipanggil dari `/api/cron/reminders`, sekali sehari. Karena itu SEMUA keputusan
 * "kirim atau tidak" ada di sini, bukan di route-nya: satu tempat yang bisa diuji,
 * dan cron-nya tinggal melaporkan hasil.
 */
export async function notifyExpiryReminder(params: {
  store: StoreRecord;
  /** Base URL publik aplikasi, untuk tautan pembayaran di dalam pesan. */
  baseUrl: string;
  nowMs?: number;
  /**
   * Hitung ambangnya saja: jangan kirim WhatsApp dan jangan tulis penanda
   * anti-ulang. Dipakai `?dry=1` di cron untuk memastikan sasarannya benar
   * sebelum menghabiskan pulsa Fonnte.
   */
  dryRun?: boolean;
}): Promise<ExpiryReminderOutcome> {
  const { store, baseUrl, dryRun } = params;
  const nowMs = params.nowMs ?? Date.now();
  const idle = (reason: string): ExpiryReminderOutcome => ({
    sent: false,
    step: null,
    kind: null,
    noted: false,
    reason
  });

  if (!store.id) return idle("toko tanpa id");

  // Tanggal yang menentukan, dengan aturan yang SAMA seperti `storeActivityState`:
  // langganan bila akun sudah pernah bayar, kalau tidak masa uji cobanya. Kalau
  // aturannya beda, pesan yang dikirim bisa bertentangan dengan status yang
  // dilihat pemilik toko di dashboard.
  const kind: "trial" | "subscription" =
    store.is_paid && store.subscription_ends_at ? "subscription" : "trial";
  const endsAt = kind === "subscription" ? store.subscription_ends_at : store.trial_ends_at;

  const days = daysUntil(endsAt, nowMs);
  if (days === null) return idle("tanpa tanggal akhir");
  if (days > EXPIRY_FIRST_STEP) return idle(`masih ${days} hari`);
  if (days < -EXPIRY_PAST_GRACE_DAYS) return idle(`berakhir ${-days} hari lalu`);

  const step = EXPIRY_STEPS.find((s) => days <= s);
  if (step === undefined) return idle("di luar ambang");

  // Catatan dari periode SEBELUMNYA wajib diabaikan. Tanpa ini satu perpanjangan
  // membungkam pengingat selamanya: `last_expiry_alert_days` tersimpan 0, dan 0
  // lebih kecil dari ambang mana pun sehingga tidak ada kabar yang pernah lolos
  // lagi. Pengingat paling awal terbit H-3, jadi catatan yang lebih tua dari itu
  // (plus sehari kelonggaran jadwal cron) pasti milik tanggal akhir yang lama —
  // dan perpanjangan selalu menggeser tanggal 30 hari, jauh di luar jendela ini.
  const endMs = new Date(endsAt as string).getTime();
  const windowStartMs = endMs - (EXPIRY_FIRST_STEP + 1) * DAY_MS;
  const notedAtMs = store.last_expiry_alert_at
    ? new Date(store.last_expiry_alert_at).getTime()
    : NaN;
  const lastStep =
    Number.isFinite(notedAtMs) && notedAtMs >= windowStartMs ? store.last_expiry_alert_days : null;

  if (typeof lastStep === "number" && lastStep <= step) {
    return idle(`ambang ${step} sudah dikabari`);
  }

  if (dryRun) return { sent: false, step, kind, noted: false, reason: "mode kering" };

  const when = expiryWhen(days);
  const link = `${baseUrl.replace(/\/+$/, "")}/#harga`;
  const label = kind === "subscription" ? "Langganan" : "Masa uji coba";
  const habis = days <= 0;

  const text = habis
    ? `🚫 *${label} sudah berakhir*\n\n` +
      `Bot WhatsApp ${store.store_name || "toko Anda"} berhenti membalas chat pembeli. ` +
      `Produk, nomor, dan riwayat chat Anda tetap tersimpan dan langsung aktif lagi ` +
      `begitu ${kind === "subscription" ? "diperpanjang" : "berlangganan"}.\n\n` +
      `${kind === "subscription" ? "Perpanjang" : "Pilih paket"} di sini: ${link}\n` +
      `Pakai email *${store.email}* saat membayar supaya paketnya menempel ke toko ini.`
    : `⏳ *${label} berakhir ${when}*\n\n` +
      `${label} BalesToko.ai untuk ${store.store_name || "toko Anda"} habis ${when}. ` +
      `Sesudah itu bot berhenti membalas chat pembeli sampai ` +
      `${kind === "subscription" ? "diperpanjang" : "Anda berlangganan"}.\n\n` +
      `${kind === "subscription" ? "Perpanjang" : "Pilih paket"} di sini: ${link}\n` +
      `Pakai email *${store.email}* saat membayar supaya paketnya menempel ke toko ini.`

  // `allowAccountToken`: audiens terbesar pengingat ini justru akun uji coba yang
  // belum pernah menyambungkan WhatsApp. Lihat catatan di kepala berkas.
  const sent = await notifyOwner({ store, text, allowAccountToken: true });

  // Dicatat walau gagal kirim — kalau tidak, toko yang nomornya bermasalah dicoba
  // ulang setiap hari sampai masa aktifnya benar-benar habis.
  const noted = await noteExpiryAlert(store.id, step);

  return { sent, step, kind, noted, reason: sent ? undefined : "pengiriman gagal" };
}
