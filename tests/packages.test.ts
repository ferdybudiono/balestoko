import { describe, expect, it } from "vitest";
import {
  BILLING_PERIOD_DAYS,
  PLANS,
  PLAN_LIST,
  aiContextMessagesForPackage,
  daysUntil,
  formatIDR,
  getPlan,
  hasAdvancedAnalytics,
  isPackageId,
  maxDevicesForPackage,
  monthStartMs,
  monthlyConversationLimit,
  subscriptionEndAfterPayment
} from "../lib/packages";

/**
 * Batas paket & periode langganan.
 *
 * Dua hal yang diuji ketat: paket tak dikenal harus jatuh ke batas PALING KETAT
 * (bukan diam-diam membagikan kuota Pro), dan awal bulan kuota harus tengah
 * malam WIB — bukan tengah malam UTC yang di Indonesia jatuh pukul 07:00.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("getPlan & isPackageId", () => {
  it("mengenali paket yang ada", () => {
    expect(getPlan("starter")).toBe(PLANS.starter);
    expect(getPlan("pro")).toBe(PLANS.pro);
    expect(PLAN_LIST).toEqual([PLANS.starter, PLANS.pro]);
  });

  it("nilai kosong atau tak dikenal menjadi undefined", () => {
    expect(getPlan(null)).toBeUndefined();
    expect(getPlan("")).toBeUndefined();
    expect(getPlan("enterprise")).toBeUndefined();
  });

  it("isPackageId hanya menerima id paket yang benar-benar ada", () => {
    expect(isPackageId("starter")).toBe(true);
    expect(isPackageId("pro")).toBe(true);
    expect(isPackageId("PRO")).toBe(false);
    expect(isPackageId(undefined)).toBe(false);
  });
});

describe("batas per paket", () => {
  it("nilai sesuai paketnya", () => {
    expect(maxDevicesForPackage("starter")).toBe(1);
    expect(maxDevicesForPackage("pro")).toBe(3);
    expect(monthlyConversationLimit("starter")).toBe(1000);
    expect(monthlyConversationLimit("pro")).toBeNull();
    expect(aiContextMessagesForPackage("pro")).toBe(12);
    expect(hasAdvancedAnalytics("pro")).toBe(true);
    expect(hasAdvancedAnalytics("starter")).toBe(false);
  });

  it("paket tak dikenal atau kosong jatuh ke batas paling ketat", () => {
    for (const id of [undefined, null, "", "enterprise"]) {
      expect(maxDevicesForPackage(id)).toBe(PLANS.starter.maxDevices);
      expect(monthlyConversationLimit(id)).toBe(PLANS.starter.monthlyConversations);
      expect(aiContextMessagesForPackage(id)).toBe(PLANS.starter.aiContextMessages);
      expect(hasAdvancedAnalytics(id)).toBe(PLANS.starter.advancedAnalytics);
    }
  });

  it("paket tak dikenal tidak pernah mendapat kuota tanpa batas", () => {
    expect(monthlyConversationLimit("enterprise")).not.toBeNull();
  });
});

describe("monthStartMs", () => {
  it("tengah malam 1 <bulan> WIB = 17:00 UTC hari terakhir bulan sebelumnya", () => {
    const now = Date.parse("2026-08-27T03:00:00.000Z");
    expect(new Date(monthStartMs(now)).toISOString()).toBe("2026-07-31T17:00:00.000Z");
  });

  it("pukul 00:30 WIB tanggal 1 sudah masuk bulan baru", () => {
    // 2026-08-01 00:30 WIB = 2026-07-31 17:30 UTC.
    const now = Date.parse("2026-07-31T17:30:00.000Z");
    expect(new Date(monthStartMs(now)).toISOString()).toBe("2026-07-31T17:00:00.000Z");
  });

  it("pukul 23:30 WIB tanggal terakhir masih bulan lama", () => {
    // 2026-07-31 23:30 WIB = 2026-07-31 16:30 UTC.
    const now = Date.parse("2026-07-31T16:30:00.000Z");
    expect(new Date(monthStartMs(now)).toISOString()).toBe("2026-06-30T17:00:00.000Z");
  });

  it("batasnya tepat, bukan berada di tengah bulan", () => {
    const now = Date.parse("2026-08-27T03:00:00.000Z");
    expect(monthStartMs(now)).toBeLessThan(now);
    expect(now - monthStartMs(now)).toBeLessThan(32 * DAY_MS);
  });
});

describe("subscriptionEndAfterPayment", () => {
  const now = Date.parse("2026-08-27T00:00:00.000Z");

  it("langganan baru dihitung dari sekarang", () => {
    const end = subscriptionEndAfterPayment(null, now);
    expect(Date.parse(end) - now).toBe(BILLING_PERIOD_DAYS * DAY_MS);
  });

  it("perpanjangan lebih awal tidak menghanguskan sisa hari", () => {
    const current = new Date(now + 10 * DAY_MS).toISOString();
    const end = subscriptionEndAfterPayment(current, now);
    expect(Date.parse(end) - now).toBe((10 + BILLING_PERIOD_DAYS) * DAY_MS);
  });

  it("langganan yang sudah lewat dimulai dari sekarang, bukan menambal masa lalu", () => {
    const expired = new Date(now - 40 * DAY_MS).toISOString();
    const end = subscriptionEndAfterPayment(expired, now);
    expect(Date.parse(end) - now).toBe(BILLING_PERIOD_DAYS * DAY_MS);
  });

  it("tanggal yang tidak valid diperlakukan seperti tanpa langganan", () => {
    const end = subscriptionEndAfterPayment("bukan-tanggal", now);
    expect(Date.parse(end) - now).toBe(BILLING_PERIOD_DAYS * DAY_MS);
  });
});

describe("daysUntil", () => {
  const now = Date.parse("2026-08-27T00:00:00.000Z");

  it("tanpa tanggal akhir menjadi null", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil(undefined, now)).toBeNull();
    expect(daysUntil("bukan-tanggal", now)).toBeNull();
  });

  it("membulatkan sisa hari ke atas", () => {
    expect(daysUntil(new Date(now + 3 * DAY_MS).toISOString(), now)).toBe(3);
    expect(daysUntil(new Date(now + 2.1 * DAY_MS).toISOString(), now)).toBe(3);
  });

  it("nilai 0 atau negatif berarti sudah kedaluwarsa", () => {
    expect(daysUntil(new Date(now).toISOString(), now)).toBe(0);
    expect(daysUntil(new Date(now - 5 * DAY_MS).toISOString(), now)).toBe(-5);
  });
});

describe("formatIDR", () => {
  it("tanpa desimal dan memakai pemisah ribuan Indonesia", () => {
    expect(formatIDR(99_000).replace(/ /g, " ")).toMatch(/^Rp\s?99\.000$/);
    expect(formatIDR(299_000).replace(/ /g, " ")).toMatch(/^Rp\s?299\.000$/);
    expect(formatIDR(0).replace(/ /g, " ")).toMatch(/^Rp\s?0$/);
  });
});
