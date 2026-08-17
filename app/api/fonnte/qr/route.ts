import { NextResponse } from "next/server";
import { getFonnteQRCode, getFonnteDeviceStatus, formatFonntePhone } from "@/lib/fonnte";
import {
  getStoreByEmail,
  listStoreDevicesCompat,
  updateStoreDevice,
  upsertStore
} from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";
import { buildFonnteWebhookUrl, resolveBaseUrl, syncDeviceWebhookUrl } from "@/lib/webhook-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ambil QR Code WhatsApp untuk salah satu nomor toko, untuk di-scan di Dashboard.
 *
 *   ?deviceId=<uuid>  → nomor tertentu (dipakai UI multi-nomor)
 *   ?phone=<nomor>    → cari berdasarkan nomor (kompatibilitas UI lama)
 *   tanpa keduanya    → nomor utama
 *
 * Endpoint ini TIDAK lagi membuat device. Pembuatan nomor hanya lewat
 * POST /api/fonnte/devices supaya batas paket (Starter 1 / Pro 3) ditegakkan di
 * satu tempat saja dan tidak bisa dilewati dari sini.
 */
export async function GET(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const deviceId = (searchParams.get("deviceId") || "").trim();
  const phone = (searchParams.get("phone") || "").trim();

  const store = await getStoreByEmail(email);
  if (!store) {
    return NextResponse.json({ error: "Toko tidak ditemukan untuk akun ini." }, { status: 404 });
  }

  const { devices } = await listStoreDevicesCompat(store);

  let device = deviceId ? devices.find((d) => d.id === deviceId) : undefined;
  if (!device && phone) {
    const want = formatFonntePhone(phone);
    device = devices.find((d) => formatFonntePhone(d.phone || "") === want);
  }
  if (!device && !deviceId && !phone) {
    device = devices.find((d) => d.is_primary) || devices[0];
  }

  if (!device) {
    return NextResponse.json(
      {
        connected: false,
        error: "Nomor belum terdaftar. Tambahkan nomor WhatsApp dulu, lalu scan QR-nya."
      },
      { status: 404 }
    );
  }

  if (!device.fonnte_token) {
    return NextResponse.json(
      {
        connected: false,
        error: "Nomor ini belum punya device Fonnte. Hapus nomornya lalu tambahkan ulang."
      },
      { status: 400 }
    );
  }

  const token = device.fonnte_token;

  // Sinkronkan URL webhook device secara OTOMATIS & idempoten: update-device hanya
  // dipanggil bila URL tujuan berbeda dari yang tersimpan.
  await syncDeviceWebhookUrl({
    store,
    device,
    desired: buildFonnteWebhookUrl(resolveBaseUrl(req))
  });

  const status = await getFonnteDeviceStatus(token);
  const nextStatus = status.status ? "CONNECTED" : "DISCONNECTED";
  if (nextStatus !== device.device_status) {
    if (device.id) await updateStoreDevice(device.id, { device_status: nextStatus });
    if (device.is_primary) await upsertStore({ email, fonnte_device_status: nextStatus });
  }

  if (status.status) {
    return NextResponse.json({
      connected: true,
      deviceId: device.id,
      phone: device.phone,
      message: "WhatsApp Device sudah TERHUBUNG! Tidak perlu scan QR lagi. 🎉"
    });
  }

  const qrResult = await getFonnteQRCode(token);
  if (!qrResult.success) {
    return NextResponse.json({
      connected: false,
      deviceId: device.id,
      phone: device.phone,
      error: qrResult.error || "Gagal mengambil QR Code dari Fonnte."
    });
  }

  return NextResponse.json({
    connected: false,
    deviceId: device.id,
    phone: device.phone,
    qrUrl: qrResult.qrUrl
  });
}
