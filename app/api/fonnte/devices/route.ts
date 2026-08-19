import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { createFonnteDevice, deleteFonnteDevice, formatFonntePhone } from "@/lib/fonnte";
import { maxDevicesForPackage, getPlan } from "@/lib/packages";
import {
  deleteStoreDevice,
  getStoreByEmail,
  getStoreDeviceByPhone,
  insertStoreDevice,
  isStoreActive,
  listStoreDevicesCompat,
  toPublicDevice,
  updateStoreDevice,
  upsertStore,
  type StoreDeviceRecord,
  type StoreRecord
} from "@/lib/supabase";
import {
  buildFonnteWebhookUrl,
  fonnteDeviceName,
  isReachableBaseUrl,
  isWebhookUrlSynced,
  redactWebhookUrl,
  reconcileDeviceInbound,
  resolveBaseUrl,
  syncDeviceWebhookUrl,
  type DeviceInboundHealth
} from "@/lib/webhook-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kelola nomor WhatsApp (device Fonnte) milik satu toko.
 *
 * Jumlah nomor dibatasi paket — Starter 1, Pro 3 — dan batas itu DITEGAKKAN di
 * sini, bukan cuma dijanjikan di halaman harga.
 *
 *   GET    ?status=1  → daftar nomor (opsional: segarkan status + setelan dari Fonnte)
 *   POST   { phone, label? }
 *   PATCH  ?id=<deviceId>  → paksa perbaiki setelan penerimaan pesan
 *   DELETE ?id=<deviceId>
 */

async function requireStore(): Promise<
  { ok: true; email: string; store: StoreRecord } | { ok: false; res: NextResponse }
> {
  const email = await getSessionEmail();
  if (!email) {
    return { ok: false, res: NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 }) };
  }
  const store = await getStoreByEmail(email);
  if (!store || !store.id) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Toko tidak ditemukan untuk akun ini." }, { status: 404 })
    };
  }
  return { ok: true, email, store };
}

export async function GET(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;
  const { store } = auth;

  const refreshStatus = new URL(req.url).searchParams.get("status") === "1";
  const { devices, legacy } = await listStoreDevicesCompat(store);
  const limit = maxDevicesForPackage(store.package_id);

  const baseUrl = resolveBaseUrl(req);
  const desired = buildFonnteWebhookUrl(baseUrl);
  const baseUrlReachable = isReachableBaseUrl(desired);

  // Kondisi jalur TERIMA per nomor. Tanpa `status=1` kita hanya melaporkan apa
  // yang tercatat di database (murah, dipakai polling); dengan `status=1` setelan
  // dibaca ulang dari Fonnte dan diperbaiki bila melenceng.
  const health = new Map<string, DeviceInboundHealth>();

  if (refreshStatus) {
    // Satu panggilan Fonnte per device — jalankan paralel supaya latensi tidak
    // menumpuk saat toko punya 3 nomor.
    await Promise.all(
      devices.map(async (d) => {
        if (!d.fonnte_token) return;
        const h = await reconcileDeviceInbound({ store, device: d, desired });
        health.set(d.id || d.phone, h);

        const next = h.connected ? "CONNECTED" : "DISCONNECTED";
        if (next === d.device_status) return;
        d.device_status = next;
        if (d.id) await updateStoreDevice(d.id, { device_status: next });
        if (d.is_primary && store.email) {
          await upsertStore({ email: store.email, fonnte_device_status: next });
        }
      })
    );
  }

  return NextResponse.json({
    devices: devices.map((d) => withInboundDiagnostics(d, desired, health.get(d.id || d.phone))),
    limit,
    planName: getPlan(store.package_id)?.name || "Starter",
    canAddMore: !legacy && devices.length < limit,
    // true = tabel `store_devices` belum ada/belum terisi; nomor di bawah dibaca
    // dari kolom lama `stores` dan penambahan nomor belum bisa dipakai.
    needsMigration: legacy,
    // Diagnosa tingkat aplikasi: URL yang didaftarkan ke Fonnte (secret disamarkan)
    // dan apakah URL itu bisa dijangkau dari internet.
    expectedWebhookUrl: redactWebhookUrl(desired),
    baseUrlReachable,
    baseUrlWarning: baseUrlReachable
      ? undefined
      : `NEXT_PUBLIC_BASE_URL menunjuk ke ${baseUrl} yang tidak bisa dijangkau Fonnte. ` +
        "Chat pembeli tidak akan pernah tiba sebelum variabel itu diisi domain publik aplikasi, " +
        "lalu aplikasi di-deploy ulang."
  });
}

/**
 * Paksa perbaikan setelan penerimaan pesan (URL webhook + auto read) — dipakai
 * tombol "Perbaiki otomatis" di tab WhatsApp.
 *
 *   PATCH /api/fonnte/devices          → semua nomor toko
 *   PATCH /api/fonnte/devices?id=<uuid> → satu nomor
 */
export async function PATCH(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;
  const { store } = auth;

  const id = new URL(req.url).searchParams.get("id") || "";
  const desired = buildFonnteWebhookUrl(resolveBaseUrl(req));

  if (!isReachableBaseUrl(desired)) {
    return NextResponse.json(
      {
        error:
          "URL webhook aplikasi masih menunjuk ke localhost/jaringan privat, jadi Fonnte tidak " +
          "bisa mengirim pesan masuk ke sana. Isi NEXT_PUBLIC_BASE_URL dengan domain publik " +
          "aplikasi lalu deploy ulang."
      },
      { status: 400 }
    );
  }

  const { devices } = await listStoreDevicesCompat(store);
  const targets = id ? devices.filter((d) => d.id === id) : devices;

  if (targets.length === 0) {
    return NextResponse.json({ error: "Nomor tidak ditemukan." }, { status: 404 });
  }

  const results = await Promise.all(
    targets.map(async (d) => {
      const h = await reconcileDeviceInbound({ store, device: d, desired, force: true });
      return { device: withInboundDiagnostics(d, desired, h), health: h };
    })
  );

  const failed = results.filter((r) => !r.health.webhookSynced || r.health.error);

  return NextResponse.json({
    success: failed.length === 0,
    devices: results.map((r) => r.device),
    error: failed.length > 0 ? failed[0].health.error : undefined
  });
}

/**
 * Gabungkan diagnosa jalur terima ke bentuk device yang dikirim ke browser.
 *
 * `health` hanya ada bila setelan baru dibaca langsung dari Fonnte; tanpa itu
 * jawabannya berbasis catatan database saja — dan itu ditandai lewat
 * `inbound_checked: false` supaya UI tidak memasang klaim yang tidak dia miliki.
 */
function withInboundDiagnostics(
  device: StoreDeviceRecord,
  desired: string,
  health?: DeviceInboundHealth
) {
  const base = toPublicDevice(device);
  const webhookSynced = health ? health.webhookSynced : isWebhookUrlSynced(device, desired);
  return {
    ...base,
    inbound_checked: !!health,
    autoread: health ? health.autoread : base.autoread,
    // `health.webhookAtFonnte` sudah disamarkan di `reconcileDeviceInbound`.
    webhook_url: health ? health.webhookAtFonnte : redactWebhookUrl(device.webhook_url),
    webhook_synced: webhookSynced,
    inbound_repaired: health?.repaired ?? false,
    // Hanya kendala jalur TERIMA. `health.error` juga memuat alasan device tidak
    // terhubung, dan itu sudah punya tempat sendiri di UI (badge status).
    inbound_error: webhookSynced ? undefined : health?.error
  };
}

export async function POST(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;
  const { email, store } = auth;

  if (!isStoreActive(store)) {
    return NextResponse.json(
      { error: "Masa uji coba sudah berakhir. Perpanjang langganan untuk menambah nomor." },
      { status: 403 }
    );
  }

  let body: { phone?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body request tidak valid." }, { status: 400 });
  }

  const phone = formatFonntePhone(String(body.phone || ""));
  if (phone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Nomor WhatsApp tidak valid." }, { status: 400 });
  }
  const label = String(body.label || "").trim().slice(0, 40) || null;

  const { devices, legacy } = await listStoreDevicesCompat(store);
  if (legacy) {
    return NextResponse.json(
      {
        error:
          "Fitur multi-nomor belum aktif di database. Jalankan ulang supabase/schema.sql di SQL Editor Supabase, lalu coba lagi."
      },
      { status: 409 }
    );
  }

  const limit = maxDevicesForPackage(store.package_id);
  if (devices.length >= limit) {
    const plan = getPlan(store.package_id);
    return NextResponse.json(
      {
        error:
          limit === 1
            ? `Paket ${plan?.name || "Starter"} hanya mendukung 1 nomor WhatsApp. Upgrade ke Pro untuk menambah nomor.`
            : `Paket ${plan?.name || "Pro"} mendukung maksimal ${limit} nomor WhatsApp.`,
        limit
      },
      { status: 403 }
    );
  }

  // Nomor harus unik lintas sistem: Fonnte menolak device kembar, dan webhook
  // merutekan pesan masuk berdasarkan nomor penerima.
  const existing = await getStoreDeviceByPhone(phone);
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.store_id === store.id
            ? "Nomor ini sudah terdaftar di toko Anda."
            : "Nomor ini sudah dipakai akun lain."
      },
      { status: 409 }
    );
  }

  const created = await createFonnteDevice(fonnteDeviceName(store.store_name, phone), phone);
  if (!created.success || !created.token) {
    return NextResponse.json(
      { error: created.error || "Gagal membuat device WhatsApp di Fonnte." },
      { status: 400 }
    );
  }

  const isPrimary = devices.length === 0;
  const inserted = await insertStoreDevice({
    store_id: store.id!,
    label,
    phone,
    fonnte_token: created.token,
    device_status: "DISCONNECTED",
    is_primary: isPrimary
  });

  if (!inserted.ok || !inserted.data) {
    // Device sudah ada di Fonnte tapi gagal disimpan — bersihkan supaya nomornya
    // tidak tersangkut dan bisa dicoba ulang.
    await deleteFonnteDevice(phone);
    return NextResponse.json(
      { error: inserted.error || "Gagal menyimpan nomor. Coba lagi." },
      { status: 500 }
    );
  }

  const device = inserted.data;
  // Daftarkan URL webhook + nyalakan `auto read` sejak nomor dibuat. Auto read
  // adalah syarat Fonnte untuk mengirim pesan masuk ke webhook; tanpa itu nomor
  // ini bisa mengirim balasan uji coba tapi tidak akan pernah menerima chat
  // pembeli — kegagalan yang paling membingungkan karena semuanya tampak normal.
  const synced = await syncDeviceWebhookUrl({
    store,
    device,
    desired: buildFonnteWebhookUrl(resolveBaseUrl(req))
  });

  // Cerminkan device utama ke kolom lama `stores` (dipakai OTP reset password).
  if (isPrimary) {
    await upsertStore({ email, fonnte_token: created.token, fonnte_device_status: "DISCONNECTED" });
  }

  return NextResponse.json({
    success: true,
    device: toPublicDevice(device),
    // Nomor tetap dibuat: kegagalan sinkronisasi bisa diperbaiki dari tombol
    // "Perbaiki otomatis" tanpa menambah nomor lagi.
    warning: synced.ok
      ? undefined
      : `Nomor tersimpan, tapi jalur pesan masuk belum siap: ${synced.error || "penyebab tidak diketahui"}`
  });
}

export async function DELETE(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;
  const { email, store } = auth;

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });

  const { devices, legacy } = await listStoreDevicesCompat(store);
  if (legacy) {
    return NextResponse.json(
      { error: "Fitur multi-nomor belum aktif di database. Jalankan ulang supabase/schema.sql." },
      { status: 409 }
    );
  }

  const target = devices.find((d) => d.id === id);
  if (!target) return NextResponse.json({ error: "Nomor tidak ditemukan." }, { status: 404 });

  // Hapus dulu di Fonnte, dan jadikan ini SYARAT. Kalau gagal, JANGAN hapus
  // baris DB — supaya dashboard dan Fonnte tidak pernah beda status, dan supaya
  // nomor tidak tersangkut di akun Fonnte (add-device menolak nomor kembar,
  // jadi nomor yang tersangkut tidak bisa disambungkan lagi selamanya).
  //
  // `deleteFonnteDevice` sudah mengulang gangguan sesaat sendiri, dan menganggap
  // nomor yang memang sudah tidak ada di Fonnte sebagai sukses. Jadi kegagalan
  // di sini berarti penolakan nyata, bukan jaringan yang kedip.
  const unlinked = await deleteFonnteDevice(target.phone);
  if (!unlinked.success) {
    return NextResponse.json(
      {
        error:
          "Nomor gagal dihapus dari Fonnte, jadi belum dihapus dari dashboard. " +
          `Coba lagi sebentar. Penyebab: ${unlinked.error || "tidak diketahui"}`
      },
      { status: 502 }
    );
  }

  const removed = await deleteStoreDevice(id, store.id!);
  if (!removed.ok) {
    return NextResponse.json({ error: removed.error || "Gagal menghapus nomor." }, { status: 500 });
  }

  // Selalu sisakan tepat satu device utama.
  const rest = devices.filter((d) => d.id !== id);
  if (target.is_primary) {
    const next = rest[0];
    if (next?.id) {
      await updateStoreDevice(next.id, { is_primary: true });
      await upsertStore({
        email,
        fonnte_token: next.fonnte_token || undefined,
        fonnte_device_status: next.device_status || "DISCONNECTED",
        webhook_url: next.webhook_url || null
      });
    } else {
      // Tidak ada nomor tersisa — kosongkan cermin di `stores`.
      await upsertStore({
        email,
        fonnte_token: "",
        fonnte_device_status: "DISCONNECTED",
        webhook_url: null
      });
    }
  }

  // Sampai di sini device SUDAH terhapus di Fonnte (itu syarat di atas), jadi
  // tidak ada lagi kondisi "terhapus separuh" yang perlu diperingatkan ke user.
  return NextResponse.json({ success: true });
}
