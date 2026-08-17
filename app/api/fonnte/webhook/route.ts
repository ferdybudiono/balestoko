import { NextResponse } from "next/server";
import { getStoreByFonnteToken, getStoreByDevicePhone, isStoreActive } from "@/lib/supabase";
import { checkRateLimit, runAutoReply } from "@/lib/reply-engine";
import {
  buildFonnteWebhookUrl,
  isWebhookUrlSynced,
  resolveBaseUrl,
  syncStoreWebhookUrl
} from "@/lib/webhook-url";

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
 * Set `FONNTE_WEBHOOK_SECRET` di environment; URL webhook device disinkronkan
 * otomatis dengan `?secret=...`. Selama variabel itu belum diisi, request tetap
 * diterima (agar deployment lama tidak mati) namun dicatat sebagai peringatan.
 */
function verifyWebhookSecret(req: Request, body: Record<string, unknown>): boolean {
  const expected = process.env.FONNTE_WEBHOOK_SECRET;
  if (!expected) {
    console.warn(
      "[fonnte webhook] FONNTE_WEBHOOK_SECRET belum diatur — endpoint ini TERBUKA. " +
        "Isi variabel tersebut lalu buka tab WhatsApp di dashboard agar URL device tersinkron."
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

  // Parameter payload Fonnte
  const sender = String(body.sender || body.from || body.phone || "");
  const messageText = String(body.message || body.text || "");
  // `device` = NOMOR device penerima (payload webhook Fonnte TIDAK memuat token).
  const deviceNumber = String(body.device || "");

  // Abaikan event status / pesan kosong / pesan broadcast keluar
  if (!sender || !messageText || messageText.trim() === "") {
    return NextResponse.json({ status: "ignored", reason: "Message or sender empty" });
  }

  const secretOk = verifyWebhookSecret(req, body);

  // Secret salah/absen: bendung banjir SEBELUM menyentuh database, karena di
  // bawah kita masih perlu satu lookup untuk membedakan device lama yang URL-nya
  // belum tersinkron dari penyerang.
  if (!secretOk) {
    const pre = checkRateLimit(`unverified:${deviceNumber || "unknown"}`, sender);
    if (!pre.ok) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401, headers: { "Retry-After": String(pre.retryAfterSec) } }
      );
    }
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

    if (!secretOk) {
      // Device yang tersambung SEBELUM secret diaktifkan menyimpan URL webhook
      // tanpa `?secret=`, jadi ia mustahil mengirim secret yang benar. Menolaknya
      // berarti bot toko itu mati tanpa jalan pulih sendiri — tab QR pun tidak
      // muncul saat status sudah terhubung. Jadi: terima sekali, perbaiki URL
      // device-nya, dan setelah tersinkron pintu ini tertutup permanen.
      if (isWebhookUrlSynced(store)) {
        console.warn(
          `[fonnte webhook] secret tidak valid untuk device ${deviceNumber} yang sudah tersinkron, request ditolak.`
        );
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }

      console.warn(
        `[fonnte webhook] device ${deviceNumber} belum memakai URL ber-secret — ` +
          "pesan diproses sekali sambil menyinkronkan URL webhook device."
      );
      const synced = await syncStoreWebhookUrl(store, buildFonnteWebhookUrl(resolveBaseUrl(req)));
      if (!synced) {
        console.warn(
          "[fonnte webhook] sinkronisasi URL gagal; buka tab WhatsApp di dashboard toko tersebut untuk memperbaiki."
        );
      }
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
