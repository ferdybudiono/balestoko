import crypto from "crypto";
import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pemeriksaan kesehatan untuk OPERATOR aplikasi — bukan untuk pemilik toko.
 *
 *   GET /api/health/db?secret=…            (atau header Authorization: Bearer …)
 *
 * Yang dijawabnya adalah pertanyaan yang selama ini hanya bisa dijawab dengan
 * membuka SQL editor Supabase: apakah keempat RPC di `supabase/schema.sql`
 * benar-benar ada di database yang sedang dipakai, dan apakah pembatas laju
 * benar-benar ditegakkan. Tiga dari empat RPC itu punya jalur cadangan yang
 * bekerja tanpa suara, jadi hilangnya mereka tidak menimbulkan gejala apa pun —
 * dan `bump_rate_limit` yang hilang berarti penebakan kata sandi tanpa batas.
 *
 * Sekaligus melaporkan environment variable mana yang belum diisi. Yang
 * dilaporkan HANYA "set" atau "missing": nilainya tidak pernah dikembalikan,
 * karena respons ini bisa masuk log, screenshot, atau tiket dukungan.
 */

/** Sama seperti `/api/cron/reminders`: satu-satunya pembanding yang konstan-waktu. */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Wewenang pemanggil — gagal-TERTUTUP, mengikuti `/api/cron/reminders`.
 *
 * Memakai `CRON_SECRET` yang sudah ada, bukan variabel baru: satu rahasia
 * operator lebih sedikit untuk lupa diisi, dan endpoint ini tidak boleh terbuka
 * walaupun isinya "cuma" status. Daftar RPC yang hilang dan env yang belum diisi
 * adalah peta persis mana pengamanan yang sedang tidak aktif.
 */
function authorize(req: Request): NextResponse | null {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET belum diisi di environment. Endpoint ini melaporkan " +
          "pengamanan mana yang sedang tidak aktif, jadi ia menolak semua " +
          "request sampai secret-nya dipasang."
      },
      { status: 503 }
    );
  }

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const query = (new URL(req.url).searchParams.get("secret") || "").trim();
  const given = bearer || query;

  if (!given || !timingSafeEqual(expected, given)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }
  return null;
}

/** Hanya "set"/"missing" — nilai rahasianya tidak pernah ikut. */
function envStatus(name: string): "set" | "missing" {
  return (process.env[name] || "").trim() ? "set" : "missing";
}

export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  const db = await checkDatabaseHealth();

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: envStatus("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: envStatus("SUPABASE_SERVICE_ROLE_KEY"),
    AUTH_SECRET: envStatus("AUTH_SECRET"),
    FONNTE_TOKEN: envStatus("FONNTE_TOKEN"),
    FONNTE_WEBHOOK_SECRET: envStatus("FONNTE_WEBHOOK_SECRET"),
    GEMINI_API_KEY: envStatus("GEMINI_API_KEY"),
    MIDTRANS_SERVER_KEY: envStatus("MIDTRANS_SERVER_KEY"),
    NEXT_PUBLIC_BASE_URL: envStatus("NEXT_PUBLIC_BASE_URL")
  };

  const problems = [...db.problems];

  // Dua env yang hilangnya BUKAN sekadar fitur mati, tapi pengamanan yang lepas.
  if (env.AUTH_SECRET === "missing") {
    problems.push(
      "AUTH_SECRET belum diisi — TIDAK ADA sesi yang bisa diterbitkan maupun diverifikasi: " +
        "login gagal dan seluruh akses dashboard dialihkan ke /login. Isi variabel ini " +
        "(mis. `openssl rand -hex 32`) lalu deploy ulang; sesi yang sedang berjalan " +
        "akan logout satu kali."
    );
  }
  if (env.FONNTE_WEBHOOK_SECRET === "missing") {
    problems.push(
      "FONNTE_WEBHOOK_SECRET belum diisi — webhook WhatsApp MENOLAK semua pesan masuk " +
        "(503), jadi bot tidak membalas satu pun pembeli. Isi variabel ini, lalu buka " +
        "tab WhatsApp di dashboard tiap toko agar URL webhook device tersinkron."
    );
  }
  if (env.NEXT_PUBLIC_BASE_URL === "missing") {
    problems.push(
      "NEXT_PUBLIC_BASE_URL belum diisi — URL OG/canonical akan menunjuk localhost."
    );
  }

  return NextResponse.json(
    {
      ok: problems.length === 0,
      checked_at: new Date().toISOString(),
      database: {
        configured: db.configured,
        rate_limit_enforced: db.rateLimitEnforced,
        rpc: db.rpc
      },
      env,
      problems
    },
    // Sengaja 200 walau ada masalah: pemanggilnya membaca `ok`/`problems`, dan
    // status non-2xx akan membuat uptime monitor menganggap aplikasinya mati
    // padahal yang dilaporkan justru berhasil dibaca.
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
