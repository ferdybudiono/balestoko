import { applyFonnteDeviceSettings, formatFonntePhone, getFonnteDeviceStatus } from "@/lib/fonnte";
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

/**
 * Apakah base URL ini bisa dijangkau Fonnte dari internet?
 *
 * `NEXT_PUBLIC_BASE_URL=http://localhost:3000` (nilai contoh di `.env.example`)
 * yang lupa diganti saat deploy adalah kegagalan yang paling sulit dilacak:
 * pendaftaran webhook ke Fonnte SUKSES, dashboard tampak sehat, uji coba dari
 * dashboard tetap membalas — tapi Fonnte menembak localhost-nya sendiri, jadi
 * chat pembeli tidak pernah sampai. Lebih baik gagal keras dengan pesan jelas.
 */
export function isReachableBaseUrl(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  if (host === "127.0.0.1" || host.startsWith("127.")) return false;
  // Jaringan privat RFC1918 — publik tidak bisa menjangkaunya.
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

/**
 * URL webhook yang aman dikirim ke browser.
 *
 * `FONNTE_WEBHOOK_SECRET` adalah rahasia BERSAMA seluruh tenant: kalau nilainya
 * ikut tampil di dashboard, pemilik toko mana pun bisa memalsukan pesan masuk
 * untuk nomor device toko lain. Jadi nilainya selalu disamarkan.
 */
export function redactWebhookUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.searchParams.has("secret")) u.searchParams.set("secret", "***");
    return u.toString();
  } catch {
    return url.replace(/secret=[^&]*/gi, "secret=***");
  }
}

/**
 * Bandingkan dua URL webhook dengan toleransi kosmetik (spasi & garis miring di
 * ujung).
 *
 * Perbandingan yang terlalu kaku di sini bukan cuma cerewet — ia memicu
 * perbaikan berulang: setiap kali dashboard dibuka, satu panggilan
 * `update-device` terkirim untuk "membetulkan" URL yang sebenarnya sudah benar.
 */
function sameWebhookUrl(a: string | null | undefined, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "");
  return a != null && norm(a) === norm(b);
}

/**
 * Device sudah memakai URL webhook yang BENAR-BENAR sama dengan yang berlaku?
 *
 * Dulu fungsi ini hanya memeriksa apakah URL "mengandung" `secret=`. Akibatnya
 * satu kali rotasi `FONNTE_WEBHOOK_SECRET` (atau pindah domain) mematikan bot
 * secara permanen: device mengirim secret lama, dianggap "sudah tersinkron",
 * lalu setiap pesan pembeli ditolak 401 tanpa jalan pulih sendiri.
 *
 * Perbandingan persis membuat device bersecret-lama kembali masuk jalur
 * perbaikan sekali-pakai, sama seperti device yang belum pernah tersinkron.
 */
export function isWebhookUrlSynced(
  device: Pick<StoreDeviceRecord, "webhook_url">,
  desired: string
): boolean {
  return sameWebhookUrl(device.webhook_url, desired);
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

export interface WebhookSyncResult {
  ok: boolean;
  /** URL yang dituju (baik yang berhasil dipasang maupun yang gagal). */
  url: string;
  /** Tidak ada panggilan ke Fonnte karena setelan sudah sesuai. */
  unchanged?: boolean;
  /** Alasan gagal, siap ditampilkan ke pemilik toko. */
  error?: string;
}

/**
 * Sinkronkan setelan penerimaan pesan sebuah device ke Fonnte (idempoten):
 * URL webhook `desired` + `autoread` menyala.
 *
 * `force: true` melewati pintasan "sudah sesuai" — dipakai saat rekonsiliasi
 * menemukan setelan di Fonnte melenceng dari yang kita catat.
 */
export async function syncDeviceWebhookUrl(params: {
  store: StoreRecord;
  device: StoreDeviceRecord;
  desired: string;
  force?: boolean;
}): Promise<WebhookSyncResult> {
  const { store, device, desired, force = false } = params;

  if (!device.fonnte_token) {
    return { ok: false, url: desired, error: "Nomor ini belum punya device Fonnte." };
  }

  if (!isReachableBaseUrl(desired)) {
    return {
      ok: false,
      url: desired,
      error:
        `URL webhook (${desired}) menunjuk ke localhost/jaringan privat, ` +
        "jadi Fonnte tidak bisa mengirim pesan masuk ke sana. " +
        "Isi NEXT_PUBLIC_BASE_URL dengan domain publik aplikasi lalu deploy ulang."
    };
  }

  // Pintasan: URL sudah sesuai DAN autoread sudah tercatat menyala.
  //
  // Syarat autoread itu penting — bukan sekadar hiasan. Semua device yang
  // tersambung sebelum perbaikan ini punya `webhook_url` yang sudah benar tapi
  // `autoread` NULL (belum pernah dinyalakan), dan tanpa autoread webhook Fonnte
  // tidak pernah jalan. Tanpa syarat kedua, device-device itu akan selamanya
  // melewati sinkronisasi dan bot-nya tetap bisu.
  //
  // Device legacy (tanpa `id`) tidak punya tempat menyimpan `autoread`, jadi
  // untuk mereka URL yang sudah sesuai dianggap cukup agar jalur webhook tidak
  // memanggil Fonnte pada SETIAP pesan masuk.
  const canRemember = !!device.id;
  if (
    !force &&
    sameWebhookUrl(device.webhook_url, desired) &&
    (device.autoread === true || !canRemember)
  ) {
    return { ok: true, url: desired, unchanged: true };
  }

  const phone = formatFonntePhone(device.phone || "");
  if (phone.replace(/\D/g, "").length < 10) {
    return { ok: false, url: desired, error: "Nomor device tidak valid." };
  }

  const applied = await applyFonnteDeviceSettings(device.fonnte_token, {
    name: fonnteDeviceName(store.store_name, phone),
    deviceNumber: phone,
    webhookUrl: desired,
    autoread: true
  });
  if (!applied.success) {
    console.warn("[webhook-url] gagal menyinkronkan setelan device:", applied.error);
    return { ok: false, url: desired, error: applied.error || "Fonnte menolak perubahan setelan." };
  }

  if (device.id) {
    await updateStoreDevice(device.id, { webhook_url: desired, autoread: true });
  }
  // Cerminkan ke `stores` untuk device utama — dan untuk device hasil fallback
  // legacy (tanpa `id`), di mana kolom `stores` adalah satu-satunya tempat simpan.
  if (device.is_primary || !device.id) {
    if (store.email) await upsertStore({ email: store.email, webhook_url: desired });
  }
  // Cerminkan juga ke objek in-memory supaya pemanggil yang memakai `device`
  // setelah ini tidak melihat data basi.
  device.webhook_url = desired;
  device.autoread = true;

  return { ok: true, url: desired };
}

/**
 * Nyalakan `autoread` di Fonnte TANPA menyentuh setelan webhook.
 *
 * Dipakai ketika URL publik aplikasi belum tersedia: URL webhook memang belum
 * bisa dipasang, tapi autoread tidak perlu ikut menunggu — dan menundanya
 * berbahaya, karena device yang lahir dengan autoread mati akan tetap bisu nanti
 * meski URL-nya sudah dibetulkan, sampai ada yang menekan "Perbaiki otomatis".
 */
async function enableAutoreadOnly(
  store: StoreRecord,
  device: StoreDeviceRecord
): Promise<{ success: boolean; error?: string }> {
  if (!device.fonnte_token) return { success: false, error: "Nomor ini belum punya device Fonnte." };

  const phone = formatFonntePhone(device.phone || "");
  if (phone.replace(/\D/g, "").length < 10) {
    return { success: false, error: "Nomor device tidak valid." };
  }

  const applied = await applyFonnteDeviceSettings(device.fonnte_token, {
    name: fonnteDeviceName(store.store_name, phone),
    deviceNumber: phone,
    webhookUrl: null,
    autoread: true
  });
  if (!applied.success) return applied;

  if (device.id) await updateStoreDevice(device.id, { autoread: true });
  device.autoread = true;
  return { success: true };
}

export interface InboundProvisionResult {
  /** Jalur terima siap: webhook terpasang DAN autoread tidak dilaporkan mati. */
  ok: boolean;
  /** Kondisi `autoread` hasil pembacaan ulang dari Fonnte; `null` = tidak dilaporkan. */
  autoread: boolean | null;
  /** URL webhook berhasil dipasang di Fonnte. */
  webhookSynced: boolean;
  /** Kendala yang perlu dibaca pemilik toko. */
  error?: string;
}

/**
 * Siapkan jalur TERIMA sebuah device yang baru dibuat: pasang URL webhook,
 * nyalakan `autoread`, lalu VERIFIKASI dengan membaca ulang dari Fonnte.
 *
 * Tiga hal yang membedakannya dari `syncDeviceWebhookUrl` biasa:
 *
 * 1. `autoread` dinyalakan walaupun URL webhook belum bisa dipasang. Dulu satu
 *    `NEXT_PUBLIC_BASE_URL` yang belum diisi membuat fungsi sinkronisasi pulang
 *    lebih awal, jadi `update-device` tidak pernah terpanggil dan device lahir
 *    dengan autoread mati.
 * 2. Hasilnya diperiksa ulang ke Fonnte, bukan disimpulkan dari "request kami
 *    tidak error". Autoread adalah setelan yang paling mahal kalau salah: device
 *    tampak sehat, uji kirim sukses, tapi tidak satu pun chat pembeli sampai.
 * 3. Catatan `autoread` di database dikoreksi menjadi `false` bila Fonnte
 *    ternyata melaporkannya mati — supaya rekonsiliasi berikutnya tidak
 *    melewatinya lewat pintasan "sudah tersinkron".
 */
export async function provisionDeviceInbound(params: {
  store: StoreRecord;
  device: StoreDeviceRecord;
  desired: string;
}): Promise<InboundProvisionResult> {
  const { store, device, desired } = params;

  if (!device.fonnte_token) {
    return {
      ok: false,
      autoread: null,
      webhookSynced: false,
      error: "Nomor ini belum punya device Fonnte."
    };
  }

  const reachable = isReachableBaseUrl(desired);
  let webhookSynced = false;
  let error: string | undefined;

  if (reachable) {
    // `force` karena device ini baru lahir: tidak ada setelan lama yang layak
    // dipercaya, dan pintasan "sudah sesuai" hanya akan melewatkan panggilan yang
    // justru wajib terjadi sekali ini.
    const sync = await syncDeviceWebhookUrl({ store, device, desired, force: true });
    webhookSynced = sync.ok;
    error = sync.error;
  } else {
    const applied = await enableAutoreadOnly(store, device);
    error =
      applied.error ||
      `URL webhook (${desired}) menunjuk ke localhost/jaringan privat, jadi Fonnte belum bisa ` +
        "mengirim pesan masuk ke sana. Auto read sudah dinyalakan, tapi isi NEXT_PUBLIC_BASE_URL " +
        "dengan domain publik aplikasi lalu deploy ulang agar chat pembeli bisa masuk.";
  }

  // Baca ulang kondisi sebenarnya. Sekali gagal → coba lagi sekali, lalu baca ulang.
  let live = await getFonnteDeviceStatus(device.fonnte_token);
  if (live.autoread === false) {
    if (reachable) await syncDeviceWebhookUrl({ store, device, desired, force: true });
    else await enableAutoreadOnly(store, device);
    live = await getFonnteDeviceStatus(device.fonnte_token);
  }

  const autoread = live.autoread ?? null;

  if (autoread === false) {
    if (device.id) await updateStoreDevice(device.id, { autoread: false });
    device.autoread = false;
    error =
      "Fonnte masih melaporkan Auto read MATI untuk nomor ini. Tanpa Auto read, chat pembeli " +
      "tidak akan pernah sampai ke aplikasi — nyalakan manual di dashboard Fonnte, atau tekan " +
      "\"Perbaiki otomatis\" di tab WhatsApp.";
  }

  return { ok: webhookSynced && autoread !== false, autoread, webhookSynced, error };
}

export interface DeviceInboundHealth {
  /** WhatsApp benar-benar login (hasil pembacaan langsung ke Fonnte). */
  connected: boolean;
  /** Setelan `auto read` menurut Fonnte; `null` = tidak dilaporkan. */
  autoread: boolean | null;
  /** URL webhook di Fonnte (sudah disamarkan); `null` = tidak dilaporkan. */
  webhookAtFonnte: string | null;
  /** URL webhook yang berlaku sekarang, sudah disamarkan. */
  expectedWebhook: string | null;
  /** URL di Fonnte (atau di DB bila Fonnte diam) sama dengan yang berlaku. */
  webhookSynced: boolean;
  /** Setelan sempat diperbaiki pada pemanggilan ini. */
  repaired: boolean;
  /** Kendala yang perlu dibaca pemilik toko. */
  error?: string;
}

/**
 * Bandingkan setelan device di Fonnte dengan yang seharusnya, perbaiki bila
 * melenceng, lalu laporkan kondisinya untuk ditampilkan di dashboard.
 *
 * Ini penambal celah "drift": `syncDeviceWebhookUrl` percaya pada catatan kita
 * sendiri, jadi kalau setelan di Fonnte hilang (device dibuat ulang, disetel
 * manual, atau QR discan ulang) aplikasi tidak akan pernah tahu. Rekonsiliasi
 * ini membaca kondisi NYATA dari Fonnte — dan tidak menambah biaya panggilan
 * karena tab WhatsApp memang sudah menanyakan status tiap nomor.
 */
export async function reconcileDeviceInbound(params: {
  store: StoreRecord;
  device: StoreDeviceRecord;
  desired: string;
  /** Selalu dorong ulang setelan walau tampak sudah benar (tombol "Perbaiki"). */
  force?: boolean;
}): Promise<DeviceInboundHealth> {
  const { store, device, desired, force = false } = params;
  const expectedWebhook = redactWebhookUrl(desired);

  if (!device.fonnte_token) {
    return {
      connected: false,
      autoread: null,
      webhookAtFonnte: null,
      expectedWebhook,
      webhookSynced: false,
      repaired: false,
      error: "Nomor ini belum punya device Fonnte."
    };
  }

  const live = await getFonnteDeviceStatus(device.fonnte_token);

  // Fonnte melaporkan URL webhook → pakai itu sebagai kebenaran (termasuk saat
  // yang dilaporkan adalah string kosong: itu berarti webhook-nya DIKOSONGKAN).
  // Kalau Fonnte diam soal field ini, catatan kita di DB adalah petunjuk terbaik.
  const webhookMismatch =
    live.webhook != null
      ? !sameWebhookUrl(live.webhook, desired)
      : !sameWebhookUrl(device.webhook_url, desired);
  const autoreadOff = live.autoread === false || (live.autoread === null && device.autoread !== true);

  let repaired = false;
  let error: string | undefined;

  if (force || webhookMismatch || autoreadOff) {
    const sync = await syncDeviceWebhookUrl({ store, device, desired, force: true });
    repaired = sync.ok;
    error = sync.error;
  }

  return {
    connected: live.status,
    // Urutan sumber: hasil perbaikan → laporan Fonnte → catatan kita sendiri.
    // Catatan DB dipakai terakhir karena nilainya hanya menjadi `true` setelah
    // Fonnte MENERIMA `update-device` dengan autoread menyala. Tanpa fallback itu,
    // response `/device` yang tidak memuat field ini membuat panel dashboard
    // tersangkut di "belum diketahui" selamanya.
    autoread: repaired ? true : live.autoread ?? device.autoread ?? null,
    webhookAtFonnte: redactWebhookUrl(repaired ? desired : live.webhook),
    expectedWebhook,
    webhookSynced: repaired || !webhookMismatch,
    repaired,
    error: error || (live.status ? undefined : live.reason)
  };
}
