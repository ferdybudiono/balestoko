import { NextResponse } from "next/server";
import { getFonnteQRCode, getFonnteDeviceStatus, createFonnteDevice } from "@/lib/fonnte";
import { getStoreByEmail, upsertStore } from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Belum punya device token: buat device baru khusus toko ini pakai nomor dari user.
  if (!token) {
    const targetPhone = phone || store.customer_phone || "";
    if (!targetPhone) {
      return NextResponse.json(
        { connected: false, error: "Masukkan nomor WhatsApp yang ingin dihubungkan terlebih dahulu." },
        { status: 400 }
      );
    }

    const deviceName = `${store.store_name || "Toko"}-${(store.id || "").slice(0, 8)}`;
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
