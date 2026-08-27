import { NextResponse } from "next/server";
import {
  getStoreByEmail,
  upsertStore,
  getAllConversations,
  getProductsByStoreId,
  listBuyerOrders,
  listStoreDevicesCompat,
  storeActivityState,
  toPublicDevice
} from "@/lib/supabase";
import { getFonnteDeviceStatus } from "@/lib/fonnte";
import { daysUntil, maxDevicesForPackage } from "@/lib/packages";
import { normalizeActiveCouriers, normalizeLocalCourier } from "@/lib/couriers";
import { normalizeAiTone, normalizePaymentAccounts } from "@/lib/reply-format";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store Configuration API (GET store settings, conversations, and Fonnte status; POST update store config)
 * Email diambil dari cookie session — bukan dari query/body — supaya user hanya bisa akses tokonya sendiri.
 *
 * `?light=1` melewati panggilan status device ke Fonnte (API eksternal, ~ratusan ms).
 * Dipakai untuk polling berkala & refetch setelah mutasi, di mana status koneksi
 * WhatsApp tidak berubah — jadi tidak perlu dibayar setiap kali.
 */
export async function GET(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  const light = new URL(req.url).searchParams.get("light") === "1";

  try {
    const store = await getStoreByEmail(email);
    if (!store) {
      // Store dibuat saat pembayaran PAID; kalau belum ada berarti akun belum aktif.
      return NextResponse.json({
        store: null,
        fonnteStatus: { status: false, device: "DISCONNECTED" },
        conversations: [],
        products: [],
        devices: [],
        deviceLimit: maxDevicesForPackage(null),
        devicesNeedMigration: false,
        buyerOrders: [],
        ordersNeedMigration: false,
        activity: { state: "inactive", active: false, endsAt: null, daysLeft: null }
      });
    }

    // Empat query independen — jalankan paralel supaya latensi tidak menumpuk.
    const [conversations, products, deviceList, buyerOrders] = await Promise.all([
      store?.id ? getAllConversations(store.id) : Promise.resolve([]),
      store?.id ? getProductsByStoreId(store.id) : Promise.resolve([]),
      listStoreDevicesCompat(store),
      store?.id ? listBuyerOrders(store.id) : Promise.resolve([])
    ]);
    const { devices, legacy } = deviceList;

    // Status koneksi WhatsApp yang ditampilkan di header = device UTAMA. Status
    // tiap nomor lainnya di-refresh terpisah lewat /api/fonnte/devices?status=1
    // supaya memuat dashboard tidak berarti 3 panggilan ke Fonnte.
    const primaryToken =
      devices.find((d) => d.is_primary)?.fonnte_token || store.fonnte_token || "";

    let fonnteStatus: { status: boolean; device?: string; reason?: string } | null = {
      status: false,
      device: "DISCONNECTED",
      reason: "Token Fonnte belum di-set"
    };
    if (light) {
      // Biarkan client mempertahankan status yang sudah ada.
      fonnteStatus = null;
    } else if (primaryToken) {
      fonnteStatus = await getFonnteDeviceStatus(primaryToken);
    }

    // Jangan bocorkan hash password / OTP reset / kredensial pihak ketiga ke
    // client. Token device Fonnte & API key Mengantar cukup diwakili boolean —
    // dashboard hanya perlu tahu "sudah terpasang atau belum", dan token yang
    // tidak pernah dikirim ke browser tidak bisa bocor lewat log/ekstensi.
    const {
      password_hash: _omitPw,
      reset_otp_hash: _omitOtp,
      reset_otp_expires: _omitOtpExp,
      reset_otp_attempts: _omitOtpTries,
      fonnte_token: fonnteToken,
      mengantar_api_key: mengantarKey,
      ...safeStore
    } = store;

    // Status masa aktif: dashboard perlu ini untuk menampilkan layar terkunci &
    // peringatan "langganan habis dalam N hari". Dihitung di server supaya
    // aturannya satu — sama dengan yang dipakai webhook menolak pesan masuk.
    const state = storeActivityState(store);
    const endsAt =
      state === "trial" || state === "trial_expired"
        ? store.trial_ends_at || null
        : store.subscription_ends_at || null;

    return NextResponse.json({
      store: {
        ...safeStore,
        has_fonnte_token: !!fonnteToken,
        has_mengantar_api_key: !!mengantarKey
      },
      fonnteStatus,
      conversations,
      products,
      devices: devices.map(toPublicDevice),
      deviceLimit: maxDevicesForPackage(store.package_id),
      devicesNeedMigration: legacy,
      // `null` dari listBuyerOrders = tabel pesanan belum ada (SQL terbaru belum
      // dijalankan). Dibedakan dari daftar kosong supaya dashboard menampilkan
      // ajakan menjalankan migrasi, bukan "belum ada pesanan".
      buyerOrders: buyerOrders || [],
      ordersNeedMigration: buyerOrders === null,
      activity: {
        state,
        active: state === "active" || state === "trial",
        endsAt,
        daysLeft: daysUntil(endsAt)
      }
    });
  } catch (err) {
    console.error("[store] GET gagal:", err);
    return NextResponse.json({ error: "Gagal memuat data toko." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Whitelist ketat: HANYA kolom yang boleh diedit user dari dashboard.
    // Ini mencegah eskalasi hak (mis. mengubah is_paid, trial_ends_at,
    // coupon_used, fonnte_token, atau password lewat body request).
    const settings: Record<string, unknown> = {};
    if (typeof body.store_name === "string" && body.store_name.trim())
      settings.store_name = body.store_name.trim().slice(0, 120);
    if (typeof body.origin_city_name === "string")
      settings.origin_city_name = body.origin_city_name.trim().slice(0, 160);
    if (typeof body.origin_subdistrict_id === "string")
      settings.origin_subdistrict_id = body.origin_subdistrict_id.trim().slice(0, 64);
    if (body.default_weight !== undefined) {
      const w = Number(body.default_weight);
      // Clamp 100 g – 50 kg: di luar itu pasti salah input, dan berat konyol
      // membuat tarif Mengantar ikut konyol.
      settings.default_weight = Number.isFinite(w) && w > 0 ? Math.min(50000, Math.max(100, Math.round(w))) : 1000;
    }
    if (typeof body.ai_prompt_system === "string")
      settings.ai_prompt_system = body.ai_prompt_system.slice(0, 4000);
    if (typeof body.greeting_message === "string")
      settings.greeting_message = body.greeting_message.slice(0, 1000);
    // `mengantar_api_key` SENGAJA tidak ada di whitelist ini. Kedua endpoint
    // Mengantar yang dipakai aplikasi (`address/search` & `allEstimatePublic`)
    // tidak memvalidasi key, jadi kolom itu tidak pernah menentukan akurasi
    // ongkir — yang menentukan adalah lokasi asal toko. Inputnya sudah dihapus
    // dari dashboard supaya pemilik toko tidak mengira sedang memperbaiki
    // sesuatu; nilai yang sudah tersimpan tetap dipakai apa adanya, dan key
    // tingkat sistem diatur lewat ENV `MENGANTAR_API_KEY`.

    // ── Ekspedisi, kurir toko, pembayaran, & gaya jawaban AI ────────────────
    // Semua nilai di bawah ini akhirnya DIKIRIM KE PEMBELI lewat WhatsApp, jadi
    // panjangnya dibatasi dan kode yang tidak dikenal dibuang senyap — bukan
    // diteruskan apa adanya ke prompt AI atau ke teks balasan.
    if (body.active_couriers !== undefined) {
      // Array kosong sengaja disimpan sebagai `[]` (bukan null): keduanya
      // bermakna "semua ekspedisi", dan menyimpan apa yang dikirim dashboard
      // membuat perbandingan dirty di klien tetap jujur.
      settings.active_couriers = normalizeActiveCouriers(body.active_couriers);
    }
    if (body.local_courier !== undefined) {
      settings.local_courier = normalizeLocalCourier(body.local_courier);
    }
    if (body.payment_accounts !== undefined) {
      settings.payment_accounts = normalizePaymentAccounts(body.payment_accounts);
    }
    if (body.cod_enabled !== undefined) {
      settings.cod_enabled = body.cod_enabled === true;
    }
    if (typeof body.payment_note === "string") {
      settings.payment_note = body.payment_note.trim().slice(0, 600) || null;
    }
    if (body.ai_tone !== undefined) {
      // Nilai tak dikenal jatuh ke default, tidak ditolak: nada bicara bukan
      // alasan yang layak membuat seluruh penyimpanan pengaturan gagal.
      settings.ai_tone = normalizeAiTone(body.ai_tone);
    }
    if (body.ai_include_total !== undefined) {
      settings.ai_include_total = body.ai_include_total === true;
    }
    if (body.ai_include_payment !== undefined) {
      settings.ai_include_payment = body.ai_include_payment === true;
    }

    // ── Pemberitahuan ke pemilik toko ───────────────────────────────────────
    if (typeof body.alert_phone === "string") {
      // Hanya digit & tanda plus disimpan: nomor ini dipakai langsung sebagai
      // target kirim WhatsApp, jadi spasi/tanda hubung yang lolos akan membuat
      // kabar penting gagal terkirim tanpa penjelasan.
      const cleaned = body.alert_phone.replace(/[^\d+]/g, "").slice(0, 20);
      settings.alert_phone = cleaned || null;
    }
    if (body.notify_enabled !== undefined) {
      settings.notify_enabled = body.notify_enabled === true;
    }

    if (Object.keys(settings).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang valid untuk disimpan." }, { status: 400 });
    }

    const result = await upsertStore({
      email,
      ...settings
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Gagal menyimpan konfigurasi toko." }, { status: 500 });
    }

    const saved = result.data
      ? (({
          password_hash: _omitPw,
          reset_otp_hash: _omitOtp,
          reset_otp_expires: _omitOtpExp,
          fonnte_token: fonnteToken,
          mengantar_api_key: mengantarKey,
          ...rest
        }) => ({
          ...rest,
          has_fonnte_token: !!fonnteToken,
          has_mengantar_api_key: !!mengantarKey
        }))(result.data)
      : null;
    return NextResponse.json({ success: true, store: saved });
  } catch (err) {
    console.error("[store] POST gagal:", err);
    return NextResponse.json({ error: "Gagal menyimpan konfigurasi toko." }, { status: 500 });
  }
}
