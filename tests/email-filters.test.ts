import { describe, expect, it } from "vitest";
import { emailFilters, normalizeEmail } from "../lib/supabase";

/**
 * Filter pencarian email — satu-satunya tempat di aplikasi ini yang menyusun
 * pola `ilike` PostgREST dari input yang dikirim pengguna.
 *
 * KENAPA TES INI ADA: escape wildcard-nya pernah tidak berfungsi sama sekali.
 * `clean.replace(/([\%_])/g, "\$1")` terlihat benar dan lolos typecheck, lint,
 * maupun build — tapi `"\$1"` di JavaScript sama dengan `"$1"`, yaitu rujukan ke
 * capture group, sehingga `%` diganti `%` dan `_` diganti `_`. Barisnya tidak
 * melakukan apa pun, dan tidak ada satu pun gejala yang terlihat dari luar.
 *
 * Karena itu yang diuji di bawah bukan cuma bentuk stringnya, tapi ARTINYA
 * sebagai pola ILIKE: satu alamat yang TIDAK terdaftar tidak boleh mencocoki
 * baris alamat yang terdaftar. Itu properti yang sesungguhnya dipertaruhkan —
 * `auth/reset/request` mengirim OTP sungguhan ke WhatsApp pemilik yang cocok,
 * dan `checkout` menolak pelanggan baru dengan 409 "sudah terdaftar" bila pola
 * ini mengenai baris orang lain.
 */

/** Semantik `ILIKE` PostgreSQL: `%` = apa saja, `_` = satu karakter, `\` = escape. */
function ilikeToRegExp(pattern: string): RegExp {
  const quote = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
      out += i < pattern.length ? quote(pattern[i]) : "\\\\";
    } else if (ch === "%") {
      out += ".*";
    } else if (ch === "_") {
      out += ".";
    } else {
      out += quote(ch);
    }
  }
  return new RegExp(`^${out}$`, "i");
}

/** Pola mentah di balik `column=ilike.<pola>`, sudah dikembalikan dari bentuk URL. */
function ilikePattern(filters: string[]): string | null {
  const found = filters.find((f) => f.includes("=ilike."));
  if (!found) return null;
  return decodeURIComponent(found.slice(found.indexOf("=ilike.") + "=ilike.".length));
}

describe("emailFilters — bentuk filter", () => {
  it("mengembalikan eq. lebih dulu, lalu ilike.", () => {
    const filters = emailFilters("email", "budi@gmail.com");
    expect(filters).toHaveLength(2);
    expect(filters[0]).toBe("email=eq.budi%40gmail.com");
    expect(filters[1]).toBe("email=ilike.budi%40gmail.com");
  });

  it("menormalkan email lebih dulu (spasi & huruf besar)", () => {
    expect(normalizeEmail("  Budi@Gmail.COM ")).toBe("budi@gmail.com");
    expect(emailFilters("email", "  Budi@Gmail.COM ")).toEqual(
      emailFilters("email", "budi@gmail.com")
    );
  });

  it("nilai kosong tidak menghasilkan filter apa pun", () => {
    expect(emailFilters("email", "")).toEqual([]);
    expect(emailFilters("email", "   ")).toEqual([]);
  });

  it("memakai nama kolom yang diberikan", () => {
    expect(emailFilters("customer_email", "a@b.com")[0]).toBe("customer_email=eq.a%40b.com");
  });
});

describe("emailFilters — wildcard SQL di-escape", () => {
  it("garis bawah di-escape supaya tidak jadi wildcard satu-karakter", () => {
    expect(ilikePattern(emailFilters("email", "budi_toko@gmail.com"))).toBe(
      "budi\\_toko@gmail.com"
    );
  });

  it("persen di-escape supaya tidak jadi wildcard apa-saja", () => {
    expect(ilikePattern(emailFilters("email", "a%b@gmail.com"))).toBe("a\\%b@gmail.com");
  });

  it("backslash-nya benar-benar terkirim ter-encode sebagai %5C", () => {
    expect(emailFilters("email", "budi_toko@gmail.com")[1]).toBe(
      "email=ilike.budi%5C_toko%40gmail.com"
    );
  });
});

describe("emailFilters — pola tidak boleh mencocoki alamat lain (regresi)", () => {
  it("garis bawah hanya cocok dengan garis bawah", () => {
    const re = ilikeToRegExp(ilikePattern(emailFilters("email", "budi_toko@gmail.com")) || "");
    expect(re.test("budi_toko@gmail.com")).toBe(true);
    // `ilike` memang tidak peka huruf besar/kecil — itu justru alasan cabang ini ada.
    expect(re.test("BUDI_TOKO@GMAIL.COM")).toBe(true);
    // Inilah yang gagal tanpa perbaikan: alamat yang TIDAK terdaftar ikut cocok.
    expect(re.test("budiXtoko@gmail.com")).toBe(false);
    expect(re.test("budi-toko@gmail.com")).toBe(false);
  });

  it("persen tidak menyapu alamat sembarang", () => {
    const re = ilikeToRegExp(ilikePattern(emailFilters("email", "%@gmail.com")) || "");
    expect(re.test("%@gmail.com")).toBe(true);
    expect(re.test("tokolain@gmail.com")).toBe(false);
    expect(re.test("pemiliklain@gmail.com")).toBe(false);
  });
});

describe("emailFilters — bintang tidak dicari lewat ilike", () => {
  it("nilai bermuatan * hanya menghasilkan eq.", () => {
    const filters = emailFilters("email", "*@gmail.com");
    expect(filters).toHaveLength(1);
    expect(filters[0]).toBe("email=eq.*%40gmail.com");
    expect(ilikePattern(filters)).toBeNull();
  });
});
