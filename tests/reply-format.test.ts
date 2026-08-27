import { describe, expect, it } from "vitest";
import {
  countDraftUnits,
  formatOrderSummary,
  formatStockNotice,
  formatWeight,
  mergeQuoteOptions,
  normalizeAiTone,
  normalizePaymentAccounts,
  type OrderDraft,
  type QuoteOption
} from "../lib/reply-format";

/**
 * Format balasan WhatsApp. Yang diuji adalah janji-janji yang dipegang
 * `lib/ai.ts`: angka tidak boleh dikarang, "Rp 0" tidak boleh muncul untuk tarif
 * yang belum pasti, dan opsi kurir yang tarifnya belum pasti tidak boleh
 * menyalip opsi yang harganya sudah jelas.
 */

function draft(over: Partial<OrderDraft> = {}): OrderDraft {
  return {
    lines: [],
    subtotal: 0,
    totalUnits: 0,
    weightGram: 1000,
    weightSource: "default",
    ambiguous: [],
    ...over
  };
}

describe("formatWeight", () => {
  it("di bawah 1 kg tetap dalam gram", () => {
    expect(formatWeight(250)).toBe("250 gram");
    expect(formatWeight(999)).toBe("999 gram");
  });

  it("1 kg ke atas dalam kg dengan koma desimal Indonesia", () => {
    expect(formatWeight(1000)).toBe("1 kg");
    expect(formatWeight(1200)).toBe("1,2 kg");
    expect(formatWeight(2500)).toBe("2,5 kg");
  });
});

describe("countDraftUnits", () => {
  it("menjumlahkan unit seluruh baris", () => {
    expect(
      countDraftUnits([
        { name: "A", units: 2, weight: 100, price: 1000, lineTotal: 2000 },
        { name: "B", units: 3, weight: 100, price: 1000, lineTotal: 3000 }
      ])
    ).toBe(5);
  });

  it("mengabaikan unit yang tidak masuk akal, bukan menjadikan totalnya NaN", () => {
    expect(
      countDraftUnits([
        { name: "A", units: Number.NaN, weight: 100, price: 1000, lineTotal: 0 },
        { name: "B", units: -4, weight: 100, price: 1000, lineTotal: 0 },
        { name: "C", units: 2, weight: 100, price: 1000, lineTotal: 2000 }
      ])
    ).toBe(2);
  });
});

describe("formatOrderSummary", () => {
  const single = draft({
    lines: [{ name: "Topi Baseball", units: 1, weight: 150, price: 50_000, lineTotal: 50_000 }],
    subtotal: 50_000,
    totalUnits: 1,
    weightGram: 150,
    weightSource: "matched"
  });

  it("tidak mencetak 'Total barang' pada pesanan satu potong", () => {
    const out = formatOrderSummary(single);
    expect(out).not.toContain("Total barang");
    expect(out).toContain("Rp 50.000");
    expect(out).toContain("150 gram");
  });

  it("mencetak jumlah barang bila lebih dari satu", () => {
    const out = formatOrderSummary(
      draft({
        lines: [{ name: "Topi Baseball", units: 3, weight: 150, price: 50_000, lineTotal: 150_000 }],
        subtotal: 150_000,
        totalUnits: 3,
        weightGram: 450,
        weightSource: "matched"
      })
    );
    expect(out).toContain("Total barang");
    expect(out).toContain("3 pcs");
    expect(out).toContain("3× Topi Baseball");
  });

  it("menandai berat yang masih asumsi sebagai perkiraan", () => {
    expect(formatOrderSummary(single)).not.toContain("(perkiraan)");
    expect(formatOrderSummary({ ...single, weightSource: "default" })).toContain("(perkiraan)");
  });

  it("tidak mengarang harga untuk produk yang harganya belum diisi", () => {
    const out = formatOrderSummary(
      draft({
        lines: [{ name: "Topi Baseball", units: 1, weight: 150, price: 0, lineTotal: 0 }],
        totalUnits: 1
      })
    );
    expect(out).toContain("harga menyusul");
    // Barisnya tetap ada — pembeli menyebut produk ini, jadi menghilangkannya
    // membingungkan — tapi angka rupiahnya tidak dikarang.
    expect(out).toContain("Topi Baseball");
    expect(out.split("\n")[1]).not.toContain("Rp");
  });
});

describe("formatStockNotice", () => {
  it("string kosong bila tidak ada kendala stok", () => {
    expect(formatStockNotice(draft())).toBe("");
    expect(formatStockNotice(draft({ outOfStock: [], insufficient: [] }))).toBe("");
  });

  it("menyebut produk yang habis", () => {
    const out = formatStockNotice(draft({ outOfStock: ["Topi Baseball"] }));
    expect(out).toContain("Ketersediaan stok");
    expect(out).toContain("Topi Baseball");
    expect(out).toContain("stok habis");
  });

  it("menyebut sisa dan jumlah yang diminta saat stok kurang", () => {
    const out = formatStockNotice(
      draft({ insufficient: [{ name: "Topi Baseball", requested: 5, stock: 2 }] })
    );
    expect(out).toContain("sisa 2 pcs");
    expect(out).toContain("diminta 5 pcs");
  });
});

describe("mergeQuoteOptions", () => {
  const rate = (name: string, cost: number): QuoteOption => ({
    courier_name: name,
    service_name: "REG",
    etd: "2 hari",
    cost
  });

  it("mengurutkan tarif dari termurah", () => {
    const { shown, hidden } = mergeQuoteOptions([rate("JNE", 20_000), rate("J&T", 12_000)]);
    expect(shown.map((o) => o.courier_name)).toEqual(["J&T", "JNE"]);
    expect(hidden).toBe(0);
  });

  it("memotong ke 5 opsi dan melaporkan sisanya", () => {
    const rates = [1, 2, 3, 4, 5, 6, 7].map((i) => rate(`K${i}`, i * 1000));
    const { shown, hidden } = mergeQuoteOptions(rates);
    expect(shown).toHaveLength(5);
    expect(hidden).toBe(2);
  });

  it("kurir toko bertarif pasti ikut diurutkan menurut harga", () => {
    const { shown } = mergeQuoteOptions([rate("JNE", 20_000)], {
      enabled: true,
      label: "Kurir Toko",
      cost: 10_000,
      etd: "Hari ini"
    });
    expect(shown.map((o) => o.courier_name)).toEqual(["Kurir Toko", "JNE"]);
    expect(shown[0].askForRate).toBe(false);
  });

  it("kurir toko bertarif belum pasti selalu di urutan terakhir", () => {
    const rates = [rate("JNE", 20_000), rate("J&T", 12_000)];
    const { shown } = mergeQuoteOptions(rates, {
      enabled: true,
      label: "Kurir Toko",
      cost: 0,
      etd: ""
    });
    // Tarif 0 yang diurutkan menurut harga akan terbaca sebagai gratis ongkir.
    expect(shown[shown.length - 1].courier_name).toBe("Kurir Toko");
    expect(shown[shown.length - 1].askForRate).toBe(true);
  });

  it("kurir toko yang belum pasti tidak menghabiskan kuota tampilan", () => {
    const rates = [1, 2, 3, 4, 5, 6].map((i) => rate(`K${i}`, i * 1000));
    const { shown, hidden } = mergeQuoteOptions(rates, {
      enabled: true,
      label: "Kurir Toko",
      cost: 0,
      etd: ""
    });
    expect(shown).toHaveLength(5);
    expect(shown.filter((o) => !o.local)).toHaveLength(4);
    expect(hidden).toBe(2);
  });

  it("kurir toko yang dimatikan tidak ikut ditampilkan", () => {
    const { shown } = mergeQuoteOptions([rate("JNE", 20_000)], {
      enabled: false,
      label: "Kurir Toko",
      cost: 10_000,
      etd: ""
    });
    expect(shown).toHaveLength(1);
  });
});

describe("normalizePaymentAccounts", () => {
  it("nilai bukan array menjadi daftar kosong", () => {
    expect(normalizePaymentAccounts(null)).toEqual([]);
    expect(normalizePaymentAccounts("BCA 123")).toEqual([]);
  });

  it("membuang rekening tanpa nama atau tanpa nomor", () => {
    const out = normalizePaymentAccounts([
      { name: "BCA", number: "" },
      { name: "", number: "123" },
      { name: " BCA ", number: " 1234567890 ", holder: " Budi " }
    ]);
    expect(out).toEqual([{ type: "bank", name: "BCA", number: "1234567890", holder: "Budi" }]);
  });

  it("jenis selain ewallet dianggap bank", () => {
    const out = normalizePaymentAccounts([
      { name: "OVO", number: "0812", type: "ewallet" },
      { name: "BCA", number: "123", type: "kartu-kredit" }
    ]);
    expect(out.map((a) => a.type)).toEqual(["ewallet", "bank"]);
  });

  it("memotong pada batas jumlah rekening", () => {
    const many = [1, 2, 3, 4, 5].map((i) => ({ name: `Bank ${i}`, number: `${i}` }));
    expect(normalizePaymentAccounts(many)).toHaveLength(3);
  });
});

describe("normalizeAiTone", () => {
  it("nada yang dikenal diterima apa pun kapitalisasinya", () => {
    expect(normalizeAiTone("FORMAL")).toBe("formal");
    expect(normalizeAiTone(" singkat ")).toBe("singkat");
  });

  it("nada tak dikenal jatuh ke ramah", () => {
    expect(normalizeAiTone("galak")).toBe("ramah");
    expect(normalizeAiTone(undefined)).toBe("ramah");
    expect(normalizeAiTone(42)).toBe("ramah");
  });
});
