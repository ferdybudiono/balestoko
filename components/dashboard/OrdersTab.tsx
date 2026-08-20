"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Circle,
  Copy,
  Download,
  MapPin,
  Phone,
  Search,
  Trash2
} from "lucide-react";
import {
  formatPhoneDisplay,
  formatRupiah,
  formatWeight,
  relativeTime,
  type BuyerOrder,
  type ShowToast
} from "./types";

interface OrdersTabProps {
  orders: BuyerOrder[];
  /** Tabel pesanan belum ada di database (SQL terbaru belum dijalankan). */
  needsMigration?: boolean;
  busyId?: string | null;
  onToggleDone: (order: BuyerOrder, done: boolean) => void;
  onDelete: (order: BuyerOrder) => void;
  showToast: ShowToast;
}

type Filter = "all" | "new" | "done";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "new", label: "Perlu diproses" },
  { id: "done", label: "Selesai" },
  { id: "all", label: "Semua" }
];

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
    "Berat (gram)",
    "Kurir"
  ];
  // Tanda kutip di dalam sel digandakan sesuai aturan CSV; tanpa itu satu alamat
  // yang memuat kutip bisa menggeser seluruh kolom berikutnya.
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = orders.map((o) =>
    [
      o.created_at ? new Date(o.created_at).toLocaleString("id-ID") : "",
      o.status === "done" ? "Selesai" : "Perlu diproses",
      o.customer_name || "",
      o.customer_phone,
      o.customer_address || "",
      o.destination_city || "",
      itemsSummary(o),
      o.subtotal || 0,
      o.weight_gram || 0,
      o.shipping_courier || ""
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
  onToggleDone,
  onDelete,
  showToast
}: OrdersTabProps) {
  const [filter, setFilter] = useState<Filter>("new");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: orders.length,
      new: orders.filter((o) => o.status !== "done").length,
      done: orders.filter((o) => o.status === "done").length
    }),
    [orders]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === "new" && o.status === "done") return false;
      if (filter === "done" && o.status !== "done") return false;
      if (!q) return true;
      return (
        o.customer_phone.toLowerCase().includes(q) ||
        (o.customer_name || "").toLowerCase().includes(q) ||
        (o.customer_address || "").toLowerCase().includes(q) ||
        (o.destination_city || "").toLowerCase().includes(q) ||
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

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Daftar pesanan
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Pesanan yang direkam AI dari chat WhatsApp. Centang <strong>Selesai</strong> setelah
            pesanan diproses.
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
              <table className="w-full text-sm min-w-[880px]">
                <caption className="sr-only">
                  Daftar pesanan pembeli beserta status pemrosesannya
                </caption>
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-4 py-3 font-semibold w-[92px]">
                      Selesai
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
                    const done = o.status === "done";
                    const busy = !!o.id && busyId === o.id;
                    return (
                      <tr key={o.id || o.customer_phone} className={done ? "bg-slate-50/60" : ""}>
                        <td className="px-4 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => onToggleDone(o, !done)}
                            disabled={busy || !o.id}
                            aria-pressed={done}
                            aria-label={
                              done
                                ? `Buka kembali pesanan ${o.customer_name || o.customer_phone}`
                                : `Tandai pesanan ${o.customer_name || o.customer_phone} selesai`
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors disabled:opacity-50 ${
                              done
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            {done ? (
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <Circle className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            {done ? "Selesai" : "Proses"}
                          </button>
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

                        <td className="px-4 py-3 align-top text-right font-semibold text-ink whitespace-nowrap">
                          {formatRupiah(o.subtotal)}
                        </td>

                        <td className="px-4 py-3 align-top text-[11px] text-slate-400 whitespace-nowrap">
                          {relativeTime(o.created_at)}
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
