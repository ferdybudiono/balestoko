import { describe, expect, it } from "vitest";
import { draftHasSoldOut, draftHasStockIssue, resolveOrderDraft } from "../lib/ai";

/**
 * Pencocokan produk & stok — inti perhitungan yang angkanya sampai ke pembeli.
 *
 * Yang diuji di sini bukan "apakah fungsinya jalan", tapi keputusan-keputusan
 * yang sengaja diambil dan mudah hilang saat kode disentuh lagi: nama yang
 * ambigu tidak boleh ditebak, berat kosong tidak boleh menghapus harga, dan
 * stok 0 tidak boleh sama artinya dengan stok yang tidak dicatat.
 */

const KAOS = { id: "p1", name: "Kaos Polos Lengan Panjang", price: 75_000, weight: 250 };
const TOPI = { id: "p2", name: "Topi Baseball", price: 50_000, weight: 150 };
const RAGLAN = { id: "p3", name: "Kaos Raglan", price: 85_000, weight: 260 };

describe("resolveOrderDraft — pencocokan produk", () => {
  it("tidak menebak apa pun saat katalog kosong dan memakai berat asumsi toko", () => {
    const d = resolveOrderDraft("mau pesan kaos 2", [], 1200);
    expect(d.lines).toEqual([]);
    expect(d.subtotal).toBe(0);
    expect(d.weightGram).toBe(1200);
    expect(d.weightSource).toBe("default");
  });

  it("jatuh ke 1000 gram bila toko belum mengisi berat asumsi", () => {
    expect(resolveOrderDraft("halo", []).weightGram).toBe(1000);
    expect(resolveOrderDraft("halo", [], 0).weightGram).toBe(1000);
  });

  it("cocok lewat nama lengkap sebagai substring", () => {
    const d = resolveOrderDraft("mau kaos polos lengan panjang dong", [KAOS, TOPI]);
    expect(d.lines.map((l) => l.name)).toEqual([KAOS.name]);
    expect(d.lines[0].units).toBe(1);
    expect(d.subtotal).toBe(75_000);
    expect(d.weightGram).toBe(250);
    expect(d.weightSource).toBe("matched");
  });

  it("cocok saat semua token nama muncul dengan urutan bebas", () => {
    const d = resolveOrderDraft("lengan panjang yg polos kaos ada?", [KAOS]);
    expect(d.lines).toHaveLength(1);
  });

  it("membaca jumlah dari token yang muncul paling awal, bukan dari kata terakhir", () => {
    const d = resolveOrderDraft("2 polos lengan panjang", [KAOS]);
    expect(d.lines[0].units).toBe(2);
    expect(d.subtotal).toBe(150_000);
    expect(d.weightGram).toBe(500);
  });

  it("membaca jumlah dalam huruf dan satuan borongan", () => {
    expect(resolveOrderDraft("dua topi baseball", [TOPI]).lines[0].units).toBe(2);
    expect(resolveOrderDraft("topi baseball 3 pcs", [TOPI]).lines[0].units).toBe(3);
    expect(resolveOrderDraft("selusin topi baseball", [TOPI]).lines[0].units).toBe(12);
  });

  it("tidak membaca angka 3 digit atau lebih sebagai jumlah barang", () => {
    // Gerbang yang sama menjaga "kaos 250 gram" tidak terbaca 25 unit;
    // menebak ratusan potong dari satu angka jauh lebih mahal daripada 1.
    expect(resolveOrderDraft("9999 topi baseball", [TOPI]).lines[0].units).toBe(1);
    expect(resolveOrderDraft("topi baseball 250 gram", [TOPI]).lines[0].units).toBe(1);
  });

  it("membatasi jumlah unit yang diakui dari satu penyebutan", () => {
    // 99 kodi = 1.980 potong; dipotong ke batas supaya satu salah baca tidak
    // melahirkan pesanan ribuan potong.
    const d = resolveOrderDraft("99 kodi topi baseball", [TOPI]);
    expect(d.lines[0].units).toBe(200);
  });

  it("menolak menebak saat satu token dimiliki lebih dari satu produk", () => {
    const d = resolveOrderDraft("ada kaos?", [KAOS, RAGLAN]);
    expect(d.lines).toEqual([]);
    expect(d.ambiguous.sort()).toEqual([KAOS.name, RAGLAN.name].sort());
  });

  it("tidak menyeret produk lain lewat token yang sudah terpakai produk yang cocok", () => {
    // "kaos" juga milik Kaos Raglan, tapi sudah dihabiskan oleh Kaos Polos.
    const d = resolveOrderDraft("2 kaos polos lengan panjang", [KAOS, RAGLAN]);
    expect(d.lines.map((l) => l.name)).toEqual([KAOS.name]);
    expect(d.ambiguous).toEqual([]);
  });

  it("membaca dua produk sekaligus: satu nama lengkap + satu potongan nama", () => {
    const d = resolveOrderDraft("2 kaos polos lengan panjang + 1 baseball", [KAOS, TOPI]);
    expect(d.lines.map((l) => [l.name, l.units])).toEqual([
      [KAOS.name, 2],
      [TOPI.name, 1]
    ]);
    expect(d.subtotal).toBe(200_000);
    expect(d.weightGram).toBe(650);
  });

  it("mengurutkan baris menurut katalog, bukan menurut urutan penyebutan", () => {
    const d = resolveOrderDraft("baseball dulu, lalu kaos polos lengan panjang", [KAOS, TOPI]);
    expect(d.lines.map((l) => l.name)).toEqual([KAOS.name, TOPI.name]);
  });

  it("mengabaikan kata umum sebagai penanda produk", () => {
    const d = resolveOrderDraft("paket saya kapan sampai?", [
      { id: "p9", name: "Paket Hemat", price: 30_000, weight: 500 }
    ]);
    expect(d.lines).toEqual([]);
  });

  it("tetap menghitung harga saat berat produk tidak valid", () => {
    const d = resolveOrderDraft("1 topi baseball", [{ ...TOPI, weight: 0 }], 800);
    expect(d.subtotal).toBe(50_000);
    expect(d.weightGram).toBe(800);
    expect(d.weightSource).toBe("default");
  });

  it("menampilkan produk tanpa harga valid tanpa mengarang angkanya", () => {
    const d = resolveOrderDraft("1 topi baseball", [{ ...TOPI, price: 0 }]);
    expect(d.lines[0].price).toBe(0);
    expect(d.lines[0].lineTotal).toBe(0);
    expect(d.subtotal).toBe(0);
  });

  it("membatasi berat paket pada batas kurir", () => {
    // 200 potong × 400 gram = 80 kg; di atas 50 kg kurir memakai skema lain.
    const d = resolveOrderDraft("99 kodi topi baseball", [{ ...TOPI, weight: 400 }]);
    expect(d.weightGram).toBe(50_000);
    expect(d.weightSource).toBe("matched");
  });

  it("menjumlahkan totalUnits dari seluruh baris", () => {
    const d = resolveOrderDraft("2 kaos polos lengan panjang dan 3 baseball", [KAOS, TOPI]);
    expect(d.totalUnits).toBe(5);
  });
});

describe("resolveOrderDraft — stok", () => {
  it("stok tidak dicatat (undefined/null) berarti selalu tersedia", () => {
    const d = resolveOrderDraft("1 topi baseball", [{ ...TOPI, stock: null }]);
    expect(d.outOfStock).toEqual([]);
    expect(d.insufficient).toEqual([]);
    expect(d.lines[0]).not.toHaveProperty("stock");
    expect(draftHasStockIssue(d)).toBe(false);
  });

  it("stok 0 dicatat habis tapi barisnya tetap terbaca", () => {
    const d = resolveOrderDraft("1 topi baseball", [{ ...TOPI, stock: 0 }]);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].stock).toBe(0);
    expect(d.outOfStock).toEqual([TOPI.name]);
    expect(draftHasSoldOut(d)).toBe(true);
  });

  it("jumlah melebihi stok dicatat sebagai kurang, bukan habis", () => {
    const d = resolveOrderDraft("5 topi baseball", [{ ...TOPI, stock: 2 }]);
    expect(d.insufficient).toEqual([{ name: TOPI.name, requested: 5, stock: 2 }]);
    expect(d.lines[0].shortfall).toBe(3);
    expect(draftHasStockIssue(d)).toBe(true);
    // Kurang stok masih boleh dicatat sebagai pesanan; habis total tidak.
    expect(draftHasSoldOut(d)).toBe(false);
  });

  it("jumlah tepat sebanyak stok bukan masalah", () => {
    const d = resolveOrderDraft("2 topi baseball", [{ ...TOPI, stock: 2 }]);
    expect(draftHasStockIssue(d)).toBe(false);
  });

  it("stok pecahan atau negatif dibulatkan ke bilangan yang masuk akal", () => {
    expect(resolveOrderDraft("1 topi baseball", [{ ...TOPI, stock: -5 }]).outOfStock).toEqual([
      TOPI.name
    ]);
    expect(resolveOrderDraft("1 topi baseball", [{ ...TOPI, stock: 2.9 }]).lines[0].stock).toBe(2);
  });

  it("draft kosong/null tidak dianggap punya kendala stok", () => {
    expect(draftHasStockIssue(null)).toBe(false);
    expect(draftHasSoldOut(undefined)).toBe(false);
  });
});
