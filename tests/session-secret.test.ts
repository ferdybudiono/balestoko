import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSessionSecret } from "../lib/session-constants";

/**
 * Kunci penanda tangan sesi berasal dari SATU variabel: `AUTH_SECRET`.
 *
 * KENAPA TES INI ADA: sebelumnya fungsinya berbunyi
 * `process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || undefined`.
 * Cadangan itu membuat satu rahasia memikul dua tujuan — tanda tangan sesi DAN
 * akses penuh database — sehingga bocornya salah satu berarti bocornya keduanya,
 * dan merotasi kunci database (tindakan yang justru dilakukan saat curiga bocor)
 * ikut melogout seluruh pengguna tanpa sebab yang terlihat.
 *
 * Mengembalikan cadangan itu adalah perubahan satu baris yang TIDAK menimbulkan
 * satu pun gejala: semua tes lain tetap hijau, login tetap jalan, dan tidak ada
 * yang tampak salah sampai kunci databasenya dirotasi. Itu sebabnya ia dijaga di
 * sini, bukan hanya di docblock.
 *
 * `undefined` = tidak ada rahasia. Pemanggil yang memutuskan artinya, dan
 * keduanya gagal-TERTUTUP: `lib/auth.ts` melempar di produksi, `middleware.ts`
 * mengalihkan ke `/login`.
 */

const KEYS = ["AUTH_SECRET", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveSessionSecret", () => {
  it("memakai AUTH_SECRET bila diisi", () => {
    process.env.AUTH_SECRET = "kunci-sesi-uji-32-karakter-atau-lebih";
    expect(resolveSessionSecret()).toBe("kunci-sesi-uji-32-karakter-atau-lebih");
  });

  it("TIDAK jatuh ke SUPABASE_SERVICE_ROLE_KEY", () => {
    // Inti tes ini. Kunci database ada, kunci sesi tidak → tidak ada sesi.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-yang-tidak-boleh-dipakai";
    expect(resolveSessionSecret()).toBeUndefined();
  });

  it("mengembalikan undefined bila keduanya kosong", () => {
    expect(resolveSessionSecret()).toBeUndefined();
  });

  it("AUTH_SECRET tetap dipakai walau kunci database juga ada", () => {
    process.env.AUTH_SECRET = "kunci-sesi";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    expect(resolveSessionSecret()).toBe("kunci-sesi");
  });

  it("nilai kosong dianggap BELUM diisi", () => {
    // `.env.example` memuat baris `AUTH_SECRET=` tanpa nilai; deployment yang
    // menyalinnya apa adanya harus ditolak, bukan menandatangani dengan "".
    process.env.AUTH_SECRET = "";
    expect(resolveSessionSecret()).toBeUndefined();
    process.env.AUTH_SECRET = "   ";
    expect(resolveSessionSecret()).toBeUndefined();
  });

  it("spasi di ujung dipangkas", () => {
    // Tanpa ini, "abc" dan "abc\n" adalah dua kunci berbeda: membetulkan nilai
    // yang ter-paste dengan newline akan membatalkan semua sesi yang berjalan.
    process.env.AUTH_SECRET = "  kunci-sesi\n";
    expect(resolveSessionSecret()).toBe("kunci-sesi");
  });
});
