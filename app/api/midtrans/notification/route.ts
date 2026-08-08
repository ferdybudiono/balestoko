import { NextResponse } from "next/server";
import {
  verifyNotificationSignature,
  mapMidtransStatus,
} from "@/lib/midtrans";
import { updateOrderStatus } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook Payment Notification dari Midtrans.
 *
 * Set URL ini di Midtrans Dashboard:
 *   Settings -> Configuration -> Payment Notification URL
 *   => https://DOMAIN-ANDA/api/midtrans/notification
 *
 * Midtrans mengirim POST JSON setiap kali status transaksi berubah.
 */
export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = String(payload.order_id ?? "");
  const statusCode = String(payload.status_code ?? "");
  const grossAmount = String(payload.gross_amount ?? "");
  const signatureKey = String(payload.signature_key ?? "");
  const transactionStatus = String(payload.transaction_status ?? "");
  const fraudStatus = payload.fraud_status
    ? String(payload.fraud_status)
    : undefined;

  if (!orderId) {
    return NextResponse.json({ error: "order_id kosong" }, { status: 400 });
  }

  // ---- Verifikasi keaslian notifikasi ----
  let valid = false;
  try {
    valid = verifyNotificationSignature({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
    });
  } catch (err) {
    // Umumnya karena MIDTRANS_SERVER_KEY belum di-set di server.
    console.error("[webhook] gagal verifikasi signature:", err);
    return NextResponse.json(
      { error: "Konfigurasi server belum lengkap" },
      { status: 500 }
    );
  }

  if (!valid) {
    console.warn("[webhook] signature tidak valid untuk order:", orderId);
    return NextResponse.json(
      { error: "Signature tidak valid" },
      { status: 403 }
    );
  }

  const internalStatus = mapMidtransStatus(transactionStatus, fraudStatus);

  await updateOrderStatus(orderId, internalStatus, payload);

  console.log(
    "[webhook] order %s -> %s (%s)",
    orderId,
    internalStatus,
    transactionStatus
  );

  // Midtrans hanya butuh HTTP 200 sebagai tanda notifikasi diterima.
  return NextResponse.json({ received: true, status: internalStatus });
}
