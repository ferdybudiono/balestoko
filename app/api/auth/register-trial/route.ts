import { NextResponse } from "next/server";
import {
  bumpRateLimit,
  getStoreByEmail,
  getStoreMemberByEmail,
  normalizeEmail,
  upsertStore
} from "@/lib/supabase";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { MIN_PASSWORD, minPasswordError } from "@/lib/password-policy";
import { formatFonntePhone } from "@/lib/fonnte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRIAL_DAYS = 7;

const DAY_SECONDS = 86400;
/**
 * Batas pendaftaran trial per alamat IP per hari.
 *
 * Ini satu-satunya jalur auth yang MEMBERIKAN sesuatu (akses setara paket Pro
 * selama 7 hari) tanpa pembayaran, jadi ia juga satu-satunya yang tidak boleh
 * dibiarkan tanpa batas: tanpa ini satu skrip bisa membuat ribuan akun.
 *
 * Sengaja longgar, bukan seketat login: banyak pengguna Indonesia berbagi satu IP
 * publik (CGNAT operator seluler, kantor, warnet), dan memblokir pendaftar sungguhan
 * jauh lebih mahal daripada membiarkan beberapa trial berlebih lolos.
 */
const TRIAL_MAX_PER_IP_PER_DAY = 3;
/**
 * Batas per NOMOR WhatsApp — pembatas yang sesungguhnya.
 *
 * Nomor WhatsApp jauh lebih mahal dikumpulkan daripada alamat email atau IP, dan
 * satu nomor hanya bisa dipakai sekali sebagai device di seluruh sistem
 * (`store_devices_phone_uidx`), jadi trial kedua atas nomor yang sama tidak
 * pernah berguna bagi pendaftar yang sah.
 */
const TRIAL_MAX_PER_PHONE_PER_DAY = 1;

/** IP pemanggil di belakang proxy Vercel. */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Pendaftaran UJI COBA 7 HARI tanpa pembayaran.
 * Membuat akun toko dengan `trial_ends_at = now + 7 hari`, lalu langsung
 * memberi session supaya user bisa mencoba dashboard.
 */
export async function POST(req: Request) {
  let body: {
    name?: string;
    whatsapp?: string;
    email?: string;
    storeName?: string;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const email = normalizeEmail(body.email);
  const storeName = (body.storeName || "").trim();
  const password = body.password || "";
  const whatsapp = body.whatsapp || "";

  if (name.length < 3) {
    return NextResponse.json({ error: "Nama lengkap wajib diisi (min. 3 karakter)." }, { status: 400 });
  }
  if (whatsapp.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "Nomor WhatsApp tidak valid." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Email tidak valid." }, { status: 400 });
  }
  if (storeName.length < 2) {
    return NextResponse.json({ error: "Nama toko wajib diisi." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: minPasswordError() }, { status: 400 });
  }

  const phone = formatFonntePhone(whatsapp);

  // Batas per IP lebih dulu: ia juga membendung penyapuan email lewat balasan 409
  // di bawah. Ditegakkan di database supaya berlaku lintas instance serverless,
  // dan gagal-terbuka bila database bermasalah (pendaftaran tidak boleh mati total
  // hanya karena penghitungnya tidak bisa dibaca).
  const TOO_MANY = {
    error:
      "Terlalu banyak pendaftaran uji coba dari jaringan ini hari ini. " +
      "Coba lagi besok, atau langsung berlangganan.",
  };
  const byIp = await bumpRateLimit(`trial:ip:${clientIp(req)}`, DAY_SECONDS, TRIAL_MAX_PER_IP_PER_DAY);
  if (!byIp.allowed) {
    return NextResponse.json(TOO_MANY, {
      status: 429,
      headers: { "Retry-After": String(byIp.retryAfterSec) },
    });
  }

  // Email harus baru. Jika sudah ada toko (trial/berbayar) → arahkan login.
  const existing = await getStoreByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "Email sudah terdaftar. Silakan login." },
      { status: 409 }
    );
  }

  // Email yang sudah dipakai sebagai ANGGOTA TIM toko lain juga harus ditolak.
  // Login mencoba jalur pemilik lebih dulu, jadi akun pemilik baru dengan email
  // yang sama akan MENUTUP akses anggota itu — dan tidak ada satu pun tempat di UI
  // yang bisa menjelaskan kenapa kredensialnya berhenti bekerja.
  const asMember = await getStoreMemberByEmail(email);
  if (asMember) {
    return NextResponse.json(
      {
        error:
          "Email ini sudah dipakai sebagai akun anggota tim di toko lain. " +
          "Gunakan email lain, atau login dengan akun tersebut.",
      },
      { status: 409 }
    );
  }

  // Batas per nomor DIHITUNG setelah pemeriksaan di atas, supaya salah ketik email
  // (yang berujung 409) tidak menghanguskan satu-satunya jatah nomor hari itu.
  const byPhone = await bumpRateLimit(`trial:phone:${phone}`, DAY_SECONDS, TRIAL_MAX_PER_PHONE_PER_DAY);
  if (!byPhone.allowed) {
    return NextResponse.json(
      {
        error:
          "Nomor WhatsApp ini sudah dipakai untuk mendaftar uji coba. " +
          "Silakan login ke akun tersebut, atau pakai nomor lain.",
      },
      { status: 429, headers: { "Retry-After": String(byPhone.retryAfterSec) } }
    );
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await upsertStore({
    email,
    store_name: storeName,
    customer_name: name,
    customer_phone: phone,
    password_hash: hashPassword(password),
    is_paid: false,
    trial_ends_at: trialEndsAt,
    // Trial diberi akses setara paket Pro supaya bisa mencoba semua fitur.
    package_id: "pro",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.skipped ? "Database belum dikonfigurasi." : result.error || "Gagal membuat akun uji coba." },
      { status: 500 }
    );
  }

  await setSessionCookie(email);
  return NextResponse.json({ success: true, email, trial_ends_at: trialEndsAt });
}
