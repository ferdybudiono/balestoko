import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/fonnte/webhook/route";

/**
 * Webhook Fonnte harus gagal-TERTUTUP saat `FONNTE_WEBHOOK_SECRET` belum diisi.
 *
 * KENAPA TES INI ADA: sebelumnya `verifyWebhookSecret` menjawab `true` begitu
 * variabelnya kosong — satu `console.warn` di log, lalu request diteruskan. Endpoint
 * ini menerima trafik dari internet publik dan setiap pemanggilan yang lolos memicu
 * satu panggilan Gemini PLUS satu kirim WhatsApp berbayar dari device toko itu
 * sendiri. Nomor device bukan rahasia — justru nomor yang diiklankan toko.
 *
 * Gerbang di belakangnya (`isStoreActive`, batas device, kuota, batas laju) hanya
 * membatasi kerusakan, tidak mencegahnya: kunci batas lajunya memuat nomor pengirim
 * yang dikendalikan pemanggil, jadi memutar-mutar nomor melewati batasnya.
 *
 * Yang dijaga: env kosong = 503 untuk SEMUA request, dan gerbangnya ditentukan oleh
 * environment — bukan oleh nilai yang dikirim pemanggil. Ini regresi satu baris yang
 * tidak punya gejala apa pun sampai tagihannya datang.
 */

/** Payload webhook Fonnte yang bentuknya sah — supaya 503-nya bukan efek body cacat. */
const PAYLOAD = { sender: "628111111111", message: "ongkir ke Makassar?", device: "628222222222" };

function post(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const ENV_KEYS = [
  "FONNTE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Supabase sengaja dibiarkan tak terkonfigurasi: `getConfig()` mengembalikan
  // `null`, jadi tidak ada satu pun query yang keluar dari mesin ini. Tesnya soal
  // gerbang secret, bukan soal database.
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("POST /api/fonnte/webhook — secret belum diisi", () => {
  it("menolak 503 walau payloadnya sah", async () => {
    const res = await POST(post("https://toko.example/api/fonnte/webhook", PAYLOAD));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: string };
    // Pesannya untuk operator, bukan untuk pemanggil publik: ia harus menyebut
    // variabel yang perlu diisi, kalau tidak 503-nya jadi misteri.
    expect(json.error).toContain("FONNTE_WEBHOOK_SECRET");
  });

  it("tetap 503 walau pemanggil menyertakan secret sendiri", async () => {
    // Jalur yang paling mudah lolos kalau gerbangnya salah pasang: nilai apa pun
    // dari pemanggil TIDAK boleh menjadi pembanding saat env-nya kosong.
    const res = await POST(
      post("https://toko.example/api/fonnte/webhook?secret=apa-saja", {
        ...PAYLOAD,
        secret: "apa-saja"
      })
    );
    expect(res.status).toBe(503);
  });

  it("tetap 503 untuk event status tanpa pesan", async () => {
    // Bukan sekadar kerapian: kalau cabang "abaikan pesan kosong" berjalan lebih
    // dulu, deployment yang salah setel terlihat sehat di log pengiriman Fonnte.
    const res = await POST(post("https://toko.example/api/fonnte/webhook", { device: "628222222222" }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/fonnte/webhook — secret sudah diisi", () => {
  const SECRET = "rahasia-uji-32-karakter-atau-lebih";

  beforeEach(() => {
    process.env.FONNTE_WEBHOOK_SECRET = SECRET;
  });

  it("secret yang benar lolos gerbang (bukan 503, bukan 401)", async () => {
    const res = await POST(
      post(`https://toko.example/api/fonnte/webhook?secret=${encodeURIComponent(SECRET)}`, PAYLOAD)
    );
    expect(res.status).not.toBe(503);
    expect(res.status).not.toBe(401);
    // Tanpa database, pencarian device berhenti di "device tidak dikenal" — dan
    // itu memang bukti bahwa gerbangnya terbuka: eksekusinya sampai ke lookup.
    const json = (await res.json()) as { status?: string; reason?: string };
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("Unknown device");
  });

  it("secret lewat header juga diterima", async () => {
    // Header dipertahankan supaya pemanggil yang bisa mengirimnya tidak perlu
    // menaruh secret di query string, yang ikut tercatat di access log.
    const res = await POST(
      new Request("https://toko.example/api/fonnte/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
        body: JSON.stringify(PAYLOAD)
      })
    );
    expect(res.status).not.toBe(503);
    expect(res.status).not.toBe(401);
  });

  it("secret yang salah tidak pernah dijawab 503", async () => {
    // 503 berarti "deployment belum siap" dan akan menyesatkan operator yang
    // sedang mencari sebab bot diam; secret salah adalah masalah pemanggil.
    const res = await POST(post("https://toko.example/api/fonnte/webhook?secret=salah", PAYLOAD));
    expect(res.status).not.toBe(503);
    expect(res.status).toBeLessThan(500);
  });
});
