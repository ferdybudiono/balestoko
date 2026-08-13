import { NextResponse } from "next/server";
import { getFonnteQRCode, getFonnteDeviceStatus } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fetch WhatsApp QR Code directly for scanning inside SaaS Dashboard
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token") || process.env.FONNTE_TOKEN || "";

  if (!token) {
    return NextResponse.json({ error: "Token Fonnte belum di-set." }, { status: 400 });
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
