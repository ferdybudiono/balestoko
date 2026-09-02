/**
 * Fonnte WhatsApp API Gateway Helper
 * Handles device creation using Account Token, sending messages, checking status, and fetching QR codes.
 */

export interface FonnteSendOptions {
  target: string; // Nomor WhatsApp penerima (misal: "081234567890" atau "6281234567890")
  message: string;
  /**
   * Fonnte DEVICE token — nomor mana yang mengirim.
   *
   * Sengaja WAJIB (bukan opsional) meski string kosong diterima: setiap pemanggil
   * harus memutuskan sadar nomor siapa yang dipakai. String kosong berarti
   * "pakai account token `FONNTE_TOKEN`", dan itu HANYA boleh untuk pesan tingkat
   * sistem kepada pemilik akun sendiri (OTP reset, pengingat masa aktif).
   *
   * Untuk BALASAN PEMBELI token toko wajib ada dan tidak boleh kosong — lihat
   * `lib/reply-engine.ts`: balasan yang keluar dari nomor toko lain adalah
   * kebocoran identitas antar-tenant.
   */
  token: string;
  /**
   * URL gambar yang dilampirkan (foto produk).
   *
   * Fonnte menerima beberapa URL sekaligus lewat satu field `url` yang dipisah
   * koma. Karena itu URL yang MEMUAT koma tidak bisa dikirim dan dibuang di sini:
   * mengirimnya apa adanya akan membuat Fonnte memecahnya menjadi dua URL rusak,
   * dan pembeli menerima pesan tanpa gambar sama sekali.
   */
  urls?: string[];
}

export interface FonnteDeviceResponse {
  status: boolean;
  device?: string;
  name?: string;
  quota?: string;
  expired?: string;
  reason?: string;
  /**
   * Setelan `auto read` device menurut Fonnte. `null` = Fonnte tidak
   * melaporkannya di response ini (jangan disimpulkan sebagai "mati").
   *
   * PENTING: Fonnte MEWAJIBKAN auto read menyala agar webhook pesan masuk
   * dipanggil ("if you leave it off, your webhook won't work!"). Jadi nilai
   * `false` di sini berarti bot tidak akan pernah membalas chat pembeli,
   * seberapa benar pun sisa konfigurasinya.
   */
  autoread?: boolean | null;
  /** URL webhook pesan masuk yang benar-benar tersimpan di sisi Fonnte. */
  webhook?: string | null;
}

/**
 * Normalisasi nomor WhatsApp ke format Fonnte (bebas spasi/dash, awali 08 atau 62)
 */
export function formatFonntePhone(phone: string): string {
  let clean = phone.replace(/[^\d+]/g, "");
  if (clean.startsWith("+")) clean = clean.slice(1);
  if (clean.startsWith("0")) clean = "62" + clean.slice(1);
  if (!clean.startsWith("62")) clean = "62" + clean;
  return clean;
}

/**
 * Baca flag boolean dari response Fonnte. Fonnte tidak konsisten: ada yang
 * mengirim boolean asli, ada yang "true"/"false", 1/0, atau "on"/"off".
 * Nilai yang tidak dikenali → `null` ("tidak tahu"), bukan `false`, supaya
 * dashboard tidak menuduh setelan mati padahal Fonnte hanya diam.
 */
function parseFonnteFlag(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["true", "1", "on", "yes", "y", "aktif", "enable", "enabled"].includes(s)) return true;
  if (["false", "0", "off", "no", "n", "nonaktif", "disable", "disabled"].includes(s)) return false;
  return null;
}

/** Ambil nilai pertama yang terisi dari beberapa kemungkinan nama field. */
function pickField(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const v = source[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * Buat Device Baru di Fonnte menggunakan Account Token milik SaaS Owner.
 * `phone` (nomor tujuan device) WAJIB dan harus unik lintas seluruh akun Fonnte.
 */
export async function createFonnteDevice(
  name: string,
  phone: string,
  accountToken?: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  const token = accountToken || process.env.FONNTE_TOKEN;
  if (!token) {
    return { success: false, error: "Account Token Fonnte (FONNTE_TOKEN) belum di-set di ENV." };
  }

  const devicePhone = formatFonntePhone(phone);
  if (!devicePhone || devicePhone.replace(/\D/g, "").length < 8) {
    return { success: false, error: "Nomor WhatsApp device tidak valid (min. 8 digit)." };
  }

  // Nama device dibatasi 2–30 karakter oleh Fonnte.
  const deviceName = (name || "Device").trim().slice(0, 30) || "Device";

  try {
    const formData = new URLSearchParams();
    formData.append("name", deviceName);
    formData.append("device", devicePhone);

    const res = await fetch("https://api.fonnte.com/add-device", {
      method: "POST",
      headers: {
        Authorization: token
      },
      body: formData,
      cache: "no-store"
    });

    const data = await res.json();
    if (res.ok && data.status && (data.token || data.device_token)) {
      return { success: true, token: data.token || data.device_token };
    }

    // Gagal (nomor sudah dipakai, batas device tercapai, dll). JANGAN fallback ke account token bersama.
    return { success: false, error: data.reason || data.message || "Gagal membuat device Fonnte." };
  } catch (err) {
    console.error("[fonnte] Exception creating device:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Alasan dari Fonnte yang artinya "device itu memang sudah tidak ada di sini".
 * Untuk tujuan kita (nomor bebas dipakai lagi) itu sama saja dengan sukses.
 */
const FONNTE_DEVICE_GONE =
  /not found|tidak ada|no device|belum terdaftar|not registered|tidak terdaftar/;

/**
 * Alasan yang artinya token yang kita pakai bukan (lagi) milik device mana pun.
 *
 * Hanya berlaku saat kita mengautentikasi dengan token DEVICE itu sendiri: token
 * device di Fonnte permanen selama device-nya ada, jadi token yang ditolak
 * berarti device-nya sudah lenyap di sisi Fonnte — dan tidak ada apa pun lagi
 * yang perlu dilepas. Dengan account token, pesan yang sama justru berarti
 * "kamu memakai jenis token yang salah", jadi klasifikasi ini TIDAK boleh
 * dipakai di jalur itu.
 */
const FONNTE_TOKEN_ORPHAN = /invalid device|invalid token|token invalid|token tidak valid/;

/** Fonnte meminta kode OTP; tidak ada yang bisa diulang otomatis dari server. */
const FONNTE_NEEDS_OTP = /otp/;

/**
 * HTTP status yang berarti "coba lagi nanti", bukan "permintaanmu ditolak".
 */
const FONNTE_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DeleteAttempt =
  | { success: true }
  | { success: false; error: string; retryable: boolean; needsOtp?: boolean };

/** Satu kali panggil `delete-device`, sekaligus menilai apakah layak diulang. */
async function attemptDeleteFonnteDevice(
  devicePhone: string,
  token: string,
  usingDeviceToken: boolean
): Promise<DeleteAttempt> {
  try {
    const formData = new URLSearchParams();
    formData.append("device", devicePhone);

    const res = await fetch("https://api.fonnte.com/delete-device", {
      method: "POST",
      headers: { Authorization: token },
      body: formData,
      cache: "no-store"
    });

    // Dibaca sebagai teks dulu: body kosong harus bisa dibedakan dari penolakan
    // yang punya alasan, karena yang pertama layak diulang dan yang kedua tidak.
    const raw = (await res.text().catch(() => "")).trim();
    let data: Record<string, unknown> = {};
    if (raw) {
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }

    if (res.ok && data.status) return { success: true };

    // `detail` WAJIB ikut dibaca: itulah field yang dipakai `delete-device` untuk
    // pesan suksesnya, dan beberapa endpoint Fonnte memakainya untuk alasan gagal
    // juga. Tanpa ini alasan sebenarnya hilang dan user hanya melihat pesan
    // umum — kegagalan yang tidak bisa didiagnosis dari log.
    const reason = String(data.reason || data.detail || data.message || "").trim();
    const lower = reason.toLowerCase();

    // Log SELALU: inilah satu-satunya jejak penyebab di log Vercel. Yang dicatat
    // hanya jawaban Fonnte, bukan token yang kita kirim.
    console.warn(
      `[fonnte] delete-device gagal (HTTP ${res.status}, ${
        usingDeviceToken ? "device token" : "account token"
      }): ${raw.slice(0, 300) || "(body kosong)"}`
    );

    if (FONNTE_DEVICE_GONE.test(lower)) return { success: true };
    // Token device yang ditolak = device-nya sudah tidak ada. Lihat catatan pada
    // FONNTE_TOKEN_ORPHAN kenapa ini hanya sah untuk token device.
    if (usingDeviceToken && FONNTE_TOKEN_ORPHAN.test(lower)) return { success: true };

    if (FONNTE_NEEDS_OTP.test(lower)) {
      return {
        success: false,
        error:
          "Fonnte meminta kode OTP untuk menghapus device, dan kode itu dikirim ke nomor " +
          "WhatsApp pemilik akun Fonnte — jadi penghapusan tidak bisa diselesaikan dari sini.",
        retryable: false,
        needsOtp: true
      };
    }

    // Fonnte sedang goyah (5xx/429) atau tidak menjawab apa pun yang bisa
    // ditafsirkan. Itu gangguan sementara, bukan keputusan — ulangi.
    if (FONNTE_RETRYABLE_STATUS.has(res.status) || !raw) {
      return {
        success: false,
        error: reason || `Fonnte membalas HTTP ${res.status} tanpa keterangan.`,
        retryable: true
      };
    }

    // Fonnte menjawab dengan alasan yang jelas. Mengulang hanya menunda kabar buruk.
    return {
      success: false,
      error: reason || `Fonnte menolak tanpa keterangan (HTTP ${res.status}).`,
      retryable: false
    };
  } catch (err) {
    console.error("[fonnte] Exception deleting device:", err);
    return { success: false, error: String(err), retryable: true };
  }
}

/**
 * Hapus Device di Fonnte.
 *
 * Dipanggil saat pemilik toko melepas salah satu nomornya. Penting karena Fonnte
 * menolak `add-device` untuk nomor yang masih terdaftar — tanpa penghapusan ini,
 * nomor yang pernah dilepas tidak bisa disambungkan lagi.
 *
 * `Authorization` HARUS token DEVICE, bukan account token. Ini berbeda dari
 * `add-device` (account token) dan mudah tertukar, tapi Fonnte membalas tertukar
 * itu dengan `{"reason":"invalid device","status":false}` pada HTTP 200 — sebuah
 * penolakan yang terlihat seperti "nomornya tidak ada", padahal nomornya ada dan
 * yang salah adalah kredensialnya. Account token hanya dipakai sebagai cadangan
 * untuk baris lama yang tokennya tidak tersimpan.
 *
 * Kegagalan sesaat tidak boleh langsung menggagalkan permintaan user: gangguan
 * jaringan dan 5xx dari Fonnte diulang beberapa kali lebih dulu. Penolakan yang
 * jelas beralasan tidak diulang — mengulang hanya memperlambat pesan error yang
 * sama.
 */
export async function deleteFonnteDevice(
  phone: string,
  opts: { deviceToken?: string | null; attempts?: number } = {}
): Promise<{ success: boolean; error?: string; needsOtp?: boolean }> {
  const deviceToken = (opts.deviceToken || "").trim();
  const token = deviceToken || process.env.FONNTE_TOKEN;
  if (!token) {
    return {
      success: false,
      error: "Token Fonnte tidak tersedia (device token kosong dan FONNTE_TOKEN belum diatur)."
    };
  }

  const devicePhone = formatFonntePhone(phone);
  if (!devicePhone || devicePhone.replace(/\D/g, "").length < 8) {
    return { success: false, error: "Nomor device tidak valid." };
  }

  const attempts = Math.max(1, opts.attempts ?? 3);
  let last: DeleteAttempt = { success: false, error: "Gagal menghapus device Fonnte.", retryable: false };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await delay(400 * (attempt - 1));

    const outcome = await attemptDeleteFonnteDevice(devicePhone, token, !!deviceToken);
    if (outcome.success) return { success: true };

    last = outcome;
    if (!outcome.retryable) break;
  }

  return { success: false, error: last.error, needsOtp: last.needsOtp };
}

/**
 * Set/Update setelan penerimaan pesan pada sebuah device Fonnte secara otomatis
 * (tanpa user perlu setting manual di dashboard Fonnte).
 *
 * Endpoint /update-device butuh DEVICE token (bukan account token) + wajib
 * mengirim `name` & `device`.
 *
 * DUA setelan yang dikirim, dan KEDUANYA wajib supaya bot bisa membalas chat
 * pembeli sungguhan:
 *   • `webhook`  → URL penerima pesan masuk.
 *   • `autoread` → Fonnte hanya memanggil webhook bila auto read menyala.
 *                  Device hasil `add-device` tidak menyalakannya sendiri, jadi
 *                  tanpa baris ini pesan pembeli TIDAK PERNAH sampai ke
 *                  aplikasi — padahal uji coba dari dashboard tetap sukses
 *                  (uji coba hanya memakai jalur KIRIM, bukan jalur TERIMA).
 *
 * Nama parameter `autoread` mengikuti istilah Fonnte sendiri ("Auto read" di
 * halaman edit device). Bila suatu saat Fonnte mengganti/mengabaikan namanya,
 * kegagalan itu TIDAK senyap: `getFonnteDeviceStatus` membaca ulang setelan
 * sebenarnya dan dashboard menampilkan peringatan agar dinyalakan manual.
 */
export async function applyFonnteDeviceSettings(
  deviceToken: string,
  settings: {
    name: string;
    deviceNumber: string;
    /**
     * URL webhook pesan masuk.
     *
     * `null` = JANGAN sentuh setelan webhook di Fonnte — dipakai saat yang perlu
     * dinyalakan hanya `autoread` sementara URL publik aplikasi belum tersedia.
     * String KOSONG tetap ditolak: itu selalu berarti pemanggil kehilangan
     * URL-nya, bukan bermaksud membiarkannya, dan mengirimnya ke Fonnte akan
     * menghapus webhook yang sudah benar.
     */
    webhookUrl: string | null;
    autoread?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  const { name: rawName, deviceNumber, webhookUrl, autoread = true } = settings;

  if (!deviceToken) return { success: false, error: "Device token kosong." };
  if (webhookUrl !== null && !webhookUrl) return { success: false, error: "URL webhook kosong." };

  const name = (rawName || "Device").trim().slice(0, 30) || "Device";
  const device = formatFonntePhone(deviceNumber);

  try {
    const formData = new URLSearchParams();
    formData.append("name", name);
    formData.append("device", device);
    if (webhookUrl !== null) formData.append("webhook", webhookUrl);
    formData.append("autoread", autoread ? "true" : "false");

    const res = await fetch("https://api.fonnte.com/update-device", {
      method: "POST",
      headers: {
        Authorization: deviceToken
      },
      body: formData,
      cache: "no-store"
    });

    const data = await res.json();
    if (res.ok && data.status) {
      return { success: true };
    }
    return { success: false, error: data.reason || data.message || "Gagal mengatur setelan device." };
  } catch (err) {
    console.error("[fonnte] Exception updating device settings:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Kirim pesan WhatsApp ke pembeli lewat Fonnte API
 */
export async function sendFonnteMessage(options: FonnteSendOptions): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { target, message, token, urls } = options;
  const activeToken = token || process.env.FONNTE_TOKEN;

  if (!activeToken) {
    console.warn("[fonnte] Missing Fonnte token, message send skipped.");
    return { success: false, error: "Token Fonnte belum diatur." };
  }

  const cleanPhone = formatFonntePhone(target);

  try {
    const formData = new URLSearchParams();
    formData.append("target", cleanPhone);
    formData.append("message", message);
    formData.append("countryCode", "62");

    // Hanya URL http(s) tanpa koma. Sisanya dilewati tanpa menggagalkan kirim:
    // pesan teksnya jauh lebih penting daripada lampirannya, dan gagal total
    // hanya karena satu URL foto cacat berarti pembeli tidak dijawab sama sekali.
    const media = (urls || [])
      .map((u) => (u || "").trim())
      .filter((u) => /^https?:\/\//i.test(u) && !u.includes(","));
    if (media.length > 0) formData.append("url", media.join(","));

    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: activeToken
      },
      body: formData,
      cache: "no-store"
    });

    const data = await res.json();
    if (res.ok && data.status) {
      return { success: true, data };
    }

    console.error("[fonnte] Send message failed:", data);
    return { success: false, error: data.reason || data.message || "Gagal mengirim pesan via Fonnte." };
  } catch (err) {
    console.error("[fonnte] Exception sending message:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Cek status device Fonnte (Connected / Disconnected) + setelan penerimaan pesan.
 *
 * PENTING: response /device punya DUA field berbeda:
 *  - `status`  → hanya menandakan TOKEN VALID (request sukses), BUKAN koneksi WA.
 *  - `device_status` → status login WhatsApp sebenarnya ("connect"/"disconnect").
 * Device yang baru dibuat via add-device selalu "disconnect" sampai QR di-scan,
 * jadi kita HARUS memakai `device_status`, bukan `status`.
 *
 * Fungsi ini juga membaca `autoread` & `webhook` apa adanya dari Fonnte. Itu
 * satu-satunya cara memverifikasi bahwa jalur TERIMA (pesan pembeli → webhook)
 * benar-benar hidup: jalur KIRIM bisa sukses sempurna sementara jalur terima
 * mati total. Keduanya `null` bila Fonnte tidak melaporkannya.
 */
export async function getFonnteDeviceStatus(token: string): Promise<FonnteDeviceResponse> {
  const activeToken = token || process.env.FONNTE_TOKEN;
  if (!activeToken || activeToken.trim() === "") {
    return { status: false, reason: "Token Fonnte kosong" };
  }

  try {
    const res = await fetch("https://api.fonnte.com/device", {
      method: "POST",
      headers: {
        Authorization: activeToken
      },
      cache: "no-store"
    });

    if (!res.ok) {
      return { status: false, reason: `HTTP error ${res.status}` };
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Token tidak valid / error dari Fonnte.
    if (!data.status) {
      return {
        status: false,
        reason: (data.reason as string) || (data.message as string) || "Token device tidak valid."
      };
    }

    // Sebagian response menaruh detail device di dalam array `data`. Field di
    // level atas menang bila keduanya ada.
    const nested = Array.isArray(data.data) ? (data.data[0] as Record<string, unknown>) : null;
    const info: Record<string, unknown> = { ...(nested || {}), ...data };

    const connected = String(info.device_status || "").toLowerCase() === "connect";

    // Field ada tapi KOSONG bukan hal yang sama dengan tidak dilaporkan: URL
    // webhook yang dikosongkan di Fonnte justru kondisi yang wajib diperbaiki.
    // Kalau keduanya disamakan jadi `null`, rekonsiliasi jatuh ke catatan
    // database kita sendiri — yang masih mengklaim "sudah tersinkron" — dan
    // device yang webhook-nya hilang tidak akan pernah dipulihkan.
    const webhookKeys = ["webhook", "webhook_url", "webhookurl", "url_webhook"];
    const webhookValue = pickField(info, webhookKeys);
    const webhookReported = webhookKeys.some((k) => info[k] !== undefined && info[k] !== null);

    return {
      status: connected,
      device: (info.device as string) || (info.whatsapp as string) || "Active Device",
      quota: (info.quota as string) || "Unlimited",
      autoread: parseFonnteFlag(pickField(info, ["autoread", "auto_read", "autoRead"])),
      webhook: webhookValue !== undefined ? String(webhookValue) : webhookReported ? "" : null,
      reason: connected ? undefined : "WhatsApp belum terhubung (belum scan QR)."
    };
  } catch (err) {
    return { status: false, reason: String(err) };
  }
}

/**
 * Dapatkan Gambar QR Code langsung dari Fonnte API (Base64 atau URL) untuk di-scan di Dashboard
 */
export async function getFonnteQRCode(token: string): Promise<{ success: boolean; qrUrl?: string; error?: string }> {
  const activeToken = token || process.env.FONNTE_TOKEN;
  if (!activeToken || activeToken.trim() === "") {
    return { success: false, error: "Token Fonnte kosong" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("type", "qr");

    const res = await fetch("https://api.fonnte.com/qr", {
      method: "POST",
      headers: {
        Authorization: activeToken
      },
      body: formData,
      cache: "no-store"
    });

    if (!res.ok) {
      return { success: false, error: `HTTP Error ${res.status}` };
    }

    const data = await res.json();
    const rawQr = data.url || data.url_image || data.url_base64 || data.qr || data.base64;

    if (data.status && rawQr) {
      let formattedQr = String(rawQr);
      if (!formattedQr.startsWith("http") && !formattedQr.startsWith("data:")) {
        formattedQr = `data:image/png;base64,${formattedQr}`;
      }
      return { success: true, qrUrl: formattedQr };
    }

    return {
      success: false,
      error: data.reason || data.message || "QR Code sedang dimuat atau WhatsApp sudah terhubung! Silakan klik muat ulang dalam 2 detik."
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
