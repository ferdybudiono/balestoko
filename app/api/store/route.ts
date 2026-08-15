import { NextResponse } from "next/server";
import { getStoreByEmail, upsertStore, getAllConversations, getProductsByStoreId } from "@/lib/supabase";
import { getFonnteDeviceStatus } from "@/lib/fonnte";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store Configuration API (GET store settings, conversations, and Fonnte status; POST update store config)
 * Email diambil dari cookie session — bukan dari query/body — supaya user hanya bisa akses tokonya sendiri.
 */
export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  try {
    const store = await getStoreByEmail(email);
    if (!store) {
      // Store dibuat saat pembayaran PAID; kalau belum ada berarti akun belum aktif.
      return NextResponse.json({ store: null, fonnteStatus: { status: false, device: "DISCONNECTED" }, conversations: [], products: [] });
    }

    let fonnteStatus: { status: boolean; device?: string; reason?: string } = {
      status: false,
      device: "DISCONNECTED",
      reason: "Token Fonnte belum di-set"
    };
    if (store?.fonnte_token) {
      fonnteStatus = await getFonnteDeviceStatus(store.fonnte_token);
    }

    const conversations = store?.id ? await getAllConversations(store.id) : [];
    const products = store?.id ? await getProductsByStoreId(store.id) : [];

    // Jangan bocorkan hash password / OTP reset ke client.
    const {
      password_hash: _omitPw,
      reset_otp_hash: _omitOtp,
      reset_otp_expires: _omitOtpExp,
      ...safeStore
    } = store;

    return NextResponse.json({
      store: safeStore,
      fonnteStatus,
      conversations,
      products
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
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
      settings.store_name = body.store_name.trim();
    if (typeof body.origin_city_name === "string")
      settings.origin_city_name = body.origin_city_name.trim();
    if (typeof body.origin_subdistrict_id === "string")
      settings.origin_subdistrict_id = body.origin_subdistrict_id.trim();
    if (body.default_weight !== undefined) {
      const w = Number(body.default_weight);
      settings.default_weight = Number.isFinite(w) && w > 0 ? Math.round(w) : 1000;
    }
    if (typeof body.ai_prompt_system === "string")
      settings.ai_prompt_system = body.ai_prompt_system;
    if (typeof body.greeting_message === "string")
      settings.greeting_message = body.greeting_message;
    if (typeof body.mengantar_api_key === "string")
      settings.mengantar_api_key = body.mengantar_api_key.trim();

    const result = await upsertStore({
      email,
      ...settings
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Gagal menyimpan konfigurasi toko." }, { status: 500 });
    }

    const saved = result.data
      ? (({ password_hash: _omitPw, reset_otp_hash: _omitOtp, reset_otp_expires: _omitOtpExp, ...rest }) => rest)(result.data)
      : null;
    return NextResponse.json({ success: true, store: saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
