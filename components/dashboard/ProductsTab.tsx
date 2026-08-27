"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ImageIcon,
  Package,
  PackageX,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert
} from "lucide-react";
import { formatRupiah, formatWeight, type Product, type ShowToast } from "./types";

interface ProductsTabProps {
  products: Product[];
  showToast: ShowToast;
  /** Muat ulang data setelah mutasi berhasil. */
  onChanged: () => void | Promise<void>;
}

interface DraftFields {
  name: string;
  price: string;
  weight: string;
  stock: string;
  description: string;
  /**
   * URL foto produk — bukan unggahan berkas.
   *
   * Aplikasi ini tidak punya penyimpanan media sendiri, dan Fonnte mengirim foto
   * ke WhatsApp dengan cara mengambil URL publik. Menjanjikan tombol "unggah"
   * berarti menjanjikan tempat menyimpan yang tidak ada.
   */
  image_url: string;
}

const EMPTY_DRAFT: DraftFields = {
  name: "",
  price: "",
  weight: "1000",
  stock: "",
  description: "",
  image_url: ""
};

const inputCls =
  "w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

/** Validasi sisi-klien yang mencerminkan aturan server (harga & berat > 0, stok >= 0). */
function validateDraft(d: DraftFields): string | null {
  if (!d.name.trim()) return "Nama produk wajib diisi.";
  const price = Number(d.price);
  if (!Number.isFinite(price) || price <= 0) return "Harga harus lebih besar dari 0.";
  const weight = Number(d.weight);
  if (!Number.isFinite(weight) || weight <= 0) return "Berat harus lebih besar dari 0 gram.";
  if (weight > 50000) return "Berat maksimal 50.000 gram (50 kg).";
  if (d.stock.trim() !== "") {
    const stock = Number(d.stock);
    if (!Number.isFinite(stock) || stock < 0) return "Stok tidak boleh negatif.";
  }
  const img = d.image_url.trim();
  if (img) {
    if (!/^https?:\/\/\S+$/i.test(img)) return "URL foto harus diawali http:// atau https://.";
    // Fonnte memisahkan beberapa foto dengan koma di satu field, jadi URL
    // bermuatan koma akan terpotong dan fotonya tidak pernah sampai ke pembeli.
    if (img.includes(",")) return "URL foto tidak boleh mengandung tanda koma.";
  }
  return null;
}

export default function ProductsTab({ products, showToast, onChanged }: ProductsTabProps) {
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)
    );
  }, [products, query]);

  const patchDraft = (patch: Partial<DraftFields>) => setDraft((d) => ({ ...d, ...patch }));
  const patchEdit = (patch: Partial<DraftFields>) => setEditDraft((d) => ({ ...d, ...patch }));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateDraft(draft);
    if (err) {
      showToast(err, "error");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          price: Number(draft.price),
          weight: Number(draft.weight),
          ...(draft.stock.trim() !== "" ? { stock: Number(draft.stock) } : {}),
          description: draft.description.trim(),
          image_url: draft.image_url.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menambah produk.", "error");
        return;
      }
      showToast("Produk ditambahkan.");
      setDraft(EMPTY_DRAFT);
      await onChanged();
    } catch {
      showToast("Gagal menambah produk.", "error");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (p: Product) => {
    if (!p.id) return;
    setConfirmDeleteId(null);
    setEditingId(p.id);
    setEditDraft({
      name: p.name || "",
      price: String(p.price ?? ""),
      weight: String(p.weight ?? ""),
      stock: p.stock === undefined || p.stock === null ? "" : String(p.stock),
      description: p.description || "",
      image_url: p.image_url || ""
    });
  };

  const handleSaveEdit = async (id: string) => {
    const err = validateDraft(editDraft);
    if (err) {
      showToast(err, "error");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: editDraft.name.trim(),
          price: Number(editDraft.price),
          weight: Number(editDraft.weight),
          ...(editDraft.stock.trim() !== "" ? { stock: Number(editDraft.stock) } : {}),
          description: editDraft.description.trim(),
          image_url: editDraft.image_url.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menyimpan perubahan.", "error");
        return;
      }
      showToast("Perubahan produk disimpan.");
      setEditingId(null);
      await onChanged();
    } catch {
      showToast("Gagal menyimpan perubahan.", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menghapus produk.", "error");
        return;
      }
      showToast("Produk dihapus.");
      setConfirmDeleteId(null);
      await onChanged();
    } catch {
      showToast("Gagal menghapus produk.", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Tambah produk ────────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Package className="w-5 h-5 text-brand-600" aria-hidden="true" />
            Katalog produk
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            AI memakai nama, harga, dan berat produk untuk menjawab pembeli serta menghitung ongkir.
          </p>
        </div>

        <form onSubmit={handleAdd} className="p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Tambah produk baru
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="sm:col-span-2 lg:col-span-1 space-y-1.5">
              <label htmlFor="np-name" className="block text-[11px] font-medium text-slate-500">
                Nama produk
              </label>
              <input
                id="np-name"
                type="text"
                required
                placeholder="Kaos Polos Hitam"
                value={draft.name}
                onChange={(e) => patchDraft({ name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="np-price" className="block text-[11px] font-medium text-slate-500">
                Harga (Rp)
              </label>
              <input
                id="np-price"
                type="number"
                required
                min={1}
                inputMode="numeric"
                placeholder="75000"
                value={draft.price}
                onChange={(e) => patchDraft({ price: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="np-weight" className="block text-[11px] font-medium text-slate-500">
                Berat (gram)
              </label>
              <input
                id="np-weight"
                type="number"
                min={1}
                max={50000}
                inputMode="numeric"
                placeholder="1000"
                value={draft.weight}
                onChange={(e) => patchDraft({ weight: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="np-stock" className="block text-[11px] font-medium text-slate-500">
                Stok <span className="text-slate-400">(opsional)</span>
              </label>
              <input
                id="np-stock"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="100"
                value={draft.stock}
                onChange={(e) => patchDraft({ stock: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <input
            type="text"
            aria-label="Deskripsi singkat produk"
            placeholder="Deskripsi singkat (opsional) — bahan, ukuran, varian…"
            value={draft.description}
            onChange={(e) => patchDraft({ description: e.target.value })}
            className={inputCls}
          />

          {/* Foto dikirim ke pembeli bersama balasan yang menyebut produk ini. */}
          <div className="space-y-1.5">
            <label
              htmlFor="np-image"
              className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
            >
              <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
              URL foto produk <span className="text-slate-400">(opsional)</span>
            </label>
            <div className="flex items-start gap-2.5">
              <input
                id="np-image"
                type="url"
                inputMode="url"
                placeholder="https://…/kaos-hitam.jpg"
                value={draft.image_url}
                onChange={(e) => patchDraft({ image_url: e.target.value })}
                className={inputCls}
              />
              {/* Pratinjau langsung: URL salah paling sering baru terasa saat
                  pembeli menerima balasan tanpa foto. */}
              {/^https?:\/\/\S+$/i.test(draft.image_url.trim()) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.image_url.trim()}
                  alt=""
                  className="w-11 h-11 shrink-0 rounded-xl object-cover border border-slate-200 bg-white"
                />
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Tempel tautan foto yang sudah online (mis. dari toko online Anda). AI mengirimkannya
              ke pembeli saat menyebut produk ini.
            </p>
          </div>

          <button
            type="submit"
            disabled={adding}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-card"
          >
            {adding ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{adding ? "Menyimpan…" : "Tambah produk"}</span>
          </button>
        </form>
      </section>

      {/* ── Daftar produk ────────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Daftar produk{" "}
            <span className="text-slate-400 normal-case tracking-normal font-medium">
              ({products.length})
            </span>
          </h3>
          {products.length > 3 && (
            <div className="relative w-full sm:w-56">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari produk"
                placeholder="Cari produk…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${inputCls} pl-9 py-2 bg-slate-50`}
              />
            </div>
          )}
        </div>

        {products.length === 0 ? (
          <div className="p-10 text-center border-2 border-dashed border-slate-200 rounded-2xl">
            <Package className="w-8 h-8 mx-auto text-slate-300 mb-2" aria-hidden="true" />
            <p className="text-sm text-slate-500">Belum ada produk</p>
            <p className="text-xs text-slate-400 mt-1">
              Tambahkan produk pertama Anda pada formulir di atas.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            Tidak ada produk yang cocok dengan &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((p) => {
              const isEditing = !!p.id && editingId === p.id;
              const isConfirming = !!p.id && confirmDeleteId === p.id;
              const noWeight = !Number(p.weight) || Number(p.weight) <= 0;
              // `stock` kosong = toko tidak memakai pencatatan stok (selalu ada).
              // Hanya angka NOL yang berarti habis.
              const outOfStock = p.stock !== undefined && p.stock !== null && Number(p.stock) === 0;
              const lowStock =
                p.stock !== undefined && p.stock !== null && Number(p.stock) > 0 && Number(p.stock) <= 3;

              return (
                <li
                  key={p.id || p.name}
                  className={`p-4 rounded-2xl border transition-colors ${
                    isEditing
                      ? "border-brand-300 bg-brand-50/40"
                      : isConfirming
                      ? "border-red-200 bg-red-50/60"
                      : "border-slate-200 bg-slate-50 hover:border-brand-200"
                  }`}
                >
                  {isEditing ? (
                    /* ── Mode edit ───────────────────────────────── */
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          aria-label="Nama produk"
                          value={editDraft.name}
                          onChange={(e) => patchEdit({ name: e.target.value })}
                          className={`${inputCls} sm:col-span-2`}
                        />
                        <input
                          type="number"
                          min={1}
                          aria-label="Harga"
                          value={editDraft.price}
                          onChange={(e) => patchEdit({ price: e.target.value })}
                          className={inputCls}
                        />
                        <input
                          type="number"
                          min={1}
                          max={50000}
                          aria-label="Berat dalam gram"
                          value={editDraft.weight}
                          onChange={(e) => patchEdit({ weight: e.target.value })}
                          className={inputCls}
                        />
                        <input
                          type="number"
                          min={0}
                          aria-label="Stok"
                          placeholder="Stok"
                          value={editDraft.stock}
                          onChange={(e) => patchEdit({ stock: e.target.value })}
                          className={inputCls}
                        />
                        <input
                          type="text"
                          aria-label="Deskripsi"
                          placeholder="Deskripsi"
                          value={editDraft.description}
                          onChange={(e) => patchEdit({ description: e.target.value })}
                          className={inputCls}
                        />
                        <input
                          type="url"
                          aria-label="URL foto produk"
                          placeholder="URL foto (https://…)"
                          value={editDraft.image_url}
                          onChange={(e) => patchEdit({ image_url: e.target.value })}
                          className={`${inputCls} sm:col-span-2`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(p.id!)}
                          disabled={savingEdit}
                          className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          {savingEdit ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : isConfirming ? (
                    /* ── Konfirmasi hapus (dulu langsung hapus tanpa tanya) ── */
                    <div className="space-y-3">
                      <div className="flex items-start gap-2.5">
                        <TriangleAlert className="w-4 h-4 text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
                        <p className="text-sm text-red-900">
                          Hapus <strong>{p.name}</strong> dari katalog? AI tidak akan lagi menyebut
                          produk ini.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id!)}
                          disabled={deletingId === p.id}
                          className="px-3.5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          {deletingId === p.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          Ya, hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Tampilan normal ─────────────────────────── */
                    <div className="flex justify-between items-start gap-3">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="w-14 h-14 shrink-0 rounded-xl object-cover border border-slate-200 bg-white"
                        />
                      ) : (
                        <div
                          className="w-14 h-14 shrink-0 rounded-xl border border-dashed border-slate-200 bg-white flex items-center justify-center"
                          title="Belum ada foto — pembeli hanya menerima teks"
                        >
                          <ImageIcon className="w-5 h-5 text-slate-300" aria-hidden="true" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-sm text-ink truncate">{p.name}</h4>
                        <p className="text-sm font-semibold text-brand-700 mt-0.5">
                          {formatRupiah(p.price)}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-400">
                          <span className={noWeight ? "text-amber-700 font-medium" : undefined}>
                            Berat: {formatWeight(p.weight)}
                            {noWeight && " ⚠"}
                          </span>
                          {p.stock !== undefined && p.stock !== null && !outOfStock && (
                            <span className={lowStock ? "text-amber-700 font-medium" : undefined}>
                              Stok: {Number(p.stock).toLocaleString("id-ID")}
                            </span>
                          )}
                          {/* Stok nol bukan sekadar angka kecil: AI berhenti
                              menawarkan produk ini, jadi harus terbaca sebagai
                              penanda, bukan baris teks di antara yang lain. */}
                          {outOfStock && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[10px] font-semibold">
                              <PackageX className="w-3 h-3" aria-hidden="true" />
                              Stok habis — tidak ditawarkan AI
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-xs text-slate-500 mt-2 line-clamp-2">{p.description}</p>
                        )}
                      </div>

                      {p.id && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(p)}
                            aria-label={`Ubah ${p.name}`}
                            title="Ubah produk"
                            className="p-2 text-slate-400 hover:text-brand-700 hover:bg-white rounded-lg transition-colors"
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setConfirmDeleteId(p.id!);
                            }}
                            aria-label={`Hapus ${p.name}`}
                            title="Hapus produk"
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
