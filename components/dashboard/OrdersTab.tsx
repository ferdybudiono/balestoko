"use client";

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  MapPin,
  Phone,
  Receipt,
  Search,
  Trash2,
  Truck,
  Undo2,
  Wallet
} from "lucide-react";
import {
  BUYER_ORDER_STATUS_LABELS,
  formatPhoneDisplay,
  formatRupiah,
  formatWeight,
  nextOrderStatus,
  relativeTime,
  type BuyerOrder,
  type BuyerOrderStatus,
  type ShowToast
} from "./types";

interface OrdersTabProps {
  orders: BuyerOrder[];
  /** Tabel pesanan belum ada di database (SQL terbaru belum dijalankan). */
  needsMigration?: boolean;
  busyId?: string | null;
  /**
   * Pindahkan pesanan ke tahap tertentu. `extra` dipakai saat tahapnya butuh
   * data tambahan: nomor resi ketika dikirim, bukti transfer ketika dibayar.
   */
  onSetStatus: (
    order: BuyerOrder,
    status: BuyerOrderStatus,
    extra?: { tracking_number?: string; payment_proof_url?: string }
  ) => void;
  onDelete: (order: BuyerOrder) => void;
  showToast: ShowToast;
}

type Filter = "all" | "open" | "new" | "paid" | "shipped" | "done";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "open", label: "Perlu diproses" },
  { id: "new", label: "Belum bayar" },
  { id: "paid", label: "Siap kirim" },
  { id: "shipped", label: "Dikirim" },
  { id: "done", label: "Selesai" },
  { id: "all", label: "Semua" }
];

/** Warna lencana per tahap — urutannya ikut menceritakan kemajuan pesanan. */
const STATUS_BADGE: Record<BuyerOrderStatus, string> = {
  new: "bg-amber-50 border-amber-200 text-amber-800",
  paid: "bg-sky-50 border-sky-200 text-sky-800",
  shipped: "bg-indigo-50 border-indigo-200 text-indigo-800",
  done: "bg-emerald-50 border-emerald-200 text-emerald-800"
};

/** Kalimat tombol tahap berikutnya — perintah, bukan nama status. */
const ADVANCE_LABEL: Record<BuyerOrderStatus, string> = {
  new: "Buka kembali",
  paid: "Sudah bayar",
  shipped: "Kirim",
  done: "Selesai"
};

const ADVANCE_ICON: Record<BuyerOrderStatus, typeof Wallet> = {
  new: Undo2,
  paid: Wallet,
  shipped: Truck,
  done: BadgeCheck
};

function statusOf(order: BuyerOrder): BuyerOrderStatus {
  return order.status || "new";
}

function itemsSummary(order: BuyerOrder): string {
  const items = order.items || [];
  if (items.length === 0) return "—";
  return items.map((i) => (i.units > 1 ? `${i.units}× ${i.name}` : i.name)).join(", ");
}

/**
 * Satu baris pesanan sebagai teks siap tempel — dipakai tombol "Salin".
 *
 * Pemilik toko biasanya menempelkannya ke aplikasi kurir atau grup packing, jadi
 * yang dicetak adalah data pengiriman, bukan tampilan tabel.
 */
function orderAsText(order: BuyerOrder): string {
  const lines = [
    `Nama   : ${order.customer_name || "-"}`,
    `HP     : ${order.customer_phone}`,
    `Alamat : ${order.customer_address || order.destination_city || "-"}`,
    `Barang : ${itemsSummary(order)}`,
    `Subtotal: ${formatRupiah(order.subtotal)}`,
    `Berat  : ${formatWeight(order.weight_gram)}`
  ];
  if (order.shipping_courier) lines.push(`Kurir  : ${order.shipping_courier}`);
  if (order.tracking_number) lines.push(`Resi   : ${order.tracking_number}`);
  return lines.join("\n");
}

/** CSV agar daftar ini bisa dibuka di Excel / Google Sheets. */
function toCsv(orders: BuyerOrder[]): string {
  const head = [
    "Tanggal",
    "Status",
    "Nama",
    "Nomor WA",
    "Alamat",
    "Kota tujuan",
    "Barang",
    "Subtotal",
    "Ongkir",
    "Berat (gram)",
    "Kurir",
    "Nomor resi",
    "Dibayar",
    "Dikirim",
    "Selesai"
  ];
  // Tanda kutip di dalam sel digandakan sesuai aturan CSV; tanpa itu satu alamat
  // yang memuat kutip bisa menggeser seluruh kolom berikutnya.
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("id-ID") : "");
  const rows = orders.map((o) =>
    [
      o.created_at ? new Date(o.created_at).toLocaleString("id-ID") : "",
      BUYER_ORDER_STATUS_LABELS[statusOf(o)],
      o.customer_name || "",
      o.customer_phone,
      o.customer_address || "",
      o.destination_city || "",
      itemsSummary(o),
      o.subtotal || 0,
      o.shipping_cost || 0,
      o.weight_gram || 0,
      o.shipping_courier || "",
      o.tracking_number || "",
      stamp(o.paid_at),
      stamp(o.shipped_at),
      stamp(o.done_at)
    ]
      .map(esc)
      .join(",")
  );
  return [head.map(esc).join(","), ...rows].join("\r\n");
}

export default function OrdersTab({
  orders,
  needsMigration = false,
  busyId,
  onSetStatus,
  onDelete,
  showToast
}: OrdersTabProps) {
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Pesanan yang sedang diisi nomor resinya. Resi diminta SEBELUM status berubah
  // ke "dikirim": pembeli yang ditagih nomor resi lewat chat tidak bisa dijawab
  // dari kolom yang tidak pernah terisi.
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const [trackingValue, setTrackingValue] = useState("");
  // Bukti transfer: URL, bukan berkas. Aplikasi ini belum punya penyimpanan
  // media sendiri, jadi menampung berkas berarti menjanjikan tempat simpan yang
  // tidak ada — sedangkan tautan foto yang dikirim pembeli sudah cukup untuk
  // ditelusuri kembali saat ada sengketa.
  const [proofFor, setProofFor] = useState<string | null>(null);
  const [proofValue, setProofValue] = useState("");

  const counts = useMemo(
    () => ({
      all: orders.length,
      open: orders.filter((o) => statusOf(o) !== "done").length,
      new: orders.filter((o) => statusOf(o) === "new").length,
      paid: orders.filter((o) => statusOf(o) === "paid").length,
      shipped: orders.filter((o) => statusOf(o) === "shipped").length,
      done: orders.filter((o) => statusOf(o) === "done").length
    }),
    [orders]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      const st = statusOf(o);
      if (filter === "open" && st === "done") return false;
      if (filter !== "all" && filter !== "open" && st !== filter) return false;
      if (!q) return true;
      return (
        o.customer_phone.toLowerCase().includes(q) ||
        (o.customer_name || "").toLowerCase().includes(q) ||
        (o.customer_address || "").toLowerCase().includes(q) ||
        (o.destination_city || "").toLowerCase().includes(q) ||
        (o.tracking_number || "").toLowerCase().includes(q) ||
        itemsSummary(o).toLowerCase().includes(q)
      );
    });
  }, [orders, filter, query]);

  async function copyOne(order: BuyerOrder) {
    try {
      await navigator.clipboard.writeText(orderAsText(order));
      showToast("Data pesanan disalin.", "success");
    } catch {
      showToast("Browser menolak akses clipboard.", "error");
    }
  }

  function downloadCsv() {
    // Diunduh dari data yang SUDAH ada di layar — tidak perlu endpoint baru, dan
    // yang terunduh persis apa yang pemilik toko lihat (termasuk filternya).
    const blob = new Blob(["﻿", toCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pesanan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Klik tombol tahap berikutnya.
   *
   * Khusus perpindahan ke "dikirim", formulir resi dibuka lebih dulu supaya nomor
   * resi dan perubahan status tersimpan dalam SATU permintaan — kalau dipisah,
   * pesanan bisa berstatus "dikirim" tanpa resi ketika permintaan kedua gagal.
   */
  function advance(order: BuyerOrder) {
    const next = nextOrderStatus(statusOf(order));
    if (!next || !order.id) return;
    if (next === "shipped") {
      setTrackingFor(order.id);
      setTrackingValue(order.tracking_number || "");
      return;
    }
    onSetStatus(order, next);
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Daftar pesanan
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Pesanan yang direkam AI dari chat WhatsApp. Geser tahapnya mengikuti kenyataan:{" "}
            <strong>Baru → Sudah bayar → Dikirim → Selesai</strong>.
          </p>
        </div>
        {orders.length > 0 && (
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ink bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Unduh CSV
          </button>
        )}
      </div>

      {needsMigration && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
          Tabel pesanan belum ada di database. Jalankan <code>supabase/schema.sql</code> versi
          terbaru di Supabase, lalu muat ulang halaman ini.
        </p>
      )}

      {orders.length === 0 ? (
        <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-2xl space-y-2">
          <ClipboardList className="w-10 h-10 mx-auto text-slate-300" aria-hidden="true" />
          <p className="text-sm text-slate-500">Belum ada pesanan yang tercatat</p>
          <p className="text-xs text-slate-400">
            Pesanan otomatis masuk ke sini saat pembeli menyebut produk dan menyatakan mau memesan.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Saring pesanan"
              className="flex gap-1 bg-slate-100 p-1 rounded-xl"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    filter === f.id ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink"
                  }`}
                >
                  {f.label} ({counts[f.id]})
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[180px]">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari pesanan"
                placeholder="Cari nama, nomor, alamat, produk…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              Tidak ada pesanan yang cocok dengan penyaringan ini.
            </p>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <caption className="sr-only">
                  Daftar pesanan pembeli beserta tahap pemrosesannya
                </caption>
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-4 py-3 font-semibold w-[210px]">
                      Tahap
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Pembeli
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Alamat kirim
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Barang
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      Subtotal
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Masuk
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((o) => {
                    const st = statusOf(o);
                    const done = st === "done";
                    const busy = !!o.id && busyId === o.id;
                    const next = nextOrderStatus(st);
                    const NextIcon = next ? ADVANCE_ICON[next] : CheckCircle2;
                    const askTracking = !!o.id && trackingFor === o.id;
                    const askProof = !!o.id && proofFor === o.id;
                    return (
                      <tr key={o.id || o.customer_phone} className={done ? "bg-slate-50/60" : ""}>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-semibold ${STATUS_BADGE[st]}`}
                          >
                            {BUYER_ORDER_STATUS_LABELS[st]}
                          </span>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {next && (
                              <button
                                type="button"
                                onClick={() => advance(o)}
                                disabled={busy || !o.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
                              >
                                <NextIcon className="w-3.5 h-3.5" aria-hidden="true" />
                                {ADVANCE_LABEL[next]}
                              </button>
                            )}
                            {/* Satu langkah MUNDUR selalu tersedia: status salah klik
                                jauh lebih sering terjadi daripada pesanan yang benar-benar
                                perlu dihapus. */}
                            {st !== "new" && (
                              <button
                                type="button"
                                onClick={() => onSetStatus(o, "new")}
                                disabled={busy || !o.id}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-semibold text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                                aria-label={`Buka kembali pesanan ${o.customer_name || o.customer_phone}`}
                              >
                                <Undo2 className="w-3 h-3" aria-hidden="true" />
                                Buka
                              </button>
                            )}
                          </div>

                          {askTracking && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                setTrackingFor(null);
                                onSetStatus(o, "shipped", {
                                  tracking_number: trackingValue.trim()
                                });
                              }}
                              className="mt-2 space-y-1.5"
                            >
                              <label
                                className="block text-[11px] font-semibold text-slate-500"
                                htmlFor={`resi-${o.id}`}
                              >
                                Nomor resi (boleh dikosongkan)
                              </label>
                              <input
                                id={`resi-${o.id}`}
                                type="text"
                                autoFocus
                                value={trackingValue}
                                onChange={(e) => setTrackingValue(e.target.value)}
                                placeholder="mis. JP1234567890"
                                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                              />
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="submit"
                                  disabled={busy}
                                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
                                >
                                  Simpan & tandai dikirim
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTrackingFor(null)}
                                  className="px-2 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-ink"
                                >
                                  Batal
                                </button>
                              </div>
                            </form>
                          )}

                          {o.tracking_number && !askTracking && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              Resi: <span className="font-semibold text-ink">{o.tracking_number}</span>
                            </p>
                          )}

                          {st !== "new" &&
                            (askProof ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  setProofFor(null);
                                  onSetStatus(o, st, { payment_proof_url: proofValue.trim() });
                                }}
                                className="mt-2 space-y-1.5"
                              >
                                <label
                                  className="block text-[11px] font-semibold text-slate-500"
                                  htmlFor={`bukti-${o.id}`}
                                >
                                  Tautan bukti transfer
                                </label>
                                <input
                                  id={`bukti-${o.id}`}
                                  type="url"
                                  autoFocus
                                  value={proofValue}
                                  onChange={(e) => setProofValue(e.target.value)}
                                  placeholder="https://…"
                                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="submit"
                                    disabled={busy}
                                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50"
                                  >
                                    Simpan
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setProofFor(null)}
                                    className="px-2 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-ink"
                                  >
                                    Batal
                                  </button>
                                </div>
                              </form>
                            ) : o.payment_proof_url ? (
                              <a
                                href={o.payment_proof_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
                              >
                                <Receipt className="w-3 h-3" aria-hidden="true" />
                                Lihat bukti bayar
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setProofFor(o.id || null);
                                  setProofValue("");
                                }}
                                disabled={!o.id}
                                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-ink disabled:opacity-40"
                              >
                                <Receipt className="w-3 h-3" aria-hidden="true" />
                                Catat bukti bayar
                              </button>
                            ))}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-ink">
                            {o.customer_name || "Belum ada nama"}
                          </p>
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <Phone className="w-3 h-3" aria-hidden="true" />
                            {formatPhoneDisplay(o.customer_phone)}
                          </span>
                        </td>

                        <td className="px-4 py-3 align-top max-w-[260px]">
                          {o.customer_address ? (
                            <p className="text-xs text-slate-600 break-words">
                              {o.customer_address}
                            </p>
                          ) : (
                            <p className="text-xs text-amber-700">Alamat belum lengkap</p>
                          )}
                          {o.destination_city && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-brand-700 font-medium mt-1">
                              <MapPin className="w-3 h-3" aria-hidden="true" />
                              {o.destination_city}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top max-w-[220px]">
                          <p className="text-xs text-slate-600 break-words">{itemsSummary(o)}</p>
                          <span className="text-[11px] text-slate-400">
                            {formatWeight(o.weight_gram)}
                          </span>
                        </td>

                        <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                          <span className="font-semibold text-ink">{formatRupiah(o.subtotal)}</span>
                          {/* Ongkir dipisah, bukan dilebur: pemilik toko menagih
                              totalnya, tapi yang jadi pendapatan barang hanya subtotal. */}
                          {!!o.shipping_cost && (
                            <span className="block text-[11px] text-slate-400">
                              + ongkir {formatRupiah(o.shipping_cost)}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top text-[11px] text-slate-400 whitespace-nowrap">
                          {relativeTime(o.created_at)}
                          {o.paid_at && (
                            <span className="block text-sky-600">
                              dibayar {relativeTime(o.paid_at)}
                            </span>
                          )}
                          {o.shipped_at && (
                            <span className="block text-indigo-600">
                              dikirim {relativeTime(o.shipped_at)}
                            </span>
                          )}
                          {done && o.done_at && (
                            <span className="block text-emerald-600">
                              selesai {relativeTime(o.done_at)}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => copyOne(o)}
                              aria-label={`Salin data pesanan ${o.customer_name || o.customer_phone}`}
                              className="p-2 text-slate-400 hover:text-ink hover:bg-slate-100 rounded-lg"
                            >
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {confirmId === o.id ? (
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmId(null);
                                    onDelete(o);
                                  }}
                                  disabled={busy}
                                  className="px-2 py-1 text-[11px] font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                                >
                                  Hapus
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmId(null)}
                                  className="px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-ink"
                                >
                                  Batal
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmId(o.id || null)}
                                disabled={!o.id}
                                aria-label={`Hapus pesanan ${o.customer_name || o.customer_phone}`}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-40"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
