import { NextResponse } from "next/server";
import { getSessionActor, hashPassword } from "@/lib/auth";
import {
  deleteStoreMember,
  getStoreByEmail,
  getStoreMemberByEmail,
  insertStoreMember,
  listStoreMembers,
  normalizeEmail,
  toPublicMember,
  updateStoreMember,
  type StoreRecord
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anggota tim yang boleh membuka dashboard toko ini.
 *
 *   GET    → daftar anggota
 *   POST   { email, password, role? }
 *   PATCH  ?id=<uuid>  { password }   → setel ulang kata sandi anggota
 *   DELETE ?id=<uuid>
 *
 * Yang dipecahkan: sebelumnya satu toko punya satu kata sandi. Pegawai yang ikut
 * menjawab chat harus memakai kredensial pemiliknya, jadi mengeluarkan seseorang
 * berarti mengganti kata sandi untuk SEMUA orang — dan pada akun yang sama itu
 * juga memutus sesi pemilik sendiri.
 *
 * Batas yang disengaja: anggota tim melihat data yang sama luas dengan pemilik.
 * Yang TIDAK boleh dia lakukan adalah mengelola anggota lain — kalau boleh, satu
 * pegawai bisa mengangkat dirinya sendiri jadi pintu masuk permanen. Karena itu
 * seluruh endpoint ini menolak sesi anggota (`actor.isMember`).
 */
const MAX_MEMBERS = 10;
const MIN_PASSWORD = 8;

async function requireOwner(): Promise<
  { ok: true; store: StoreRecord; storeId: string } | { ok: false; res: NextResponse }
> {
  const actor = await getSessionActor();
  if (!actor) {
    return { ok: false, res: NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 }) };
  }
  if (actor.isMember) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Hanya pemilik toko yang bisa mengelola anggota tim." },
        { status: 403 }
      )
    };
  }
  const store = await getStoreByEmail(actor.storeEmail);
  if (!store?.id) {
    return { ok: false, res: NextResponse.json({ error: "Data toko tidak ditemukan." }, { status: 404 }) };
  }
  return { ok: true, store, storeId: store.id };
}

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) return auth.res;

  const members = await listStoreMembers(auth.storeId);
  return NextResponse.json({
    members: (members || []).map(toPublicMember),
    // `null` = tabel `store_members` belum ada. Dibedakan dari daftar kosong supaya
    // dashboard mengajak menjalankan migrasi, bukan mengajak menambah anggota lewat
    // tombol yang pasti gagal.
    needsMigration: members === null,
    limit: MAX_MEMBERS
  });
}

export async function POST(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return auth.res;
  const { store, storeId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const role = body.role === "admin" ? "admin" : "staff";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email anggota tidak valid." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Kata sandi minimal ${MIN_PASSWORD} karakter.` },
      { status: 400 }
    );
  }

  // Email yang sama dengan akun pemilik akan membuat login ambigu: jalur pemilik
  // dicoba lebih dulu, jadi anggota ini tidak akan pernah bisa masuk.
  if (email === normalizeEmail(store.email)) {
    return NextResponse.json(
      { error: "Email ini sudah dipakai akun pemilik toko." },
      { status: 409 }
    );
  }

  // Satu email = satu toko. Indeks unik di database juga menjaganya, tapi diperiksa
  // di sini supaya pesannya bisa dimengerti pemilik toko.
  const existing = await getStoreMemberByEmail(email);
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.store_id === storeId
            ? "Email ini sudah menjadi anggota toko Anda."
            : "Email ini sudah dipakai di toko lain."
      },
      { status: 409 }
    );
  }

  const members = await listStoreMembers(storeId);
  if (members === null) {
    return NextResponse.json(
      { error: "Fitur anggota tim belum aktif di database. Jalankan supabase/schema.sql versi terbaru." },
      { status: 409 }
    );
  }
  if (members.length >= MAX_MEMBERS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_MEMBERS} anggota per toko.` },
      { status: 409 }
    );
  }

  const res = await insertStoreMember({
    store_id: storeId,
    email,
    password_hash: hashPassword(password),
    role
  });

  if (!res.ok || !res.data) {
    if (res.skipped) {
      return NextResponse.json(
        { error: "Fitur anggota tim belum aktif di database. Jalankan supabase/schema.sql versi terbaru." },
        { status: 409 }
      );
    }
    console.error("[members] gagal menambah anggota:", res.error);
    return NextResponse.json({ error: "Gagal menambah anggota." }, { status: 500 });
  }

  return NextResponse.json({ success: true, member: toPublicMember(res.data) });
}

/**
 * Setel ulang kata sandi satu anggota tim (hanya pemilik toko).
 *
 * Ini satu-satunya jalan pemulihan yang dipunyai anggota tim. Jalur OTP di
 * `/api/auth/reset/*` bekerja pada baris `stores` dan mengirim kodenya ke nomor
 * WhatsApp toko, jadi anggota yang lupa kata sandinya sebelum ini tidak punya
 * pilihan selain dihapus lalu dibuat ulang — kehilangan peran dan riwayat
 * `last_login_at`-nya, dan sempat menghapus akses orang yang masih bekerja.
 *
 * `password_changed_at` wajib ikut ditulis. Kolomnya sudah ada di skema dan sudah
 * diperiksa `getSessionActor()`, tapi tidak pernah ditulis siapa pun — artinya
 * mengganti kata sandi anggota TIDAK memutus sesinya yang sedang berjalan. Dengan
 * kolom itu terisi, cookie yang terbit sebelum penyetelan langsung ditolak.
 */
export async function PATCH(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return auth.res;

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Id anggota wajib diisi." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const password = String(body.password || "");
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Kata sandi minimal ${MIN_PASSWORD} karakter.` },
      { status: 400 }
    );
  }

  // Waktu apa adanya, BUKAN `passwordChangedAt()` dari `lib/auth.ts`. Helper itu
  // menggeser waktu 1 detik ke belakang supaya orang yang mengganti kata sandinya
  // sendiri tidak ikut terlempar dari sesinya; di sini yang menyetel adalah pemilik
  // toko dan tidak ada cookie anggota yang perlu diselamatkan, jadi pencabutannya
  // dibuat seketat mungkin.
  const changedAt = new Date().toISOString();

  // `storeId` ikut disaring di dalam query, jadi id anggota toko LAIN tidak bisa
  // disetel dari sini walaupun UUID-nya diketahui.
  const res = await updateStoreMember(id, auth.storeId, {
    password_hash: hashPassword(password),
    password_changed_at: changedAt
  });

  if (!res.ok || !res.data) {
    if (res.skipped) {
      return NextResponse.json(
        { error: "Fitur anggota tim belum aktif di database. Jalankan supabase/schema.sql versi terbaru." },
        { status: 409 }
      );
    }
    if (res.notFound) {
      return NextResponse.json({ error: "Anggota tidak ditemukan." }, { status: 404 });
    }
    console.error("[members] gagal menyetel kata sandi anggota:", res.error);
    return NextResponse.json({ error: "Gagal menyetel kata sandi anggota." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    member: toPublicMember(res.data),
    message: "Kata sandi anggota diperbarui. Sesi lamanya sudah dikeluarkan."
  });
}

export async function DELETE(req: Request) {
  const auth = await requireOwner();
  if (!auth.ok) return auth.res;

  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Id anggota wajib diisi." }, { status: 400 });
  }

  // `store_id` ikut disaring di query, jadi menebak id anggota toko lain tidak
  // menghapus apa pun. Sesi anggota yang barisnya hilang langsung ditolak
  // `getSessionActor()` — jadi tombol ini benar-benar mengeluarkan orangnya.
  const res = await deleteStoreMember(id, auth.storeId);
  if (!res.ok) {
    if (res.skipped) {
      return NextResponse.json(
        { error: "Fitur anggota tim belum aktif di database. Jalankan supabase/schema.sql versi terbaru." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: res.error || "Gagal menghapus anggota." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
