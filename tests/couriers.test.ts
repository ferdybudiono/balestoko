import { describe, expect, it } from "vitest";
import {
  COURIER_GROUPS,
  DEFAULT_LOCAL_COURIER,
  MAX_LOCAL_COURIER_COST,
  RETIRED_COURIERS,
  courierGroupOf,
  courierLabel,
  filterRatesByActiveCouriers,
  isRetiredCourier,
  normalizeActiveCouriers,
  normalizeLocalCourier,
  retiredCouriersIn
} from "../lib/couriers";

/**
 * Penyaringan ekspedisi. Dua sifat di sini wajib dijaga tes karena keduanya
 * mudah "dirapikan" menjadi salah: urutan hasil harus stabil (dashboard memakai
 * `JSON.stringify` untuk mendeteksi perubahan belum disimpan), dan daftar aktif
 * yang kosong berarti SEMUA kurir, bukan nol kurir.
 */

describe("courierGroupOf & courierLabel", () => {
  it("memetakan courier_code ke kode grup", () => {
    expect(courierGroupOf("jne")).toBe("jne");
    expect(courierGroupOf("jnecargo")).toBe("jne");
    expect(courierGroupOf("sicepatcargo")).toBe("sicepat");
  });

  it("menerima alias dan spasi/kapital yang tidak rapi", () => {
    expect(courierGroupOf("jnt")).toBe("jt");
    expect(courierGroupOf("  JNE  ")).toBe("jne");
  });

  it("kode tak dikenal menjadi null", () => {
    expect(courierGroupOf("gojek")).toBeNull();
    expect(courierGroupOf("")).toBeNull();
  });

  it("label jatuh ke kodenya sendiri bila grup tak dikenal", () => {
    expect(courierLabel("jt")).toBe("J&T Express");
    expect(courierLabel("entah")).toBe("entah");
  });
});

describe("normalizeActiveCouriers", () => {
  it("nilai bukan array menjadi daftar kosong", () => {
    expect(normalizeActiveCouriers(null)).toEqual([]);
    expect(normalizeActiveCouriers("jne,jt")).toEqual([]);
  });

  it("membuang kode tak dikenal dan nilai bukan string", () => {
    expect(normalizeActiveCouriers(["jne", "gojek", 5, null])).toEqual(["jne"]);
  });

  it("menerima courier_code mentah, bukan hanya kode grup", () => {
    expect(normalizeActiveCouriers(["jnecargo", "jnt"])).toEqual(["jne", "jt"]);
  });

  it("dedupe dan mengurutkan menurut urutan kanonik, apa pun urutan masukan", () => {
    const canonical = normalizeActiveCouriers(["pos", "jne", "sicepat"]);
    expect(canonical).toEqual(["jne", "sicepat", "pos"]);
    // Urutan yang stabil = tombol Simpan tidak menyala tanpa sebab.
    expect(normalizeActiveCouriers(["sicepat", "pos", "jne", "jne"])).toEqual(canonical);
  });

  it("semua kode grup yang terdaftar diterima", () => {
    const all = COURIER_GROUPS.map((g) => g.code);
    expect(normalizeActiveCouriers(all)).toEqual(all);
  });
});

describe("filterRatesByActiveCouriers", () => {
  const rates = [
    { courier_code: "jne", cost: 20_000 },
    { courier_code: "jnecargo", cost: 15_000 },
    { courier_code: "jt", cost: 12_000 },
    { courier_code: "gojek", cost: 9_000 }
  ];

  it("belum ada yang diceklis → semua tarif lolos (fail-open)", () => {
    expect(filterRatesByActiveCouriers(rates, [])).toEqual(rates);
    expect(filterRatesByActiveCouriers(rates, null)).toEqual(rates);
    expect(filterRatesByActiveCouriers(rates, undefined)).toEqual(rates);
  });

  it("hanya melewatkan layanan milik grup yang diceklis", () => {
    const out = filterRatesByActiveCouriers(rates, ["jne"]);
    expect(out.map((r) => r.courier_code)).toEqual(["jne", "jnecargo"]);
  });

  it("sudah diceklis tapi tidak ada yang cocok → kosong, bukan jatuh ke semua", () => {
    // Mengutip kurir yang tokonya tidak punya akun lebih merugikan daripada
    // berkata jujur bahwa rute itu belum dilayani.
    expect(filterRatesByActiveCouriers(rates, ["pos"])).toEqual([]);
  });

  it("kurir dengan kode tak dikenal tidak pernah lolos saat ada filter", () => {
    const out = filterRatesByActiveCouriers(rates, ["jne", "jt"]);
    expect(out.map((r) => r.courier_code)).not.toContain("gojek");
  });

  // Inilah bagian yang paling mudah salah: merek pensiun harus dibuang SEBELUM
  // cabang fail-open, bukan sesudahnya. Kalau urutannya tertukar, toko yang belum
  // menceklis apa pun tetap mengutip ekspedisi yang tidak bisa mengirim.
  it("merek pensiun dibuang meski belum ada yang diceklis (fail-open)", () => {
    const withRetired = [...rates, { courier_code: "ninja", cost: 11_000 }];
    expect(filterRatesByActiveCouriers(withRetired, []).map((r) => r.courier_code)).toEqual([
      "jne",
      "jnecargo",
      "jt",
      "gojek"
    ]);
    expect(filterRatesByActiveCouriers(withRetired, null).map((r) => r.courier_code)).not.toContain(
      "ninja"
    );
  });

  it("merek pensiun tetap dibuang saat ada filter, apa pun isi filternya", () => {
    const withRetired = [{ courier_code: "ninja", cost: 11_000 }, ...rates];
    expect(filterRatesByActiveCouriers(withRetired, ["jne"]).map((r) => r.courier_code)).toEqual([
      "jne",
      "jnecargo"
    ]);
  });

  // Konsekuensi yang disengaja, dan satu-satunya perubahan perilaku yang terasa
  // bagi pemilik toko: kalau SATU-SATUNYA ceklisnya adalah merek pensiun, daftar
  // aktifnya menjadi kosong dan aturan fail-open mengambil alih — semua ekspedisi
  // lain ditawarkan. Itu dipilih karena bot yang mengutip nol ekspedisi jauh lebih
  // merugikan, dan dashboard menyatakannya apa adanya lewat `retiredCouriersIn`.
  it("hanya merek pensiun yang diceklis → fail-open, bukan nol ekspedisi", () => {
    const withRetired = [{ courier_code: "ninja", cost: 11_000 }, ...rates];
    expect(filterRatesByActiveCouriers(withRetired, ["ninja"]).map((r) => r.courier_code)).toEqual([
      "jne",
      "jnecargo",
      "jt",
      "gojek"
    ]);
  });
});

describe("merek pensiun", () => {
  it("kode & alias merek pensiun dikenali, yang lain tidak", () => {
    for (const c of RETIRED_COURIERS) {
      expect(isRetiredCourier(c.code)).toBe(true);
      for (const s of c.services) expect(isRetiredCourier(s.toUpperCase())).toBe(true);
    }
    expect(isRetiredCourier("jne")).toBe(false);
    expect(isRetiredCourier("")).toBe(false);
  });

  it("merek pensiun tidak lagi bisa diceklis maupun tersimpan", () => {
    for (const c of RETIRED_COURIERS) {
      expect(COURIER_GROUPS.some((g) => g.code === c.code)).toBe(false);
      expect(courierGroupOf(c.code)).toBeNull();
      expect(normalizeActiveCouriers([c.code])).toEqual([]);
      // Satu-satunya pilihan toko adalah merek pensiun → jatuh ke fail-open
      // (semua ekspedisi lain ditawarkan), bukan nol ekspedisi.
      expect(normalizeActiveCouriers(["jne", c.code])).toEqual(["jne"]);
    }
  });

  it("nilai lama di active_couriers bisa dilaporkan ke pemilik toko", () => {
    expect(retiredCouriersIn(["jne", "ninja"]).map((c) => c.label)).toEqual(["Ninja Xpress"]);
    expect(retiredCouriersIn(["  NINJA  "]).map((c) => c.code)).toEqual(["ninja"]);
    expect(retiredCouriersIn(["jne", "jt"])).toEqual([]);
    expect(retiredCouriersIn(null)).toEqual([]);
  });
});

describe("normalizeLocalCourier", () => {
  it("nilai bukan objek jatuh ke bawaan", () => {
    expect(normalizeLocalCourier(null)).toEqual(DEFAULT_LOCAL_COURIER);
    expect(normalizeLocalCourier(["a"])).toEqual(DEFAULT_LOCAL_COURIER);
  });

  it("label kosong tidak boleh aktif", () => {
    const out = normalizeLocalCourier({ enabled: true, label: "   ", cost: 10_000 });
    expect(out.enabled).toBe(false);
    expect(out.label).toBe(DEFAULT_LOCAL_COURIER.label);
  });

  it("menyimpan label & tarif meski opsinya sedang dimatikan", () => {
    const out = normalizeLocalCourier({ enabled: false, label: "Gojek", cost: 15_000, etd: "1 jam" });
    expect(out).toEqual({ enabled: false, label: "Gojek", cost: 15_000, etd: "1 jam" });
  });

  it("tarif tidak masuk akal menjadi 0 (artinya: tanya dulu)", () => {
    expect(normalizeLocalCourier({ label: "Gojek", cost: -5 }).cost).toBe(0);
    expect(normalizeLocalCourier({ label: "Gojek", cost: "abc" }).cost).toBe(0);
    expect(normalizeLocalCourier({ label: "Gojek" }).cost).toBe(0);
  });

  it("tarif dibulatkan dan dibatasi", () => {
    expect(normalizeLocalCourier({ label: "Gojek", cost: 12_499.6 }).cost).toBe(12_500);
    expect(normalizeLocalCourier({ label: "Gojek", cost: 9_999_999 }).cost).toBe(
      MAX_LOCAL_COURIER_COST
    );
  });

  it("memotong label dan etd yang kepanjangan", () => {
    const out = normalizeLocalCourier({ label: "x".repeat(100), etd: "y".repeat(100) });
    expect(out.label).toHaveLength(60);
    expect(out.etd).toHaveLength(40);
  });
});
