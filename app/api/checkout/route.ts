import { NextResponse } from "next/server";
import crypto from "crypto";
import { getPlan, isPackageId } from "@/lib/packages";
import { createSnapTransaction } from "@/lib/midtrans";
import { insertPendingOrder, getStoreByEmail, normalizeEmail } from "@/lib/supabase";
import { formatFonntePhone } from "@/lib/fonnte";
import { hashPassword, getSessionEmail } from "@/lib/auth";
import { validateCouponForPlan, applyDiscount } from "@/lib/coupons";
import { resolveCallbackBaseUrl } from "@/lib/webhook-url";

// Route ini butuh Node runtime (pakai crypto & Buffer) dan selalu dinamis.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckoutBody {
  packageId?: string;
  name?: string;
  whatsapp?: string;
  email?: string;
  storeName?: string;
  password?: string;
  coupon?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


/** order_id unik & mudah dilacak: ORDER-PRO-1733650000000-a1b2c3 */
function generateOrderId(packageId: string): string {
  const rand = crypto.randomBytes(3).toString("hex");
  return `ORDER-${packageId.toUpperCase()}-${Date.now()}-${rand}`;
}

export async function POST(req: Request) {
  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json(
      { error: "Body request tidak valid (bukan JSON)." },
      { status: 400 }
    );
  }

  const { packageId, name, whatsapp, email, storeName, password, coupon } = body;

  // ---- Validasi input ----
  if (!isPackageId(packageId)) {
    return NextResponse.json(
      { error: "Paket tidak dikenali. Pilih 'starter' atau 'pro'." },
      { status: 400 }
    );
  }
  if (!name || name.trim().length < 3) {
    return NextResponse.json(
      { error: "Nama lengkap wajib diisi (min. 3 karakter)." },
      { status: 400 }
    );
  }
  if (!whatsapp || whatsapp.replace(/\D/g, "").length < 9) {
    return NextResponse.json(
      { error: "Nomor WhatsApp tidak valid." },
      { status: 400 }
    );
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Email tidak valid." },
      { status: 400 }
    );
  }
  if (!storeName || storeName.trim().length < 2) {
    return NextResponse.json(
      { error: "Nama toko wajib diisi." },
      { status: 400 }
    );
  }

  // Titik masuk JALUR UANG. Normalisasi di sini yang menentukan apakah pembayaran
  // mendarat di akun yang sudah ada atau membuat toko kedua: `getStoreByEmail` di
  // bawah dan `applyPaidOrderToStore` (saat webhook Midtrans melunasi order) harus
  // melihat email yang sama persis, dan `customer_email` order ikut disimpan
  // ternormalisasi supaya keduanya tidak bisa melenceng.
  const cleanEmail = normalizeEmail(email);

  // ---- Akun baru atau perpanjangan? ----
  //
  // Pemeriksaan ini dilakukan SEBELUM apa pun dan tanpa syarat (dulu hanya ada di
  // dalam cabang kupon). Order menyimpan hash password dari form ini, dan order
  // yang lunas akan diterapkan ke tabel `stores` — jadi checkout atas email yang
  // sudah terdaftar wajib membuktikan kepemilikan lebih dulu. Kalau tidak, siapa
  // pun yang tahu email orang lain bisa membayar paket dan mengambil alih akunnya.
  const existing = await getStoreByEmail(cleanEmail);
  const isRenewal = !!existing;

  if (isRenewal) {
    const sessionEmail = await getSessionEmail();
    if (normalizeEmail(sessionEmail) !== cleanEmail) {
      return NextResponse.json(
        {
          error:
            "Email ini sudah terdaftar. Silakan login dulu, lalu ulangi pembayaran dari dashboard " +
            "untuk memperpanjang atau upgrade paket.",
          needsLogin: true,
        },
        { status: 409 }
      );
    }
  }

  // Password hanya relevan untuk akun BARU. Pada perpanjangan, apa pun yang
  // diisi di form diabaikan — kredensial akun yang sudah ada tidak boleh
  // tersentuh oleh alur pembayaran.
  if (!isRenewal && (!password || password.length < 6)) {
    return NextResponse.json(
      { error: "Kata sandi wajib diisi (min. 6 karakter)." },
      { status: 400 }
    );
  }

  // ---- Harga OTORITATIF dari server (bukan dari client) ----
  const plan = getPlan(packageId)!;
  const orderId = generateOrderId(plan.id);
  let grossAmount = plan.price;
  let appliedCoupon: string | null = null;

  // ---- Validasi & terapkan kupon (opsional) ----
  const couponRaw = (coupon || "").trim();
  if (couponRaw) {
    const check = validateCouponForPlan(couponRaw, plan.id);
    if (!check.valid || !check.coupon) {
      return NextResponse.json(
        { error: check.error || "Kupon tidak valid." },
        { status: 400 }
      );
    }

    // Kupon hanya untuk AKUN BARU & sekali pakai. `existing` sudah diambil di atas.
    if (existing?.is_paid) {
      return NextResponse.json(
        { error: "Kupon hanya berlaku untuk akun baru yang belum berlangganan." },
        { status: 400 }
      );
    }
    if (existing?.coupon_used) {
      return NextResponse.json(
        { error: "Kupon sudah pernah dipakai pada akun ini." },
        { status: 400 }
      );
    }

    grossAmount = applyDiscount(plan.price, check.coupon.discountPercent);
    appliedCoupon = check.coupon.code;
  }

  const cleanName = name.trim();
  const [firstName, ...rest] = cleanName.split(/\s+/);
  // `formatFonntePhone` (lib/fonnte.ts) melakukan normalisasi yang sama persis dan
  // dipakai jalur pendaftaran trial. Satu fungsi untuk satu aturan: kalau formatnya
  // pernah berubah di satu tempat saja, nomor pemilik toko yang sama bisa tersimpan
  // dalam dua bentuk berbeda antara order dan akunnya.
  const phone = formatFonntePhone(whatsapp);

  // Pembeli pulang ke domain yang BENAR-BENAR dia pakai (aplikasi ini dilayani
  // di beberapa domain, dan cookie sesi terikat host — dilempar ke domain lain
  // sesudah bayar membuatnya tampak logout). Origin hanya dihormati bila cocok
  // dengan domain yang terdaftar di ENV; lihat `resolveCallbackBaseUrl`.
  const baseUrl = resolveCallbackBaseUrl(req);

  try {
    // 1) Minta Snap token ke Midtrans
    const snap = await createSnapTransaction({
      orderId,
      grossAmount,
      customer: {
        first_name: firstName,
        last_name: rest.join(" ") || undefined,
        email: cleanEmail,
        phone,
      },
      items: [
        {
          id: plan.id,
          // Nama item ini muncul di struk Midtrans pembeli, jadi harus jujur:
          // "perpanjangan" hanya benar bila langganannya memang sudah berjalan.
          // Akun uji coba yang baru berbayar pertama kali BUKAN perpanjangan.
          name: appliedCoupon
            ? `Paket ${plan.name} (Kupon ${appliedCoupon})`
            : existing?.is_paid
            ? `Perpanjangan Paket ${plan.name} - Bot WA CS AI`
            : `Paket ${plan.name} - Bot WA CS AI`,
          price: grossAmount,
          quantity: 1,
        },
      ],
      metadata: {
        package_id: plan.id,
        package_name: plan.name,
        store_name: storeName.trim(),
        whatsapp: phone,
        coupon: appliedCoupon,
        is_renewal: isRenewal,
      },
      callbackFinishUrl: `${baseUrl}/?order=${orderId}`,
      // Kunci URL webhook ke project ini (header X-Override-Notification).
      // Akun Midtrans yang sama dipakai beberapa project dan dashboard hanya
      // punya satu Payment Notification URL — tanpa ini, notifikasi pembayaran
      // bisa terkirim ke project lain dan order di sini tersangkut PENDING.
      // Daftar domainnya dibaca dari ENV; nilai ini hanya cadangan untuk
      // dev/preview yang ENV-nya belum di-set.
      notificationBaseUrl: baseUrl,
    });

    // 2) Simpan order status PENDING ke Supabase (best-effort)
    const saved = await insertPendingOrder({
      order_id: orderId,
      package_id: plan.id,
      package_name: plan.name,
      gross_amount: grossAmount,
      status: "PENDING",
      customer_name: cleanName,
      customer_phone: phone,
      customer_email: cleanEmail,
      store_name: storeName.trim(),
      // Perpanjangan tidak pernah membawa hash password. Kalaupun logika di
      // hilir berubah, tidak ada kredensial di order ini yang bisa menimpa akun.
      password_hash: isRenewal ? null : hashPassword(password!),
      coupon_code: appliedCoupon,
      is_renewal: isRenewal,
      snap_token: snap.token,
    });

    // 3) Kembalikan token supaya browser bisa memicu snap.pay(token)
    return NextResponse.json({
      token: snap.token,
      redirect_url: snap.redirect_url,
      order_id: orderId,
      persisted: saved.ok,
      is_renewal: isRenewal,
    });
  } catch (err) {
    console.error("[checkout] error:", err);
    const message =
      err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
