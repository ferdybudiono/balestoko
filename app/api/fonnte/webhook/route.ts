import { NextResponse } from "next/server";
import {
  getStoreAndDeviceByPhone,
  getStoreAndDeviceByToken,
  isDeviceWithinPlanLimit,
  isStoreActive,
  updateStoreDevice,
  type StoreDeviceRecord,
  type StoreRecord
} from "@/lib/supabase";
import { checkConversationQuota, checkRateLimit, runAutoReply } from "@/lib/reply-engine";
import {
  buildFonnteWebhookUrl,
  isWebhookUrlSynced,
  resolveBaseUrl,
  syncDeviceWebhookUrl
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

/**
 * Catat bahwa pesan masuk TIBA untuk nomor ini, beserta apa yang terjadi padanya.
 *
 * Ini jejak diagnosa yang ditampilkan di tab WhatsApp. Tanpanya, "belum ada
 * pembeli yang chat" dan "chat pembeli tidak pernah sampai ke aplikasi" terlihat
 * sama persis dari dashboard — padahal yang kedua berarti bot mati.
 *
 * Kegagalan menulis di sini TIDAK boleh menggagalkan balasan: ini catatan, bukan
 * bagian dari pemrosesan pesan.
 */
async function noteInbound(device: StoreDeviceRecord, note: string): Promise<void> {
  if (!device.id) return;
  try {
    await updateStoreDevice(device.id, {
      last_inbound_at: new Date().toISOString(),
      last_inbound_note: note.slice(0, 120)
    });
  } catch (err) {
    console.warn("[fonnte webhook] gagal mencatat pesan masuk:", err);
  }
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
    const pre = await checkRateLimit(`unverified:${deviceNumber || "unknown"}`, sender);
    if (!pre.ok) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401, headers: { "Retry-After": String(pre.retryAfterSec) } }
      );
    }
  }

  try {
    // 1. Cari toko + DEVICE penerima berdasarkan nomor device (jalur utama).
    //    Device-nya penting, bukan hanya tokonya: balasan harus keluar dari
    //    nomor yang sama dengan yang dihubungi pembeli, dan satu toko kini bisa
    //    punya beberapa nomor (Starter 1, Pro 3).
    let match: { store: StoreRecord; device: StoreDeviceRecord } | null = deviceNumber
      ? await getStoreAndDeviceByPhone(deviceNumber)
      : null;
    if (!match) {
      const maybeToken = String(body.token || req.headers.get("authorization") || "");
      if (maybeToken) match = await getStoreAndDeviceByToken(maybeToken);
    }

    // Device tidak dikenal → abaikan. Jangan salah-arahkan pesan ke toko lain.
    if (!match) {
      console.warn(
        `[fonnte webhook] device tidak dikenal (device=${deviceNumber}), pesan diabaikan.`
      );
      return NextResponse.json({ status: "ignored", reason: "Unknown device" });
    }

    const { store, device } = match;
    const desiredWebhookUrl = buildFonnteWebhookUrl(resolveBaseUrl(req));

    if (!secretOk) {
      // Device yang tersambung SEBELUM secret diaktifkan menyimpan URL webhook
      // tanpa `?secret=` — dan device yang tersinkron dengan secret LAMA (setelah
      // rotasi) juga mustahil mengirim secret yang benar. Menolaknya berarti bot
      // toko itu mati tanpa jalan pulih sendiri — tab QR pun tidak muncul saat
      // status sudah terhubung. Jadi: terima sekali, perbaiki setelan device-nya,
      // dan setelah tersinkron pintu ini tertutup permanen.
      //
      // Perbandingan URL di `isWebhookUrlSynced` sengaja PERSIS (bukan "memuat
      // secret="): itu yang membuat rotasi secret ikut lewat jalur perbaikan ini
      // alih-alih mematikan bot selamanya.
      if (isWebhookUrlSynced(device, desiredWebhookUrl)) {
        console.warn(
          `[fonnte webhook] secret tidak valid untuk device ${deviceNumber} yang sudah tersinkron, request ditolak.`
        );
        await noteInbound(device, "Ditolak: secret webhook tidak cocok");
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }

      console.warn(
        `[fonnte webhook] device ${deviceNumber} belum memakai URL ber-secret yang berlaku — ` +
          "pesan diproses sekali sambil menyinkronkan setelan device."
      );
      const synced = await syncDeviceWebhookUrl({
        store,
        device,
        desired: desiredWebhookUrl
      });
      if (!synced.ok) {
        console.warn(
          "[fonnte webhook] sinkronisasi setelan gagal:",
          synced.error,
          "— buka tab WhatsApp di dashboard toko tersebut untuk memperbaiki."
        );
      }
    }

    // Toko nonaktif (trial habis & belum bayar) → jangan proses AI (cegah pemakaian gratis).
    if (!isStoreActive(store)) {
      console.warn("[fonnte webhook] toko nonaktif / trial berakhir, pesan diabaikan.");
      await noteInbound(device, "Diabaikan: masa aktif toko berakhir");
      return NextResponse.json({ status: "ignored", reason: "Store inactive or trial expired" });
    }

    // Nomor di luar kuota paket (mis. sisa 3 nomor dari masa trial, tapi sekarang
    // berlangganan Starter yang hanya 1 nomor). Dashboard menandai nomor mana yang
    // tidak dilayani, jadi ini bukan kematian senyap.
    if (!(await isDeviceWithinPlanLimit(store, device))) {
      console.warn(
        `[fonnte webhook] device ${deviceNumber} di luar kuota paket toko, pesan diabaikan.`
      );
      await noteInbound(device, "Diabaikan: nomor di luar kuota paket");
      return NextResponse.json({ status: "ignored", reason: "Device over plan limit" });
    }

    // Kuota percakapan bulanan paket (Starter 1.000/bulan, Pro tanpa batas).
    // Diperiksa SEBELUM Gemini dipanggil karena di sinilah biayanya muncul.
    const quota = await checkConversationQuota(store, sender);
    if (!quota.ok) {
      console.warn(
        `[fonnte webhook] kuota percakapan bulanan toko habis (${quota.used}/${quota.limit}), ` +
          `pesan dari ${sender} diabaikan.`
      );
      await noteInbound(device, `Diabaikan: kuota percakapan bulanan habis (${quota.used}/${quota.limit})`);
      return NextResponse.json({ status: "ignored", reason: "Monthly conversation quota exceeded" });
    }

    // Bendung banjir pesan dari satu nomor (termasuk loop balasan antar-bot).
    // Dibatasi per-device: tiap nomor toko adalah kanal terpisah, jadi pembeli
    // yang ramai di satu nomor tidak ikut memblokir nomor lainnya.
    const rate = await checkRateLimit(device.id || store.id || deviceNumber, sender);
    if (!rate.ok) {
      console.warn(`[fonnte webhook] batas laju tercapai untuk ${sender}, pesan diabaikan.`);
      await noteInbound(device, "Diabaikan: terlalu banyak pesan dari satu nomor (batas laju)");
      return NextResponse.json(
        { status: "ignored", reason: "Rate limited" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    const outcome = await runAutoReply({
      store,
      sender,
      messageText,
      deviceToken: device.fonnte_token,
      // Device penerima ikut dikirim: katalog yang dijawab nomor ini bisa
      // dipersempit pemilik toko, dan pesanan dicatat atas nama nomor tersebut.
      device
    });

    await noteInbound(
      device,
      outcome.delivered
        ? "Dibalas AI"
        : `Balasan gagal dikirim: ${outcome.deliveryError || "penyebab tidak diketahui"}`
    );

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
