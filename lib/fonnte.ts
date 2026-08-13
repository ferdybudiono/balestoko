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
 * Buat Device Baru di Fonnte menggunakan Account Token milik SaaS Owner
 */
export async function createFonnteDevice(name: string, accountToken?: string): Promise<{ success: boolean; token?: string; error?: string }> {
  const token = accountToken || process.env.FONNTE_TOKEN;
  if (!token) {
    return { success: false, error: "Account Token Fonnte (FONNTE_TOKEN) belum di-set di ENV." };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("name", name);
    formData.append("device", name);

    const res = await fetch("https://api.fonnte.com/add-device", {
      method: "POST",
      headers: {
        Authorization: token
      },
      body: formData,
      cache: "no-store"
    });

    const data = await res.json();
    if (res.ok && data.status && data.token) {
      return { success: true, token: data.token };
    }

    // Jika gagal buat device baru, gunakan account token sebagai token device bawaan
    return { success: true, token, error: data.reason || data.message };
  } catch (err) {
    console.error("[fonnte] Exception creating device:", err);
    return { success: true, token, error: String(err) };
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
 * Cek status device Fonnte (Connected / Disconnected)
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
    return {
      status: !!data.status,
      device: data.device || data.whatsapp || "Active Device",
      quota: data.quota || "Unlimited",
      reason: data.reason || data.message
    };
  } catch (err) {
    return { status: false, reason: String(err) };
  }
}

/**
 * Dapatkan Gambar QR Code langsung dari Fonnte API untuk di-scan oleh user di dalam Dashboard SaaS
 */
export async function getFonnteQRCode(token: string): Promise<{ success: boolean; qrUrl?: string; error?: string }> {
  const activeToken = token || process.env.FONNTE_TOKEN;
  if (!activeToken || activeToken.trim() === "") {
    return { success: false, error: "Token Fonnte kosong" };
  }

  try {
    const res = await fetch("https://api.fonnte.com/qr", {
      method: "POST",
      headers: {
        Authorization: activeToken
      },
      cache: "no-store"
    });

    if (!res.ok) {
      return { success: false, error: `HTTP Error ${res.status}` };
    }

    const data = await res.json();
    if (data.status && (data.url || data.url_image)) {
      return { success: true, qrUrl: data.url || data.url_image };
    }

    return { success: false, error: data.reason || data.message || "QR Code tidak tersedia atau WhatsApp sudah terhubung!" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
