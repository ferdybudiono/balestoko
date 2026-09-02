"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MIN_PASSWORD, minPasswordError } from "@/lib/password-policy";
import {
  X,
  User,
  Phone,
  Mail,
  Store,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowRight,
  Ticket,
  Eye,
  EyeOff,
} from "lucide-react";
import { formatIDR, type Plan } from "@/lib/packages";
import { validateCouponForPlan, applyDiscount } from "@/lib/coupons";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "paying" }
  | { kind: "success"; orderId: string }
  | { kind: "pending"; orderId: string }
  /**
   * `needsLogin` = email sudah punya akun, jadi ini PERPANJANGAN dan server minta
   * bukti kepemilikan (sesi) sebelum menerima pembayaran. Tanpa tautan login di
   * sini, pelanggan lama yang mau memperpanjang mentok tanpa jalan keluar.
   */
  | { kind: "error"; message: string; needsLogin?: boolean };

interface CheckoutModalProps {
  plan: Plan | null;
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  whatsapp: string;
  email: string;
  storeName: string;
  password: string;
  coupon: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  whatsapp: "",
  email: "",
  storeName: "",
  password: "",
  coupon: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CheckoutModal({
  plan,
  open,
  onClose,
}: CheckoutModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /**
   * Email pemilik sesi yang sedang login, bila ada. Kehadirannya mengubah arti
   * formulir ini: pembayaran menjadi PERPANJANGAN akun tersebut, bukan pendaftaran
   * akun baru — jadi kata sandi tidak lagi diminta dan email dikunci.
   */
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const busy = status.kind === "submitting" || status.kind === "paying";
  const isRenewal = !!sessionEmail;

  // Reset saat modal dibuka untuk paket baru.
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setErrors({});
      setStatus({ kind: "idle" });
      const t = setTimeout(() => firstFieldRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, plan?.id]);

  // Cek sesi hanya saat modal dibuka — halaman harga tidak perlu membayar
  // permintaan ini sampai pengunjung benar-benar berniat membayar.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.email) return;
        setSessionEmail(d.email);
        setForm((f) => ({ ...f, email: d.email }));
      })
      .catch(() => {
        // Gagal mengecek sesi → perlakukan sebagai pengunjung baru. Server tetap
        // jadi otoritas: perpanjangan tanpa sesi akan ditolak dengan 409.
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Tutup dengan tombol ESC.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  // Kunci scroll body saat modal terbuka.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  if (!open || !plan) return null;

  // Preview kupon di sisi klien (server tetap jadi otoritas final saat checkout).
  const couponInput = form.coupon.trim();
  const couponCheck = couponInput ? validateCouponForPlan(couponInput, plan.id) : null;
  const couponValid = !!couponCheck?.valid && !!couponCheck.coupon;
  const effectivePrice = couponValid
    ? applyDiscount(plan.price, couponCheck!.coupon!.discountPercent)
    : plan.price;

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<FormState> = {};
    if (form.name.trim().length < 3) next.name = "Nama minimal 3 karakter.";
    if (form.whatsapp.replace(/\D/g, "").length < 9)
      next.whatsapp = "Nomor WhatsApp tidak valid.";
    if (!EMAIL_RE.test(form.email)) next.email = "Format email salah.";
    if (form.storeName.trim().length < 2)
      next.storeName = "Nama toko wajib diisi.";
    // Perpanjangan memakai akun yang sudah ada, jadi tidak ada kata sandi baru.
    if (!isRenewal && form.password.length < MIN_PASSWORD)
      next.password = minPasswordError();
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !plan) return;
    if (!validate()) return;

    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: plan.id,
          name: form.name,
          whatsapp: form.whatsapp,
          email: form.email,
          storeName: form.storeName,
          password: isRenewal ? undefined : form.password,
          coupon: form.coupon.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data?.error || "Gagal memproses checkout.",
          needsLogin: !!data?.needsLogin,
        });
        return;
      }

      const { token, order_id: orderId } = data as {
        token: string;
        order_id: string;
      };

      if (!window.snap) {
        setStatus({
          kind: "error",
          message:
            "Snap belum termuat. Pastikan NEXT_PUBLIC_MIDTRANS_CLIENT_KEY sudah di-set, lalu refresh.",
        });
        return;
      }

      // Picu pop-up pembayaran Midtrans Snap.
      setStatus({ kind: "paying" });
      window.snap.pay(token, {
        onSuccess: () => setStatus({ kind: "success", orderId }),
        onPending: () => setStatus({ kind: "pending", orderId }),
        onError: () =>
          setStatus({
            kind: "error",
            message: "Pembayaran gagal diproses. Silakan coba lagi.",
          }),
        onClose: () =>
          setStatus((s) =>
            s.kind === "paying" ? { kind: "idle" } : s
          ),
      });
    } catch {
      setStatus({
        kind: "error",
        message: "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
      });
    }
  }

  const terminal =
    status.kind === "success" || status.kind === "pending";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-title"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm animate-fade-in"
        onClick={() => !busy && onClose()}
      />

      {/*
        Panel — TINGGI DIBATASI & isinya yang menggulir, bukan halaman.
        Scroll body dimatikan selama modal terbuka (lihat efek di atas), jadi
        panel tanpa batas tinggi berarti tombol "Bayar" di bawahnya keluar dari
        layar dan tidak bisa dijangkau sama sekali pada ponsel pendek atau saat
        keyboard virtual muncul. Karena itu: kolom flex dengan tinggi maksimum,
        satu-satunya area yang menggulir adalah isian formulir, dan footer
        (tombol bayar) selalu menempel di dasar panel.
      */}
      <div className="relative flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden animate-scale-in rounded-t-3xl bg-white shadow-card-lg sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5 pb-4 sm:p-6 sm:pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Checkout Pembayaran
            </p>
            <h2
              id="checkout-title"
              className="mt-1 text-lg font-bold text-ink sm:text-xl"
            >
              Paket {plan.name}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">{plan.tagline}</p>
          </div>
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Tutup"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        {terminal ? (
          <ResultView status={status} planName={plan.name} email={form.email} onClose={onClose} />
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* Area isian — SATU-SATUNYA bagian yang menggulir. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
            {/* Ringkasan harga */}
            <div className="mb-4 flex items-center justify-between rounded-2xl bg-brand-50 px-4 py-3">
              <span className="text-sm font-medium text-brand-800">
                Total pembayaran
              </span>
              <div className="text-right">
                {couponValid && (
                  <span className="mr-2 text-sm text-brand-400 line-through">
                    {formatIDR(plan.price)}
                  </span>
                )}
                <span className="text-lg font-extrabold text-brand-700">
                  {formatIDR(effectivePrice)}
                </span>
                <span className="text-xs text-brand-600">{plan.period}</span>
                {couponValid && (
                  <span className="mt-0.5 block text-[11px] font-semibold text-emerald-600">
                    Kupon “{couponCheck!.coupon!.code}” diterapkan −{couponCheck!.coupon!.discountPercent}%
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3.5">
              {isRenewal && (
                <div className="flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Pembayaran ini masuk ke akun{" "}
                    <strong className="break-all">{sessionEmail}</strong> yang sedang login — bukan
                    akun baru. Produk, nomor WhatsApp, dan riwayat chat Anda tetap utuh. Masa aktif
                    30 hari; bila langganan sekarang masih berjalan, sisa harinya ditambahkan.
                  </span>
                </div>
              )}
              <Field
                ref={firstFieldRef}
                icon={<User className="h-4 w-4" />}
                label="Nama Lengkap"
                placeholder="mis. Budi Santoso"
                value={form.name}
                onChange={(v) => update("name", v)}
                error={errors.name}
                autoComplete="name"
              />
              <Field
                icon={<Phone className="h-4 w-4" />}
                label="Nomor WhatsApp Toko"
                placeholder="mis. 0812xxxxxxx"
                value={form.whatsapp}
                onChange={(v) => update("whatsapp", v)}
                error={errors.whatsapp}
                inputMode="tel"
                autoComplete="tel"
              />
              <Field
                icon={<Mail className="h-4 w-4" />}
                label="Email Akun Toko"
                placeholder="mis. budi@email.com"
                value={form.email}
                onChange={(v) => update("email", v)}
                error={errors.email}
                type="email"
                inputMode="email"
                autoComplete="email"
                readOnly={isRenewal}
                hint={isRenewal ? "Terkunci ke akun yang sedang login." : undefined}
              />
              <Field
                icon={<Store className="h-4 w-4" />}
                label="Nama Toko Anda"
                placeholder="mis. Toko Budi Jaya"
                value={form.storeName}
                onChange={(v) => update("storeName", v)}
                error={errors.storeName}
                autoComplete="organization"
              />
              {/* Perpanjangan tidak membuat akun baru, jadi tidak ada kata sandi
                  baru — dan server memang mengabaikannya untuk kasus ini. */}
              {!isRenewal && (
                <Field
                  icon={<Lock className="h-4 w-4" />}
                  label="Kata Sandi (untuk login dashboard)"
                  placeholder="min. 6 karakter"
                  value={form.password}
                  onChange={(v) => update("password", v)}
                  error={errors.password}
                  type="password"
                  revealable
                  autoComplete="new-password"
                />
              )}
              <div>
                <Field
                  icon={<Ticket className="h-4 w-4" />}
                  label="Kode Kupon (opsional)"
                  placeholder="Punya kode kupon?"
                  value={form.coupon}
                  onChange={(v) => update("coupon", v)}
                  autoComplete="off"
                />
                {couponInput && !couponValid && (
                  <span className="mt-1 block text-xs text-amber-600">
                    {couponCheck?.error || "Kupon tidak valid untuk paket ini."}
                  </span>
                )}
                {couponValid && (
                  <span className="mt-1 block text-xs text-emerald-600">
                    Hemat {formatIDR(plan.price - effectivePrice)}! Kupon berlaku untuk akun baru.
                  </span>
                )}
              </div>
            </div>

            {status.kind === "error" && (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <span>{status.message}</span>
                  {status.needsLogin && (
                    <a
                      href="/login"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                    >
                      Login ke akun saya <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )}
            </div>

            {/*
              Footer tetap — tombol bayar tidak pernah ikut tergulir keluar.
              `pb` memakai safe-area agar tidak tertutup home indicator iOS.
            */}
            <div className="shrink-0 border-t border-slate-100 bg-white px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <button
              type="submit"
              disabled={busy}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3.5 text-base font-semibold text-white shadow-glow transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {status.kind === "submitting" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Memproses Order…
                </>
              ) : status.kind === "paying" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Membuka Snap Midtrans…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Bayar {formatIDR(effectivePrice)} via Midtrans
                </>
              )}
            </button>

            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
              Pembayaran aman &amp; terenkripsi via Midtrans
            </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------- Sub-komponen ---------- */

interface FieldProps {
  icon: React.ReactNode;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  revealable?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  /** Nilainya sudah ditentukan (mis. email dari sesi yang sedang login). */
  readOnly?: boolean;
  /** Keterangan kecil di bawah input; disembunyikan bila ada `error`. */
  hint?: string;
}

const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    icon,
    label,
    placeholder,
    value,
    onChange,
    error,
    type = "text",
    revealable = false,
    inputMode,
    autoComplete,
    readOnly = false,
    hint,
  },
  ref
) {
  const [reveal, setReveal] = useState(false);
  const effectiveType = revealable ? (reveal ? "text" : "password") : type;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">
        {label}
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </span>
        <input
          ref={ref}
          type={effectiveType}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border py-2.5 pl-10 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:ring-4 ${
            readOnly ? "bg-slate-50 text-ink-soft" : "bg-white"
          } ${revealable ? "pr-10" : "pr-3.5"} ${
            error
              ? "border-red-300 focus:border-red-400 focus:ring-red-100"
              : "border-slate-200 focus:border-brand-400 focus:ring-brand-100"
          }`}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-0.5 text-slate-400 transition hover:text-slate-600"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error && (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      )}
      {!error && hint && (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      )}
    </label>
  );
});

function ResultView({
  status,
  planName,
  email,
  onClose,
}: {
  status: Status;
  planName: string;
  email: string;
  onClose: () => void;
}) {
  const success = status.kind === "success";
  const orderId =
    status.kind === "success" || status.kind === "pending"
      ? status.orderId
      : "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center space-y-4 sm:p-8">
      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
          success ? "bg-emerald-100" : "bg-amber-100"
        }`}
      >
        {success ? (
          <CheckCircle2 className="h-9 w-9 text-emerald-600" />
        ) : (
          <Loader2 className="h-9 w-9 text-amber-600" />
        )}
      </div>
      <h3 className="text-xl font-bold text-ink">
        {success ? "Pembayaran Berhasil! 🎉" : "Menunggu Pembayaran"}
      </h3>
      <p className="mx-auto max-w-xs text-sm text-ink-muted">
        {success
          ? `Terima kasih! Pembayaran Paket ${planName} sukses. Silakan login memakai email & kata sandi yang tadi Anda buat untuk menautkan WhatsApp.`
          : "Selesaikan pembayaran sesuai instruksi. Status akan otomatis terupdate setelah pembayaran diterima."}
      </p>
      {orderId && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 font-mono">
          ID Order: {orderId}
        </p>
      )}

      {success ? (
        <Link
          href={email ? `/login?email=${encodeURIComponent(email)}` : "/login"}
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 px-5 py-3.5 text-sm font-semibold text-white transition shadow-glow"
        >
          <span>Login ke Dashboard</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      ) : (
        <button
          onClick={onClose}
          className="w-full rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft"
        >
          Tutup
        </button>
      )}
    </div>
  );
}
