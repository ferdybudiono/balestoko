import { NextResponse } from "next/server";
import { getFonnteQRCode, getFonnteDeviceStatus, createFonnteDevice, setFonnteWebhook, formatFonntePhone } from "@/lib/fonnte";
import { getStoreByEmail, upsertStore } from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** URL webhook publik yang harus dituju device (dari ENV, fallback origin request). */
function resolveWebhookUrl(req: Request): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    req.headers.get("origin") ||
    new URL(req.url).origin;
  const url = `${base.replace(/\/+$/, "")}/api/fonnte/webhook`;
  // Sertakan shared secret bila dikonfigurasi. Webhook menolak request tanpa
  // secret yang benar, jadi tanpa ini device tidak akan bisa mengirim pesan.
  // Karena URL webhook disinkronkan otomatis (idempoten, lihat di bawah),
  // device lama ikut diperbarui saat user membuka tab WhatsApp berikutnya.
  const secret = process.env.FONNTE_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url;
}

/**
 * Ambil QR Code WhatsApp untuk di-scan di dalam Dashboard.
 * Device dibuat memakai nomor WA yang dimasukkan user (?phone=) + Account Token Fonnte milik SaaS Owner.
 */
export async function GET(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const phone = (searchParams.get("phone") || "").trim();

  const store = await getStoreByEmail(email);
  if (!store) {
    return NextResponse.json({ error: "Toko tidak ditemukan untuk akun ini." }, { status: 404 });
  }

  let token = store.fonnte_token || "";
  const desiredWebhook = resolveWebhookUrl(req);
  // Nomor device untuk parameter update-device (wajib oleh Fonnte).
  const deviceNumber = formatFonntePhone(phone || store.customer_phone || "");
  const deviceName = `${store.store_name || "Toko"}-${(store.id || "").slice(0, 8)}`;

  // Belum punya device token: buat device baru khusus toko ini pakai nomor dari user.
  if (!token) {
    const rawPhone = phone || store.customer_phone || "";
    if (!rawPhone) {
      return NextResponse.json(
        { connected: false, error: "Masukkan nomor WhatsApp yang ingin dihubungkan terlebih dahulu." },
        { status: 400 }
      );
    }

    // Normalisasi ke format 62xxx supaya konsisten dengan field `device` yang
    // dikirim webhook Fonnte (dipakai untuk mencocokkan pesan masuk ke toko).
    const targetPhone = formatFonntePhone(rawPhone);
    const created = await createFonnteDevice(deviceName, targetPhone);
    if (!created.success || !created.token) {
      return NextResponse.json(
        { connected: false, error: created.error || "Gagal membuat device WhatsApp. Pastikan nomor belum dipakai device lain." },
        { status: 400 }
      );
    }

    token = created.token;
    await upsertStore({ email, fonnte_token: token, customer_phone: targetPhone });
  }

  // Set/sinkronkan URL webhook ke device secara OTOMATIS (idempoten): hanya
  // panggil update-device bila URL tujuan berubah dari yang tersimpan.
  if (deviceNumber.replace(/\D/g, "").length >= 10 && store.webhook_url !== desiredWebhook) {
    const hook = await setFonnteWebhook(token, deviceName, deviceNumber, desiredWebhook);
    if (hook.success) {
      await upsertStore({ email, webhook_url: desiredWebhook });
    } else {
      console.warn("[fonnte qr] gagal set webhook otomatis:", hook.error);
    }
  }

  const status = await getFonnteDeviceStatus(token);
  if (status.status) {
    return NextResponse.json({
      connected: true,
      message: "WhatsApp Device sudah TERHUBUNG! Tidak perlu scan QR lagi. 🎉"
    });
  }

  const qrResult = await getFonnteQRCode(token);
  if (!qrResult.success) {
    return NextResponse.json({
      connected: false,
      error: qrResult.error || "Gagal mengambil QR Code dari Fonnte."
    });
  }

  return NextResponse.json({
    connected: false,
    qrUrl: qrResult.qrUrl
  });
}
