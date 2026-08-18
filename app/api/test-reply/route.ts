import { NextResponse } from "next/server";
import { getStoreByEmail, isDeviceWithinPlanLimit, isStoreActive, listStoreDevicesCompat } from "@/lib/supabase";
import { getSessionEmail } from "@/lib/auth";
import { checkConversationQuota, checkRateLimit, runAutoReply } from "@/lib/reply-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Uji coba balasan AI dari dashboard.
 *
 * Dulu tombol uji coba menembak `/api/fonnte/webhook` langsung dari browser,
 * sehingga endpoint publik itu harus tetap terbuka. Sekarang jalur uji coba
 * punya pintunya sendiri yang WAJIB login, dan selalu memakai toko milik
 * pemanggil — tidak bisa dipakai mengirim pesan lewat device toko orang lain.
 */
export async function POST(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Sesi tidak valid. Silakan login ulang." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const sender = String(body.sender || "").replace(/[^\d+]/g, "");
  const messageText = String(body.message || "").trim();

  if (sender.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "Nomor WA penguji tidak valid." }, { status: 400 });
  }
  if (!messageText) {
    return NextResponse.json({ error: "Pesan uji coba tidak boleh kosong." }, { status: 400 });
  }

  const store = await getStoreByEmail(email);
  if (!store) {
    return NextResponse.json({ error: "Data toko tidak ditemukan." }, { status: 404 });
  }
  if (!isStoreActive(store)) {
    return NextResponse.json(
      { error: "Masa uji coba telah berakhir. Silakan berlangganan untuk melanjutkan." },
      { status: 403 }
    );
  }
  // Pilih nomor pengirim: yang diminta dashboard, atau nomor utama toko.
  // Balasan harus keluar dari device milik toko ini, bukan account token bersama.
  const wantDeviceId = String(body.deviceId || "").trim();
  const { devices } = await listStoreDevicesCompat(store);
  const device =
    (wantDeviceId ? devices.find((d) => d.id === wantDeviceId) : undefined) ||
    devices.find((d) => d.is_primary) ||
    devices[0];

  if (!device?.fonnte_token) {
    return NextResponse.json(
      { error: "Hubungkan WhatsApp toko terlebih dahulu sebelum menguji balasan." },
      { status: 400 }
    );
  }
  if (!(await isDeviceWithinPlanLimit(store, device))) {
    return NextResponse.json(
      {
        error:
          "Nomor ini di luar kuota paket Anda, jadi bot tidak melayaninya. Upgrade paket atau pakai nomor lain."
      },
      { status: 403 }
    );
  }

  const rate = await checkRateLimit(device.id || store.id || email, sender);
  if (!rate.ok) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan. Coba lagi dalam ${rate.retryAfterSec} detik.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
    );
  }

  // Uji coba memakai jalur yang sama dengan pesan asli, jadi kuotanya pun sama.
  // Kalau tidak, pemilik toko bisa mengira botnya sehat padahal kuota sudah habis.
  const quota = await checkConversationQuota(store, sender);
  if (!quota.ok) {
    return NextResponse.json(
      {
        error:
          `Kuota percakapan bulan ini sudah terpakai semua (${quota.used}/${quota.limit}). ` +
          "Upgrade ke Pro untuk percakapan tanpa batas."
      },
      { status: 403 }
    );
  }

  try {
    const outcome = await runAutoReply({
      store,
      sender,
      messageText,
      deviceToken: device.fonnte_token
    });
    return NextResponse.json({
      success: true,
      // Nomor yang benar-benar dipakai sebagai kunci percakapan (sudah
      // dinormalisasi), supaya dashboard bisa langsung membuka thread-nya.
      sender,
      via: device.phone,
      intent: outcome.intent,
      reply: outcome.replyText,
      delivered: outcome.delivered,
      deliveryError: outcome.deliveryError
    });
  } catch (err) {
    console.error("[test-reply error]:", err);
    return NextResponse.json({ error: "Gagal memproses pesan uji coba." }, { status: 500 });
  }
}
