import { NextResponse } from "next/server";
import { getFonnteQRCode, getFonnteDeviceStatus, createFonnteDevice } from "@/lib/fonnte";
import { getStoreByEmail, upsertStore } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fetch WhatsApp QR Code directly for scanning inside SaaS Dashboard
 * Automatically registers device using SaaS Owner's Fonnte Account Token if needed
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email") || "demo@balestoko.com";
  let token = searchParams.get("token") || "";

  // 1. Ambil data toko dari Supabase jika token belum ada
  let store = await getStoreByEmail(email);
  if (store && store.fonnte_token) {
    token = store.fonnte_token;
  }

  // 2. Jika toko belum punya device token khusus, buat device otomatis via Account Token Fonnte
  if (!token) {
    const storeName = store?.store_name || "Toko SaaS";
    const deviceCreated = await createFonnteDevice(storeName);
    if (deviceCreated.token) {
      token = deviceCreated.token;
      // Simpan device token baru ke Supabase untuk toko ini
      await upsertStore({ email, fonnte_token: token });
    }
  }

  const activeToken = token || process.env.FONNTE_TOKEN || "";
  if (!activeToken) {
    return NextResponse.json({ error: "Fonnte Account Token (FONNTE_TOKEN) belum di-set di ENV." }, { status: 400 });
  }

  const status = await getFonnteDeviceStatus(activeToken);
  if (status.status) {
    return NextResponse.json({
      connected: true,
      message: "WhatsApp Device sudah TERHUBUNG! Tidak perlu scan QR lagi. 🎉"
    });
  }

  const qrResult = await getFonnteQRCode(activeToken);
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
