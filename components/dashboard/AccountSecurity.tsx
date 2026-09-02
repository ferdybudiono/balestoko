"use client";

import { useState } from "react";
import { CheckCircle, Eye, EyeOff, KeyRound, RefreshCw, TriangleAlert } from "lucide-react";
import { MIN_PASSWORD, minPasswordError } from "@/lib/password-policy";
import type { ShowToast } from "./types";

interface AccountSecurityProps {
  /** Email akun yang sedang login — pemilik toko maupun anggota tim. */
  email: string;
  showToast: ShowToast;
}

const inputCls =
  "w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";

/**
 * Ganti kata sandi sendiri, dari dalam dashboard.
 *
 * Sebelum panel ini ada, satu-satunya cara mengganti kata sandi adalah OTP lewat
 * WhatsApp — jalur yang tidak selalu tersedia: nomor toko bisa sedang terputus,
 * dan akun yang baru mendaftar belum punya nomor sama sekali. Jadi endpoint
 * `POST /api/auth/password` sudah ada tapi tidak punya satu pun pemanggil; ini
 * pemanggilnya.
 *
 * Terlipat secara bawaan: ini bukan pekerjaan harian, dan tiga kolom kata sandi
 * yang selalu terbuka di halaman pengaturan toko hanya menambah kebisingan.
 *
 * Melayani anggota tim juga — endpoint di baliknya memilih baris yang benar dari
 * sesi, jadi panel ini tidak perlu tahu apakah pemakainya pemilik atau pegawai.
 */
export default function AccountSecurity({ email, showToast }: AccountSecurityProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  const clear = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setReveal(false);
  };

  // Diperiksa saat mengetik supaya kesalahan yang paling sering terjadi — salah
  // ketik di kolom ulangi — tidak perlu satu perjalanan ke server dulu.
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const sameAsOld = next.length > 0 && next === current;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready =
    current.length > 0 && next.length >= MIN_PASSWORD && !sameAsOld && confirm === next;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Gagal mengganti kata sandi.", "error");
        return;
      }
      // Sesi pemanggil sengaja DIPERTAHANKAN oleh endpoint (cookie diterbitkan
      // ulang), jadi tidak ada redirect ke /login di sini. Yang perlu dikatakan
      // adalah bahwa perangkat LAIN dikeluarkan — itulah inti mengganti kata sandi
      // ketika Anda curiga akun sedang dipakai orang lain.
      showToast(data.message || "Kata sandi diperbarui.");
      setChanged(true);
      clear();
      setOpen(false);
    } catch {
      showToast("Gagal mengganti kata sandi. Periksa koneksi Anda.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-card p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-600" aria-hidden="true" />
            Kata sandi akun
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Akun yang sedang dipakai: <strong className="text-slate-600">{email || "—"}</strong>.
            Mengganti kata sandi mengeluarkan semua perangkat lain, tapi tidak mengeluarkan Anda
            dari halaman ini.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
          >
            Ganti kata sandi
          </button>
        )}
      </div>

      {changed && !open && (
        <p className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
          <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Kata sandi sudah diperbarui. Perangkat lain yang masih terbuka akan diminta masuk lagi.
          </span>
        </p>
      )}

      {open && (
        <form
          onSubmit={handleSubmit}
          className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3"
        >
          <div>
            <label htmlFor="pwd-current" className={labelCls}>
              Kata sandi sekarang
            </label>
            <input
              id="pwd-current"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputCls}
            />
            {/* Selalu diminta, bahkan saat sudah login: sesi yang dicuri tidak
                boleh cukup untuk mengunci pemilik aslinya keluar dari akunnya. */}
            <p className="text-[11px] text-slate-400 mt-1">
              Diminta supaya orang yang memakai perangkat Anda tanpa izin tidak bisa mengambil alih
              akun ini.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pwd-new" className={labelCls}>
                Kata sandi baru
              </label>
              <div className="relative">
                <input
                  id="pwd-new"
                  type={reveal ? "text" : "password"}
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  aria-describedby="pwd-new-hint"
                  className={`${inputCls} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                >
                  {reveal ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <p id="pwd-new-hint" className="text-[11px] text-slate-400 mt-1">
                Minimal {MIN_PASSWORD} karakter.
              </p>
            </div>

            <div>
              <label htmlFor="pwd-confirm" className={labelCls}>
                Ulangi kata sandi baru
              </label>
              <input
                id="pwd-confirm"
                type={reveal ? "text" : "password"}
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {(tooShort || sameAsOld || mismatch) && (
            <p className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <TriangleAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {mismatch
                  ? "Kolom ulangi belum sama dengan kata sandi baru."
                  : sameAsOld
                    ? "Kata sandi baru masih sama dengan yang sekarang."
                    : minPasswordError("Kata sandi baru")}
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!ready || saving}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors shadow-card flex items-center gap-1.5"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{saving ? "Menyimpan…" : "Simpan kata sandi baru"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                clear();
                setOpen(false);
              }}
              className="text-xs font-medium text-slate-400 hover:text-slate-600 underline"
            >
              Batal
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
