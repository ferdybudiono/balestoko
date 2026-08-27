import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { sendFonnteMessage } from "@/lib/fonnte";
import {
  appendManualReply,
  getConversation,
  getStoreByEmail,
  isStoreActive,
  listStoreDevicesCompat,
  markConversationSeen,
  setConversationAiPaused,
  type StoreDeviceRecord,
  type StoreRecord
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ambil alih percakapan dari bot.
 *
 *   POST  { phone, message, pause? }        → kirim balasan MANUAL ke pembeli
 *   PATCH { phone, ai_paused?, seen? }      → jeda/lanjutkan AI, tandai sudah dibaca
 *
 * Sebelum ada endpoint ini, satu-satunya cara pemilik toko menjawab sendiri adalah
 * membuka WhatsApp di ponselnya — dan bot tetap menjawab bersamaan, sehingga pembeli
 * menerima dua jawaban yang bisa saling bertentangan. Itu kegagalan yang paling
 * merugikan: justru terjadi pada chat yang paling perlu ditangani manusia.
 *
 * `store.id` selalu diambil dari SESSION, tidak pernah dari body, dan semua query
 * di bawah menyaring `store_id` di PostgREST — jadi menebak nomor pembeli toko lain
 * tidak menghasilkan apa pun.
 */
async function requireStore(): Promise<
  { ok: true; store: StoreRecord; storeId: string } | { ok: false; res: NextResponse }
> {
  const email = await getSessionEmail();
  if (!email) {
    return { ok: false, res: NextResponse.json({ error: "Tidak terautentikasi." }, { status: 401 }) };
  }
  const store = await getStoreByEmail(email);
  if (!store?.id) {
    return { ok: false, res: NextResponse.json({ error: "Data toko tidak ditemukan." }, { status: 404 }) };
  }
  return { ok: true, store, storeId: store.id };
}

/** Batas panjang satu pesan WhatsApp yang masih wajar dikirim. */
const MAX_MANUAL_MESSAGE = 4000;

/**
 * Nomor toko yang dipakai mengirim balasan manual.
 *
 * Percakapan tidak menyimpan lewat nomor mana pembeli masuk, jadi nomor utama yang
 * dipilih — itu nomor yang sama dengan yang dipakai bot pada toko satu-nomor
 * (mayoritas). Yang tidak tersambung dilewati: token-nya ada, tapi kirimnya pasti
 * gagal dan pemilik toko akan mengira pesannya sudah sampai.
 */
function sendingDevice(devices: StoreDeviceRecord[]): StoreDeviceRecord | null {
  const usable = devices.filter(
    (d) =>
      (d.fonnte_token || "").trim() &&
      String(d.device_status || "").toLowerCase() === "connected"
  );
  return usable.find((d) => d.is_primary) || usable[0] || null;
}

export async function POST(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;
  const { store, storeId } = auth;

  if (!isStoreActive(store)) {
    return NextResponse.json(
      { error: "Masa aktif toko sudah berakhir. Perpanjang langganan untuk mengirim pesan." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const phone = String(body.phone || "").trim();
  const message = String(body.message || "").trim().slice(0, MAX_MANUAL_MESSAGE);
  if (!phone) {
    return NextResponse.json({ error: "Nomor pembeli wajib diisi." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Pesan tidak boleh kosong." }, { status: 400 });
  }

  // Hanya boleh membalas percakapan yang MEMANG milik toko ini. Tanpa pemeriksaan
  // ini endpoint berubah menjadi alat kirim WhatsApp ke nomor mana pun.
  const conversation = await getConversation(storeId, phone);
  if (!conversation) {
    return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
  }

  const { devices } = await listStoreDevicesCompat(store);
  const sender = sendingDevice(devices);
  if (!sender?.fonnte_token) {
    return NextResponse.json(
      {
        error:
          "Belum ada nomor WhatsApp yang tersambung, jadi pesannya tidak bisa dikirim. " +
          "Buka tab Nomor WA dan sambungkan dulu."
      },
      { status: 409 }
    );
  }

  const sent = await sendFonnteMessage({
    target: phone,
    message,
    token: sender.fonnte_token
  });

  // Kirim DULU, catat kemudian. Kalau urutannya dibalik, kegagalan kirim akan
  // meninggalkan pesan di riwayat chat dashboard yang tidak pernah diterima
  // pembeli — dan pemilik toko menunggu jawaban yang tidak akan datang.
  if (!sent.success) {
    return NextResponse.json(
      { error: `Pesan gagal dikirim: ${sent.error || "penyebab tidak diketahui"}` },
      { status: 502 }
    );
  }

  const stored = await appendManualReply({ storeId, phone, text: message });
  if (!stored.ok) {
    console.warn("[conversations] balasan manual gagal disimpan:", stored.error);
  }

  // Sekali pemilik toko menjawab sendiri, AI dijeda kecuali diminta sebaliknya.
  // Membiarkan bot tetap menjawab berarti pembeli menerima dua jawaban dari dua
  // "orang" yang tidak saling tahu; UI menampilkan status jeda ini beserta tombol
  // untuk menyalakannya kembali, jadi bukan perubahan diam-diam.
  const pause = body.pause !== false;
  if (pause && conversation.ai_paused !== true) {
    await setConversationAiPaused(storeId, phone, true);
  }

  return NextResponse.json({
    success: true,
    aiPaused: pause ? true : conversation.ai_paused === true,
    // `false` = pesan TERKIRIM tapi gagal masuk riwayat. Dashboard memakainya untuk
    // memuat ulang percakapan, bukan untuk menampilkan kegagalan.
    stored: stored.ok
  });
}

export async function PATCH(req: Request) {
  const auth = await requireStore();
  if (!auth.ok) return auth.res;
  const { storeId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Gagal membaca body request." }, { status: 400 });
  }

  const phone = String(body.phone || "").trim();
  if (!phone) {
    return NextResponse.json({ error: "Nomor pembeli wajib diisi." }, { status: 400 });
  }

  const wantsPause = body.ai_paused !== undefined;
  const wantsSeen = body.seen === true;
  if (!wantsPause && !wantsSeen) {
    return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
  }

  if (wantsPause) {
    const paused = body.ai_paused === true;
    const res = await setConversationAiPaused(storeId, phone, paused);
    if (!res.ok) {
      // `skipped` = kolom `ai_paused` belum ada. Ini kegagalan yang bisa diperbaiki
      // pemilik toko sendiri, jadi pesannya menyebut caranya.
      return NextResponse.json(
        {
          error: res.skipped
            ? "Fitur jeda AI belum aktif di database. Jalankan supabase/schema.sql versi terbaru."
            : res.error || "Gagal mengubah mode AI."
        },
        { status: res.skipped ? 409 : 500 }
      );
    }
  }

  // Penanda "sudah dibaca" sengaja tidak pernah menggagalkan request: kalau
  // kolomnya belum ada, chat-nya tetap terbuka — hanya lencana belum-dibaca yang
  // tidak hilang.
  if (wantsSeen) {
    const res = await markConversationSeen(storeId, phone);
    if (!res.ok && !res.skipped) {
      console.warn("[conversations] gagal menandai sudah dibaca:", res.error);
    }
  }

  return NextResponse.json({ success: true });
}
