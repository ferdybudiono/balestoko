import { NextResponse } from "next/server";
import { getFonnteQRCode, formatFonntePhone } from "@/lib/fonnte";
import {
  getStoreByEmail,
  listStoreDevicesCompat,
  updateStoreDevice,
  upsertStore
} from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";
import { buildFonnteWebhookUrl, reconcileDeviceInbound, resolveBaseUrl } from "@/lib/webhook-url";

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

  // Rekonsiliasi setelan penerimaan pesan (URL webhook + auto read) dengan
  // kondisi NYATA di Fonnte — sekaligus mengambil status koneksi, jadi tidak ada
  // tambahan panggilan API dibanding sebelumnya.
  //
  // Auto read wajib menyala: Fonnte tidak memanggil webhook pesan masuk tanpa
  // itu, dan device hasil add-device tidak menyalakannya sendiri. Inilah yang
  // membuat bot "sehat tapi bisu" — uji coba dari dashboard tetap berhasil
  // karena hanya memakai jalur KIRIM.
  const health = await reconcileDeviceInbound({
    store,
    device,
    desired: buildFonnteWebhookUrl(resolveBaseUrl(req))
  });

  const nextStatus = health.connected ? "CONNECTED" : "DISCONNECTED";
  if (nextStatus !== device.device_status) {
    if (device.id) await updateStoreDevice(device.id, { device_status: nextStatus });
    if (device.is_primary) await upsertStore({ email, fonnte_device_status: nextStatus });
  }

  // Kendala jalur terima tidak boleh menghalangi scan QR, tapi harus terlihat.
  const inboundWarning =
    health.error && !health.webhookSynced
      ? `Bot bisa terhubung, tapi jalur pesan masuk belum siap: ${health.error}`
      : undefined;

  if (health.connected) {
    return NextResponse.json({
      connected: true,
      deviceId: device.id,
      phone: device.phone,
      warning: inboundWarning,
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
    warning: inboundWarning,
    qrUrl: qrResult.qrUrl
  });
}
