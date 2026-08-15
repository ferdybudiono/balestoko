/**
 * Fonnte WhatsApp API Gateway Helper
 * Handles device creation using Account Token, sending messages, checking status, and fetching QR codes.
 */

export interface FonnteSendOptions {
  target: string; // Nomor WhatsApp penerima (misal: "081234567890" atau "6281234567890")
  message: string;
  token: string; // Fonnte Device Token
}

export interface FonnteDeviceResponse {
  status: boolean;
  device?: string;
  name?: string;
  quota?: string;
  expired?: string;
  reason?: string;
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
 * Set/Update URL webhook "incoming chat" pada sebuah device Fonnte secara
 * otomatis (tanpa user perlu setting manual di dashboard Fonnte).
 *
 * Endpoint /update-device butuh DEVICE token (bukan account token) + wajib
 * mengirim `name` & `device`. `webhook` = url penerima pesan masuk.
 */
export async function setFonnteWebhook(
  deviceToken: string,
  deviceName: string,
  deviceNumber: string,
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  if (!deviceToken) return { success: false, error: "Device token kosong." };
  if (!webhookUrl) return { success: false, error: "URL webhook kosong." };

  const name = (deviceName || "Device").trim().slice(0, 30) || "Device";
  const device = formatFonntePhone(deviceNumber);

  try {
    const formData = new URLSearchParams();
    formData.append("name", name);
    formData.append("device", device);
    formData.append("webhook", webhookUrl);

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
    return { success: false, error: data.reason || data.message || "Gagal mengatur webhook device." };
  } catch (err) {
    console.error("[fonnte] Exception setting webhook:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Kirim pesan WhatsApp ke pembeli lewat Fonnte API
 */
export async function sendFonnteMessage(options: FonnteSendOptions): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { target, message, token } = options;
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
 * Cek status device Fonnte (Connected / Disconnected).
 *
 * PENTING: response /device punya DUA field berbeda:
 *  - `status`  → hanya menandakan TOKEN VALID (request sukses), BUKAN koneksi WA.
 *  - `device_status` → status login WhatsApp sebenarnya ("connect"/"disconnect").
 * Device yang baru dibuat via add-device selalu "disconnect" sampai QR di-scan,
 * jadi kita HARUS memakai `device_status`, bukan `status`.
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

    const data = await res.json();

    // Token tidak valid / error dari Fonnte.
    if (!data.status) {
      return {
        status: false,
        reason: data.reason || data.message || "Token device tidak valid."
      };
    }

    const connected =
      String(data.device_status || "").toLowerCase() === "connect";

    return {
      status: connected,
      device: data.device || data.whatsapp || "Active Device",
      quota: data.quota || "Unlimited",
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
