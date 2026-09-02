"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users
} from "lucide-react";
import { MIN_PASSWORD, minPasswordError } from "@/lib/password-policy";
import { relativeTime, type ShowToast } from "./types";

/** Bentuk anggota yang dikirim `/api/members` — tanpa hash kata sandi. */
interface Member {
  id?: string;
  email: string;
  role: "admin" | "staff";
  last_login_at?: string | null;
  created_at?: string;
}

interface TeamMembersProps {
  showToast: ShowToast;
}

const inputCls =
  "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

const ROLE_LABELS: Record<Member["role"], string> = {
  admin: "Admin",
  staff: "Pegawai"
};


/**
 * Anggota tim yang boleh membuka dashboard toko ini.
 *
 * Memuat datanya sendiri, bukan lewat prop: daftar ini hanya relevan di satu
 * tempat dan hanya untuk pemilik toko, jadi tidak perlu ikut dibawa polling
 * dashboard tiap 25 detik.
 *
 * Sesi ANGGOTA mendapat 403 dari endpoint ini — bila boleh, satu pegawai bisa
 * mengangkat dirinya sendiri jadi pintu masuk permanen. Panel ini menyembunyikan
 * dirinya pada kasus itu, bukan menampilkan tombol yang pasti ditolak.
 */
export default function TeamMembers({ showToast }: TeamMembersProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [limit, setLimit] = useState(10);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Member["role"]>("staff");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Setel ulang kata sandi anggota. Hanya SATU baris yang boleh terbuka sekaligus:
  // tiga kolom kata sandi terbuka bersamaan di satu daftar membuat pemilik toko
  // mudah mengetikkan sandi orang lain ke baris yang salah.
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/members");
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setMembers(Array.isArray(data.members) ? (data.members as Member[]) : []);
      setNeedsMigration(!!data.needsMigration);
      if (typeof data.limit === "number") setLimit(data.limit);
    } catch {
      // Diamkan: panel ini bukan jalur utama dashboard, dan pesan galat merah
      // pada bagian yang tidak sedang dipakai hanya menakuti tanpa gunanya.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      showToast("Email anggota tidak valid.", "error");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      showToast(minPasswordError(), "error");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail, password, role })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menambah anggota.", "error");
        return;
      }
      showToast(`${mail} sekarang bisa masuk ke dashboard.`);
      setEmail("");
      setPassword("");
      setRole("staff");
      await load();
    } catch {
      showToast("Gagal menambah anggota.", "error");
    } finally {
      setAdding(false);
    }
  };

  /**
   * Setel kata sandi anggota tanpa mengeluarkannya dari tim.
   *
   * Ini satu-satunya jalur pemulihan yang dimiliki anggota tim: OTP reset dikirim
   * ke nomor WhatsApp TOKO dan hanya bisa mengganti kata sandi PEMILIK, jadi
   * pegawai yang lupa kata sandinya tidak punya cara sendiri untuk masuk lagi.
   * Sebelum tombol ini ada, satu-satunya penyelesaian adalah mengeluarkan lalu
   * menambahkannya kembali — yang menghapus jejak `last_login_at` tanpa alasan.
   */
  const handleResetPassword = async (id: string) => {
    if (resetPassword.length < MIN_PASSWORD) {
      showToast(minPasswordError(), "error");
      return;
    }
    setResettingId(id);
    try {
      const res = await fetch(`/api/members?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menyetel kata sandi anggota.", "error");
        return;
      }
      showToast(data.message || "Kata sandi anggota diperbarui.");
      setResetId(null);
      setResetPassword("");
      await load();
    } catch {
      showToast("Gagal menyetel kata sandi anggota.", "error");
    } finally {
      setResettingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/members?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal menghapus anggota.", "error");
        return;
      }
      showToast("Anggota dikeluarkan. Sesinya langsung berakhir.");
      setConfirmId(null);
      await load();
    } catch {
      showToast("Gagal menghapus anggota.", "error");
    } finally {
      setRemovingId(null);
    }
  };

  if (forbidden) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-600" aria-hidden="true" />
          Anggota tim
          {!loading && !needsMigration && (
            <span className="font-medium text-slate-400">
              ({members.length}/{limit})
            </span>
          )}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Beri pegawai akun sendiri untuk membuka dashboard dan menjawab chat. Mengeluarkan satu
          orang tidak lagi berarti mengganti kata sandi untuk semua. Kalau ada yang lupa kata
          sandinya, setel yang baru lewat ikon kunci — anggota tim tidak bisa memakai jalur OTP
          karena OTP dikirim ke nomor toko.
        </p>
      </div>

      {needsMigration ? (
        <div className="flex items-start gap-2.5 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-amber-900 leading-relaxed">
            Fitur anggota tim belum aktif di database. Jalankan{" "}
            <code className="px-1 py-0.5 bg-white border border-amber-200 rounded">
              supabase/schema.sql
            </code>{" "}
            versi terbaru, lalu muat ulang halaman ini.
          </p>
        </div>
      ) : (
        <>
          {/* ── Daftar anggota ───────────────────────────────────────── */}
          {loading ? (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Memuat anggota…
            </p>
          ) : members.length === 0 ? (
            <p className="text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl py-6 text-center">
              Belum ada anggota. Hanya akun pemilik yang bisa masuk.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {members.map((m) => {
                const confirming = !!m.id && confirmId === m.id;
                const resetting = !!m.id && resetId === m.id;
                return (
                  <li key={m.id || m.email} className="px-3.5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink truncate">{m.email}</p>
                        <p className="text-[11px] text-slate-400">
                          {m.last_login_at
                            ? `Terakhir masuk ${relativeTime(m.last_login_at)}`
                            : "Belum pernah masuk"}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                          m.role === "admin"
                            ? "bg-brand-50 text-brand-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {m.role === "admin" && (
                          <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                        )}
                        {ROLE_LABELS[m.role]}
                      </span>
                      {m.id && !confirming && (
                        <div className="shrink-0 flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              setResetId(resetting ? null : m.id!);
                              setResetPassword("");
                            }}
                            aria-label={`Setel kata sandi ${m.email}`}
                            aria-expanded={resetting}
                            title="Setel kata sandi baru"
                            className={`p-2 rounded-lg transition-colors ${
                              resetting
                                ? "text-brand-700 bg-brand-50"
                                : "text-slate-400 hover:text-brand-600 hover:bg-slate-50"
                            }`}
                          >
                            <KeyRound className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(m.id!)}
                            aria-label={`Keluarkan ${m.email}`}
                            title="Keluarkan dari tim"
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>

                    {resetting && !confirming && (
                      <div className="mt-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                        <label
                          htmlFor={`member-pwd-${m.id}`}
                          className="block text-xs font-semibold text-slate-600"
                        >
                          Kata sandi baru untuk {m.email}
                        </label>
                        <input
                          id={`member-pwd-${m.id}`}
                          type="text"
                          minLength={MIN_PASSWORD}
                          autoComplete="off"
                          placeholder={`Minimal ${MIN_PASSWORD} karakter`}
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          onKeyDown={(e) => {
                            // Panel ini bukan <form> — akar TeamMembers memakai satu
                            // form untuk "Tambah anggota", dan Enter di sini tidak
                            // boleh ikut men-submit form itu.
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleResetPassword(m.id!);
                            }
                          }}
                          className={inputCls}
                        />
                        {/* Sengaja type="text": pemilik toko HARUS bisa membaca
                            kata sandi yang baru saja dibuatnya untuk disampaikan ke
                            orangnya — ini bukan kata sandi miliknya sendiri, dan
                            titik-titik hanya membuatnya salah dibacakan. */}
                        <p className="text-[11px] text-slate-400">
                          Terlihat supaya bisa Anda sampaikan langsung ke orangnya. Setelah disimpan,
                          sesi lamanya di semua perangkat langsung berakhir dan dia harus masuk
                          dengan kata sandi ini.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleResetPassword(m.id!)}
                            disabled={resettingId === m.id || resetPassword.length < MIN_PASSWORD}
                            className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            {resettingId === m.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            Simpan kata sandi
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetId(null);
                              setResetPassword("");
                            }}
                            className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}

                    {confirming && (
                      <div className="mt-2.5 p-3 bg-red-50 border border-red-200 rounded-xl space-y-2.5">
                        <p className="text-xs text-red-900">
                          Keluarkan <strong>{m.email}</strong>? Sesinya langsung berakhir dan dia
                          tidak bisa masuk lagi.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleRemove(m.id!)}
                            disabled={removingId === m.id}
                            className="px-3.5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            {removingId === m.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            Ya, keluarkan
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg transition-colors"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* ── Tambah anggota ───────────────────────────────────────── */}
          {members.length >= limit ? (
            <p className="text-xs text-slate-500">
              Batas {limit} anggota sudah tercapai. Keluarkan salah satu untuk menambah yang baru.
            </p>
          ) : (
            <form
              onSubmit={handleAdd}
              className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3"
            >
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Tambah anggota
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="email"
                  required
                  aria-label="Email anggota"
                  placeholder="pegawai@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                />
                <input
                  type="password"
                  required
                  minLength={MIN_PASSWORD}
                  aria-label="Kata sandi anggota"
                  placeholder={`Kata sandi (min ${MIN_PASSWORD})`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                />
                <select
                  aria-label="Peran anggota"
                  value={role}
                  onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "staff")}
                  className={inputCls}
                >
                  <option value="staff">Pegawai</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {/* Batas yang jujur: peran hanya penanda, bukan pembatas akses. */}
              <p className="text-[11px] text-slate-400">
                Anggota melihat data yang sama dengan Anda, tapi tidak bisa mengelola anggota lain
                atau mengubah langganan. Sampaikan kata sandi ini langsung ke orangnya — Anda tidak
                bisa melihatnya lagi setelah disimpan.
              </p>
              <button
                type="submit"
                disabled={adding}
                className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors flex items-center gap-1.5 shadow-card"
              >
                {adding ? (
                  <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                )}
                <span>{adding ? "Menyimpan…" : "Tambah anggota"}</span>
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
