import { NextResponse } from "next/server";
import crypto from "crypto";
import { getPlan, isPackageId } from "@/lib/packages";
import { createSnapTransaction } from "@/lib/midtrans";
import { insertPendingOrder, getStoreByEmail } from "@/lib/supabase";
import { hashPassword } from "@/lib/auth";
import { validateCouponForPlan, applyDiscount } from "@/lib/coupons";

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

/** Normalisasi nomor WA Indonesia: 08xx / +62 / 62 -> 62xxxx */
function normalizePhone(raw: string): string {
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "62" + p.slice(1);
  if (!p.startsWith("62")) p = "62" + p;
  return p;
}

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
  if (!password || password.length < 6) {
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

    // Kupon hanya untuk AKUN BARU & sekali pakai. Cek toko yang sudah ada.
    const existing = await getStoreByEmail(email.trim());
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
  const phone = normalizePhone(whatsapp);

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    req.headers.get("origin") ||
    "http://localhost:3000";

  try {
    // 1) Minta Snap token ke Midtrans
    const snap = await createSnapTransaction({
      orderId,
      grossAmount,
      customer: {
        first_name: firstName,
        last_name: rest.join(" ") || undefined,
        email: email.trim(),
        phone,
      },
      items: [
        {
          id: plan.id,
          name: appliedCoupon
            ? `Paket ${plan.name} (Kupon ${appliedCoupon})`
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
      },
      callbackFinishUrl: `${baseUrl}/?order=${orderId}`,
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
      customer_email: email.trim(),
      store_name: storeName.trim(),
      password_hash: hashPassword(password),
      coupon_code: appliedCoupon,
      snap_token: snap.token,
    });

    // 3) Kembalikan token supaya browser bisa memicu snap.pay(token)
    return NextResponse.json({
      token: snap.token,
      redirect_url: snap.redirect_url,
      order_id: orderId,
      persisted: saved.ok,
    });
  } catch (err) {
    console.error("[checkout] error:", err);
    const message =
      err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
