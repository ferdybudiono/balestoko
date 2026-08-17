import { NextResponse } from "next/server";
import { getStoreByFonnteToken, getStoreByDevicePhone, isStoreActive } from "@/lib/supabase";
import { checkRateLimit, runAutoReply } from "@/lib/reply-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Penerima webhook Fonnte.
 * URL untuk dashboard Fonnte: https://DOMAIN-ANDA/api/fonnte/webhook?secret=XXX
 *
 * KEAMANAN — endpoint ini menerima pesan dari internet publik dan setiap
 * pemanggilan memicu Gemini + pengiriman WhatsApp berbayar ke nomor yang ada
 * di payload. Tanpa verifikasi, siapa pun yang tahu nomor device sebuah toko
 * bisa memakainya sebagai relay spam.
 *
 * Set `FONNTE_WEBHOOK_SECRET` di environment, lalu tambahkan `?secret=NILAI`
 * pada URL webhook di dashboard Fonnte. Selama variabel itu belum diisi,
 * request tetap diterima (agar deployment lama tidak mati) namun dicatat
 * sebagai peringatan di log.
 */
function verifyWebhookSecret(req: Request, body: Record<string, unknown>): boolean {
  const expected = process.env.FONNTE_WEBHOOK_SECRET;
  if (!expected) {
    console.warn(
      "[fonnte webhook] FONNTE_WEBHOOK_SECRET belum diatur — endpoint ini TERBUKA. " +
        "Isi variabel tersebut lalu tambahkan ?secret=... pada URL webhook di dashboard Fonnte."
    );
    return true;
  }
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") ||
    req.headers.get("x-webhook-secret") ||
    String(body.secret || "");
  return provided === expected;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      body = (await req.json()) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  if (!verifyWebhookSecret(req, body)) {
    console.warn("[fonnte webhook] secret tidak valid, request ditolak.");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Parameter payload Fonnte
  const sender = String(body.sender || body.from || body.phone || "");
  const messageText = String(body.message || body.text || "");
  // `device` = NOMOR device penerima (payload webhook Fonnte TIDAK memuat token).
  const deviceNumber = String(body.device || "");

  // Abaikan event status / pesan kosong / pesan broadcast keluar
  if (!sender || !messageText || messageText.trim() === "") {
    return NextResponse.json({ status: "ignored", reason: "Message or sender empty" });
  }

  try {
    // 1. Cari toko berdasarkan NOMOR device penerima (utama). Fallback ke token
    //    bila suatu konfigurasi mengirimkannya via body/header.
    let store = deviceNumber ? await getStoreByDevicePhone(deviceNumber) : null;
    if (!store) {
      const maybeToken = String(body.token || req.headers.get("authorization") || "");
      if (maybeToken) store = await getStoreByFonnteToken(maybeToken);
    }

    // Device tidak dikenal → abaikan. Jangan salah-arahkan pesan ke toko lain.
    if (!store) {
      console.warn(
        `[fonnte webhook] device tidak dikenal (device=${deviceNumber}), pesan diabaikan.`
      );
      return NextResponse.json({ status: "ignored", reason: "Unknown device" });
    }

    // Toko nonaktif (trial habis & belum bayar) → jangan proses AI (cegah pemakaian gratis).
    if (!isStoreActive(store)) {
      console.warn("[fonnte webhook] toko nonaktif / trial berakhir, pesan diabaikan.");
      return NextResponse.json({ status: "ignored", reason: "Store inactive or trial expired" });
    }

    // Bendung banjir pesan dari satu nomor (termasuk loop balasan antar-bot).
    const rate = checkRateLimit(store.id || deviceNumber, sender);
    if (!rate.ok) {
      console.warn(`[fonnte webhook] batas laju tercapai untuk ${sender}, pesan diabaikan.`);
      return NextResponse.json(
        { status: "ignored", reason: "Rate limited" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    const outcome = await runAutoReply({ store, sender, messageText });

    return NextResponse.json({
      success: true,
      sender,
      intent: outcome.intent,
      reply: outcome.replyText,
      delivered: outcome.delivered
    });
  } catch (err) {
    console.error("[fonnte webhook error]:", err);
    // Jangan bocorkan detail internal ke pemanggil publik.
    return NextResponse.json({ error: "Gagal memproses pesan." }, { status: 500 });
  }
}
