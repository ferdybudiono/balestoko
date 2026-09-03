import crypto from "crypto";
import { NextResponse } from "next/server";
import { expiryReminderWindow, notifyExpiryReminder } from "@/lib/notify";
import { listStoresNearExpiry } from "@/lib/supabase";
import { resolveBaseUrl } from "@/lib/webhook-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Satu putaran mengirim beberapa WhatsApp berurutan. Batas bawaan Vercel (10s)
// terlalu pendek begitu ada belasan toko yang jatuh tempo di hari yang sama.
export const maxDuration = 60;

/**
 * Pengingat masa aktif — dipanggil sekali sehari oleh Vercel Cron.
 *
 * Jadwalnya di `vercel.json` (02:00 UTC = 09:00 WIB, jam yang wajar untuk pesan ke
 * pemilik toko; paket Hobby Vercel juga hanya mengizinkan satu eksekusi per hari).
 *
 * Yang dipecahkan: masa uji coba 7 hari dan langganan 30 hari sebelumnya berakhir
 * tanpa satu pesan pun. Pemilik toko baru sadar botnya berhenti dari keluhan
 * pembeli — kebocoran pendapatan yang paling mudah ditutup di aplikasi ini.
 *
 * Seluruh keputusan "kirim atau tidak" ada di `notifyExpiryReminder`; route ini
 * hanya mengurus wewenang, mengambil kandidat, dan melaporkan hasil.
 *
 *   GET/POST /api/cron/reminders                 (header Authorization: Bearer …)
 *   GET      /api/cron/reminders?secret=…        (pemicu manual saat menguji)
 *   GET      /api/cron/reminders?secret=…&dry=1  (hitung saja, tidak mengirim)
 */

/** Jumlah pengiriman paralel. Cukup untuk mempercepat, tanpa membanjiri Fonnte. */
const CONCURRENCY = 4;

/** Batas atas satu putaran — penjaga kalau suatu hari datanya melonjak. */
const MAX_STORES_PER_RUN = 300;

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Wewenang pemanggil.
 *
 * SAMA seperti `FONNTE_WEBHOOK_SECRET`: tanpa `CRON_SECRET` route ini menolak
 * SEMUA request. Setiap panggilan mengirim WhatsApp berbayar ke daftar pemilik
 * toko, jadi endpoint terbuka sama dengan tombol spam bagi siapa pun yang menebak
 * URL-nya. Lebih baik pengingatnya belum jalan daripada bisa dipicu orang lain.
 */
function authorize(req: Request): NextResponse | null {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    console.error("[cron] CRON_SECRET belum diisi — pengingat masa aktif tidak dijalankan.");
    return NextResponse.json(
      {
        error:
          "CRON_SECRET belum diisi di environment. Endpoint ini mengirim WhatsApp, " +
          "jadi ia menolak semua request sampai secret-nya dipasang."
      },
      { status: 503 }
    );
  }

  // Vercel Cron mengirimkan header ini otomatis dari `CRON_SECRET`.
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const query = (new URL(req.url).searchParams.get("secret") || "").trim();
  const given = bearer || query;

  if (!given || !timingSafeEqual(expected, given)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }
  return null;
}

async function handle(req: Request): Promise<NextResponse> {
  const denied = authorize(req);
  if (denied) return denied;

  const dry = ["1", "true", "yes"].includes(
    (new URL(req.url).searchParams.get("dry") || "").toLowerCase()
  );

  const nowMs = Date.now();
  const { fromIso, toIso } = expiryReminderWindow(nowMs);
  const found = await listStoresNearExpiry({ fromIso, toIso, limit: MAX_STORES_PER_RUN });

  if (!found.ok) {
    if (found.needsMigration) {
      console.error("[cron] kolom pengingat belum ada:", found.error);
      return NextResponse.json(
        {
          error:
            "Kolom `last_expiry_alert_days` / `last_expiry_alert_at` belum ada di tabel " +
            "`stores`. Jalankan ulang supabase/schema.sql di SQL Editor Supabase lalu coba lagi."
        },
        { status: 409 }
      );
    }
    console.error("[cron] gagal membaca kandidat pengingat:", found.error);
    return NextResponse.json({ error: "Gagal membaca data toko." }, { status: 500 });
  }

  const stores = found.stores;
  const baseUrl = resolveBaseUrl(req);
  let due = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let noteFailed = 0;
  const planned: Array<{ email: string; kind: string; step: number }> = [];

  for (let i = 0; i < stores.length; i += CONCURRENCY) {
    const chunk = stores.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map((store) =>
        notifyExpiryReminder({ store, baseUrl, nowMs, dryRun: dry }).catch((err) => {
          console.warn("[cron] pengingat gagal untuk", store.email, String(err));
          return null;
        })
      )
    );

    outcomes.forEach((outcome, idx) => {
      // `step === null` = belum waktunya, atau ambangnya sudah pernah dikabari.
      if (!outcome || outcome.step === null) {
        skipped += 1;
        return;
      }

      due += 1;
      planned.push({
        email: chunk[idx].email,
        kind: outcome.kind || "trial",
        step: outcome.step
      });

      // Di mode kering tidak ada yang dikirim maupun dicatat, jadi hitungannya
      // berhenti di `due` supaya angka "gagal" tidak menyesatkan.
      if (dry) return;
      if (outcome.sent) sent += 1;
      else failed += 1;
      if (!outcome.noted) noteFailed += 1;
    });
  }

  console.info(
    `[cron] pengingat masa aktif: ${stores.length} kandidat, ${due} jatuh tempo, ` +
      `${sent} terkirim, ${failed} gagal, ${skipped} dilewati${dry ? " (mode kering)" : ""}.`
  );

  if (noteFailed > 0) {
    // Penanda anti-ulang gagal ditulis → putaran besok akan mengirim pesan yang
    // sama. Disuarakan, bukan ditelan.
    console.error(`[cron] ${noteFailed} penanda anti-ulang GAGAL ditulis.`);
  }

  return NextResponse.json({
    success: true,
    dry,
    checked: stores.length,
    due,
    sent,
    failed,
    skipped,
    noteFailed,
    // Hanya di mode kering: berisi email pemilik toko, dan yang bisa memanggil
    // endpoint ini sudah memegang CRON_SECRET.
    ...(dry ? { planned } : {})
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
