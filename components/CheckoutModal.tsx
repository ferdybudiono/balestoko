"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { formatIDR, type Plan } from "@/lib/packages";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "paying" }
  | { kind: "success"; orderId: string }
  | { kind: "pending"; orderId: string }
  | { kind: "error"; message: string };

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
}

const EMPTY_FORM: FormState = {
  name: "",
  whatsapp: "",
  email: "",
  storeName: "",
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
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const busy = status.kind === "submitting" || status.kind === "paying";

  // Reset saat modal dibuka untuk paket baru.
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setErrors({});
      setStatus({ kind: "idle" });
      // Fokus ke field pertama untuk aksesibilitas.
      const t = setTimeout(() => firstFieldRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, plan?.id]);

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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data?.error || "Gagal memproses checkout.",
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
            // Hanya kembali ke form kalau user menutup pop-up tanpa hasil.
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

      {/* Panel */}
      <div className="relative w-full max-w-md animate-scale-in rounded-t-3xl bg-white shadow-card-lg sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Checkout
            </p>
            <h2
              id="checkout-title"
              className="mt-1 text-xl font-bold text-ink"
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
          <ResultView status={status} planName={plan.name} onClose={onClose} />
        ) : (
          <form onSubmit={handleSubmit} className="p-6 pt-5">
            {/* Ringkasan harga */}
            <div className="mb-5 flex items-center justify-between rounded-2xl bg-brand-50 px-4 py-3">
              <span className="text-sm font-medium text-brand-800">
                Total pembayaran
              </span>
              <div className="text-right">
                <span className="text-lg font-extrabold text-brand-700">
                  {formatIDR(plan.price)}
                </span>
                <span className="text-xs text-brand-600">{plan.period}</span>
              </div>
            </div>

            <div className="space-y-3.5">
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
                label="Nomor WhatsApp"
                placeholder="mis. 0812xxxxxxx"
                value={form.whatsapp}
                onChange={(v) => update("whatsapp", v)}
                error={errors.whatsapp}
                inputMode="tel"
                autoComplete="tel"
              />
              <Field
                icon={<Mail className="h-4 w-4" />}
                label="Email"
                placeholder="mis. budi@email.com"
                value={form.email}
                onChange={(v) => update("email", v)}
                error={errors.email}
                type="email"
                inputMode="email"
                autoComplete="email"
              />
              <Field
                icon={<Store className="h-4 w-4" />}
                label="Nama Toko"
                placeholder="mis. Toko Budi Jaya"
                value={form.storeName}
                onChange={(v) => update("storeName", v)}
                error={errors.storeName}
                autoComplete="organization"
              />
            </div>

            {status.kind === "error" && (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{status.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="group mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3.5 text-base font-semibold text-white shadow-glow transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {status.kind === "submitting" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Memproses…
                </>
              ) : status.kind === "paying" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Membuka pembayaran…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Bayar {formatIDR(plan.price)}
                </>
              )}
            </button>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
              Pembayaran aman &amp; terenkripsi via Midtrans
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
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
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
    inputMode,
    autoComplete,
  },
  ref
) {
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
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border bg-white py-2.5 pl-10 pr-3.5 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:ring-4 ${
            error
              ? "border-red-300 focus:border-red-400 focus:ring-red-100"
              : "border-slate-200 focus:border-brand-400 focus:ring-brand-100"
          }`}
        />
      </div>
      {error && (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      )}
    </label>
  );
});

function ResultView({
  status,
  planName,
  onClose,
}: {
  status: Status;
  planName: string;
  onClose: () => void;
}) {
  const success = status.kind === "success";
  const orderId =
    status.kind === "success" || status.kind === "pending"
      ? status.orderId
      : "";

  return (
    <div className="p-8 text-center">
      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
          success ? "bg-brand-100" : "bg-amber-100"
        }`}
      >
        {success ? (
          <CheckCircle2 className="h-9 w-9 text-brand-600" />
        ) : (
          <Loader2 className="h-9 w-9 text-amber-600" />
        )}
      </div>
      <h3 className="mt-5 text-xl font-bold text-ink">
        {success ? "Pembayaran Berhasil! 🎉" : "Menunggu Pembayaran"}
      </h3>
      <p className="mx-auto mt-2 max-w-xs text-sm text-ink-muted">
        {success
          ? `Terima kasih! Paket ${planName} Anda sedang kami aktifkan. Tim kami akan menghubungi Anda via WhatsApp.`
          : "Selesaikan pembayaran sesuai instruksi. Status akan otomatis terupdate setelah pembayaran diterima."}
      </p>
      {orderId && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          ID Order: <span className="font-mono">{orderId}</span>
        </p>
      )}
      <button
        onClick={onClose}
        className="mt-6 w-full rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft"
      >
        Selesai
      </button>
    </div>
  );
}
