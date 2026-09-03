import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processAICustomerService } from "../lib/ai";
import { isMengantarId } from "../lib/mengantar";

/**
 * Toko yang BELUM menetapkan lokasi asal pengiriman tidak boleh mendapat tarif.
 *
 * KENAPA TES INI ADA: sebelumnya `originSubdistrictId` punya nilai bawaan
 * "3171010" (Gambir, Jakarta Pusat) yang tersebar di empat berkas. Nilai itu
 * bukan `_id` Mengantar yang sah, jadi `calculateMengantarOngkir` melewati API
 * live dan mengarang tarif dari jarak semu ke Jakarta — lalu memberi tahu pembeli
 * "📍 Dari Jakarta Pusat" untuk toko yang mungkin ada di Makassar. Label
 * "Perkiraan" memang muncul, tapi perkiraan tidak menghalalkan kota yang salah.
 *
 * Yang dijaga di sini adalah SIFAT-nya, bukan susunan kalimatnya: selama lokasi
 * asal belum sah, balasan ke pembeli tidak boleh memuat satu pun angka ongkir,
 * dan `originMissing` harus menyala supaya pemilik toko bisa dikabari. Keduanya
 * bisa hilang tanpa gejala apa pun — bot yang mengarang tarif terlihat persis
 * seperti bot yang bekerja.
 */

/** `disableAiNarration: true` = Gemini tidak dipanggil; kalimatnya deterministik. */
const BASE = {
  storeName: "Toko Uji",
  disableAiNarration: true,
  defaultWeight: 1000
};

const KAOS = { name: "Kaos Polos", price: 75_000, weight: 250 };

/** `_id` Mengantar sungguhan berbentuk ObjectId 24 hex. */
const ORIGIN_VALID = "652f1a9b4c3d2e1f0a9b8c7d";

const realFetch = globalThis.fetch;

beforeEach(() => {
  // Pencarian lokasi Mengantar dimatikan: tesnya tentang lokasi ASAL, dan
  // `searchMengantarLocation` sudah punya jalur mock sendiri saat jaringan gagal.
  // Distub supaya hasilnya tidak bergantung pada koneksi mesin yang menjalankan.
  globalThis.fetch = (() => Promise.reject(new Error("jaringan dimatikan di tes"))) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("isMengantarId — batas 'lokasi asal sudah diisi'", () => {
  it("hanya menerima ObjectId 24 hex", () => {
    expect(isMengantarId(ORIGIN_VALID)).toBe(true);
    expect(isMengantarId(ORIGIN_VALID.toUpperCase())).toBe(true);
    expect(isMengantarId(`  ${ORIGIN_VALID}  `)).toBe(true);
  });

  it("menolak nilai bawaan lama, kode wilayah, dan kosong", () => {
    // Inilah baris yang paling penting: baris database lama masih menyimpan
    // "3171010", dan nilai itu HARUS dibaca sebagai 'belum diisi'.
    expect(isMengantarId("3171010")).toBe(false);
    expect(isMengantarId("")).toBe(false);
    expect(isMengantarId(null)).toBe(false);
    expect(isMengantarId(undefined)).toBe(false);
    expect(isMengantarId("99999")).toBe(false);
    expect(isMengantarId(ORIGIN_VALID.slice(0, 23))).toBe(false);
    expect(isMengantarId(`${ORIGIN_VALID}0`)).toBe(false);
    // 24 karakter tapi bukan hex.
    expect(isMengantarId("zzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("processAICustomerService — lokasi asal belum disetel", () => {
  it("tidak menyebut satu pun angka saat pembeli tanya ongkir", async () => {
    const res = await processAICustomerService({
      ...BASE,
      messageText: "ongkir ke Makassar berapa kak?",
      originSubdistrictId: "",
      originCityName: ""
    });

    expect(res.originMissing).toBe(true);
    expect(res.intent).toBe("ONGKIR_CHECK");
    // Tanpa produk yang cocok, balasan yang benar tidak punya alasan memuat
    // angka apa pun — jadi satu digit saja sudah berarti tarif karangan.
    expect(res.replyText).not.toMatch(/\d/);
    expect(res.shippingDetails).toBeUndefined();
    expect(res.rateSource).toBeUndefined();
  });

  it("memperlakukan nilai bawaan lama '3171010' sebagai belum disetel", async () => {
    const res = await processAICustomerService({
      ...BASE,
      messageText: "ongkir ke Makassar berapa kak?",
      originSubdistrictId: "3171010",
      originCityName: "Jakarta Pusat"
    });

    expect(res.originMissing).toBe(true);
    expect(res.replyText).not.toMatch(/\d/);
    // Regresi yang sesungguhnya: kota asal karangan tidak boleh disebut lagi.
    expect(res.replyText).not.toMatch(/jakarta/i);
  });

  it("pesanan lengkap tetap dicatat sebagai ORDER, dengan subtotal tapi tanpa ongkir", async () => {
    const res = await processAICustomerService({
      ...BASE,
      messageText: "oke pesan 2 kaos polos, kirim ke Makassar",
      originSubdistrictId: "",
      originCityName: "",
      products: [KAOS]
    });

    expect(res.originMissing).toBe(true);
    // Pesanannya TIDAK boleh hilang hanya karena ongkirnya belum bisa dihitung.
    expect(res.intent).toBe("ORDER");
    expect(res.orderDraft?.subtotal).toBe(150_000);
    // Subtotal produk boleh disebut — angka itu milik toko, bukan milik kurir.
    expect(res.replyText).toContain("150.000");
    // Tidak ada tarif kurir maupun total bayar akhir.
    expect(res.replyText).not.toMatch(/ongkir\s*:?\s*rp/i);
    expect(res.replyText).not.toMatch(/total bayar/i);
    expect(res.shippingDetails).toBeUndefined();
  });

  it("tidak menyalakan originMissing untuk pesan yang tidak menyangkut ongkir", async () => {
    const res = await processAICustomerService({
      ...BASE,
      messageText: "halo kak",
      originSubdistrictId: "",
      originCityName: ""
    });

    expect(res.originMissing).toBeUndefined();
  });
});

describe("processAICustomerService — lokasi asal sudah sah", () => {
  it("jalur ongkir kembali berjalan dan originMissing tidak menyala", async () => {
    const res = await processAICustomerService({
      ...BASE,
      messageText: "ongkir ke Makassar berapa kak?",
      originSubdistrictId: ORIGIN_VALID,
      originCityName: "Makassar"
    });

    expect(res.originMissing).toBeUndefined();
    expect(res.intent).toBe("ONGKIR_CHECK");
    // Tarifnya simulasi di tes ini (jaringan dimatikan), dan itu justru harus
    // tetap DITANDAI mock — bukan disembunyikan.
    expect(res.rateSource).toBe("mock");
    expect((res.shippingDetails || []).length).toBeGreaterThan(0);
    // Dua baris ini yang membuat `not.toMatch(/\d/)` di atas berarti sesuatu:
    // dengan input yang SAMA dan hanya lokasi asal yang berbeda, jalur ini memang
    // mengeluarkan angka. Tanpa pembanding ini, tes 'tanpa angka' bisa lulus
    // hanya karena jalurnya tidak pernah sampai ke perhitungan ongkir.
    expect(res.replyText).toMatch(/\d/);
    expect(res.replyText).toMatch(/perkiraan/i);
  });
});
