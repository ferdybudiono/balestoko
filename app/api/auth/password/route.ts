import { NextResponse } from "next/server";
import {
  bumpRateLimit,
  getStoreByEmail,
  getStoreMemberByEmail,
  updateStoreMember,
  upsertStore
} from "@/lib/supabase";
import {
  getSessionActor,
  hashPassword,
  passwordChangedAt,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";
import { MIN_PASSWORD, minPasswordError } from "@/lib/password-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_SECONDS = 3600;
/** Batas per akun: menghambat penebakan kata sandi lama lewat endpoint ini. */
const MAX_PER_ACTOR_PER_HOUR = 10;
/** Batas per IP: supaya berganti-ganti akun tidak melewati batas di atas. */
const MAX_PER_IP_PER_HOUR = 30;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Ganti kata sandi sendiri, saat sudah login.
 *
 * Sebelumnya satu-satunya cara mengganti kata sandi adalah OTP lewat WhatsApp —
 * dan itu tidak selalu tersedia (lihat `auth/reset/request`). Endpoint ini
 * melayani pemilik toko maupun anggota tim, masing-masing terhadap barisnya
 * sendiri, dan SELALU meminta kata sandi lama: sesi yang dicuri tidak boleh cukup
 * untuk mengunci pemilik aslinya keluar dari akunnya.
 *
 * Dua hal yang wajib benar di sini:
 *
 * 1. `password_changed_at` DITULIS. Kolom itulah yang mencabut sesi lain
 *    (`getSessionActor` menolak token yang terbit sebelumnya). Tanpa itu, ganti
 *    kata sandi tidak mengusir siapa pun sampai TTL 7 hari habis — persis yang
 *    ingin dilakukan orang yang baru menyadari akunnya dipakai orang lain.
 *
 * 2. Cookie pemanggil DITERBITKAN ULANG sesudahnya. Pencabutan di atas berlaku
 *    untuk SEMUA sesi termasuk sesi yang sedang dipakai, jadi tanpa cookie baru
 *    user langsung terlempar ke /login tepat setelah berhasil.
 */
export async function POST(req: Request) {
  const actor = await getSessionActor();
  if (!actor) {
    return NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";

  if (!currentPassword) {
    return NextResponse.json({ error: "Kata sandi saat ini wajib diisi." }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: minPasswordError("Kata sandi baru") },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "Kata sandi baru harus berbeda dari yang sekarang." },
      { status: 400 }
    );
  }

  const TOO_MANY = { error: "Terlalu banyak percobaan. Coba lagi nanti." };
  const byIp = await bumpRateLimit(`pwd:ip:${clientIp(req)}`, HOUR_SECONDS, MAX_PER_IP_PER_HOUR);
  if (!byIp.allowed) {
    return NextResponse.json(TOO_MANY, {
      status: 429,
      headers: { "Retry-After": String(byIp.retryAfterSec) }
    });
  }
  const byActor = await bumpRateLimit(
    `pwd:actor:${actor.email}`,
    HOUR_SECONDS,
    MAX_PER_ACTOR_PER_HOUR
  );
  if (!byActor.allowed) {
    return NextResponse.json(TOO_MANY, {
      status: 429,
      headers: { "Retry-After": String(byActor.retryAfterSec) }
    });
  }

  const WRONG = { error: "Kata sandi saat ini salah." };
  const changedAt = passwordChangedAt();

  if (actor.isMember) {
    // Anggota tim mengubah barisnya sendiri di `store_members`. Toko induknya
    // diambil dari baris itu, bukan dari sesi, jadi tidak ada cara mengarahkan
    // perubahan ke toko lain.
    const member = await getStoreMemberByEmail(actor.email);
    if (!member?.id || !member.password_hash) {
      return NextResponse.json({ error: "Akun tidak ditemukan." }, { status: 404 });
    }
    if (!verifyPassword(currentPassword, member.password_hash)) {
      return NextResponse.json(WRONG, { status: 401 });
    }

    const saved = await updateStoreMember(member.id, member.store_id, {
      password_hash: hashPassword(newPassword),
      password_changed_at: changedAt
    });
    if (!saved.ok) {
      return NextResponse.json(
        { error: saved.error || "Gagal menyimpan kata sandi baru." },
        { status: 500 }
      );
    }

    await setSessionCookie(actor.email, actor.storeEmail);
  } else {
    const store = await getStoreByEmail(actor.storeEmail);
    if (!store?.password_hash) {
      return NextResponse.json({ error: "Akun tidak ditemukan." }, { status: 404 });
    }
    if (!verifyPassword(currentPassword, store.password_hash)) {
      return NextResponse.json(WRONG, { status: 401 });
    }

    const saved = await upsertStore({
      email: actor.storeEmail,
      password_hash: hashPassword(newPassword),
      password_changed_at: changedAt,
      // Kata sandi sudah berganti lewat jalur yang terbukti memiliki akun ini,
      // jadi OTP reset yang masih menggantung tidak boleh tetap bisa dipakai.
      reset_otp_hash: null,
      reset_otp_expires: null,
      reset_otp_attempts: 0
    });
    if (!saved.ok) {
      return NextResponse.json(
        { error: saved.error || "Gagal menyimpan kata sandi baru." },
        { status: 500 }
      );
    }

    await setSessionCookie(actor.storeEmail);
  }

  return NextResponse.json({
    success: true,
    message: "Kata sandi diperbarui. Sesi di perangkat lain sudah dikeluarkan."
  });
}
