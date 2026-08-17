import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import {
  createFonnteDevice,
  deleteFonnteDevice,
  formatFonntePhone,
  getFonnteDeviceStatus
} from "@/lib/fonnte";
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
  type StoreRecord
} from "@/lib/supabase";
import {
  buildFonnteWebhookUrl,
  fonnteDeviceName,
  resolveBaseUrl,
  syncDeviceWebhookUrl
} from "@/lib/webhook-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kelola nomor WhatsApp (device Fonnte) milik satu toko.
 *
 * Jumlah nomor dibatasi paket — Starter 1, Pro 3 — dan batas itu DITEGAKKAN di
 * sini, bukan cuma dijanjikan di halaman harga.
 *
 *   GET    ?status=1  → daftar nomor (opsional: segarkan status dari Fonnte)
 *   POST   { phone, label? }
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

  if (refreshStatus) {
    // Satu panggilan Fonnte per device — jalankan paralel supaya latensi tidak
    // menumpuk saat toko punya 3 nomor.
    await Promise.all(
      devices.map(async (d) => {
        if (!d.fonnte_token) return;
        const status = await getFonnteDeviceStatus(d.fonnte_token);
        const next = status.status ? "CONNECTED" : "DISCONNECTED";
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
    devices: devices.map(toPublicDevice),
    limit,
    planName: getPlan(store.package_id)?.name || "Starter",
    canAddMore: !legacy && devices.length < limit,
    // true = tabel `store_devices` belum ada/belum terisi; nomor di bawah dibaca
    // dari kolom lama `stores` dan penambahan nomor belum bisa dipakai.
    needsMigration: legacy
  });
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
  await syncDeviceWebhookUrl({
    store,
    device,
    desired: buildFonnteWebhookUrl(resolveBaseUrl(req))
  });

  // Cerminkan device utama ke kolom lama `stores` (dipakai OTP reset password).
  if (isPrimary) {
    await upsertStore({ email, fonnte_token: created.token, fonnte_device_status: "DISCONNECTED" });
  }

  return NextResponse.json({ success: true, device: toPublicDevice(device) });
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

  // Lepas dulu di Fonnte, kalau tidak nomornya tetap tersangkut di akun dan
  // tidak bisa disambungkan lagi. Gagal di sini tidak menghalangi penghapusan.
  const unlinked = await deleteFonnteDevice(target.phone);

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

  return NextResponse.json({
    success: true,
    fonnteUnlinked: unlinked.success,
    warning: unlinked.success
      ? undefined
      : "Nomor sudah dilepas dari dashboard, tapi belum terhapus di Fonnte. Hapus manual dari dashboard Fonnte bila ingin memakainya lagi."
  });
}
