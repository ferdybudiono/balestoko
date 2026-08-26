"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  User,
  Phone,
  Mail,
  Store,
  Lock,
  Loader2,
  AlertCircle,
  Gift,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";

interface TrialModalProps {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  whatsapp: string;
  email: string;
  storeName: string;
  password: string;
}

const EMPTY_FORM: FormState = { name: "", whatsapp: "", email: "", storeName: "", password: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function TrialModal({ open, onClose }: TrialModalProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setErrors({});
      setServerError(null);
      const t = setTimeout(() => firstFieldRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<FormState> = {};
    if (form.name.trim().length < 3) next.name = "Nama minimal 3 karakter.";
    if (form.whatsapp.replace(/\D/g, "").length < 9) next.whatsapp = "Nomor WhatsApp tidak valid.";
    if (!EMAIL_RE.test(form.email)) next.email = "Format email salah.";
    if (form.storeName.trim().length < 2) next.storeName = "Nama toko wajib diisi.";
    if (form.password.length < 6) next.password = "Kata sandi minimal 6 karakter.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch("/api/auth/register-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          whatsapp: form.whatsapp,
          email: form.email,
          storeName: form.storeName,
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerError(data?.error || "Gagal memulai uji coba.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setServerError("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="trial-title">
      <div className="absolute inset-0 bg-ink/60 backdrop-blur-sm animate-fade-in" onClick={() => !submitting && onClose()} />
      {/* Tinggi dibatasi & isian yang menggulir — lihat CheckoutModal: tanpa ini
          tombol di dasar panel bisa keluar layar pada viewport pendek. */}
      <div className="relative flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden animate-scale-in rounded-t-3xl bg-white shadow-card-lg sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5 pb-4 sm:p-6 sm:pb-5">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-600">
              <Gift className="h-3.5 w-3.5" /> Uji Coba Gratis
            </p>
            <h2 id="trial-title" className="mt-1 text-lg font-bold text-ink sm:text-xl">Coba 7 Hari Tanpa Bayar</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Akses penuh fitur Pro. Tanpa kartu kredit.</p>
          </div>
          <button onClick={() => !submitting && onClose()} disabled={submitting} aria-label="Tutup" className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
          <div className="space-y-3.5">
            <TrialField ref={firstFieldRef} icon={<User className="h-4 w-4" />} label="Nama Lengkap" placeholder="mis. Budi Santoso" value={form.name} onChange={(v) => update("name", v)} error={errors.name} autoComplete="name" />
            <TrialField icon={<Phone className="h-4 w-4" />} label="Nomor WhatsApp Toko" placeholder="mis. 0812xxxxxxx" value={form.whatsapp} onChange={(v) => update("whatsapp", v)} error={errors.whatsapp} inputMode="tel" autoComplete="tel" />
            <TrialField icon={<Mail className="h-4 w-4" />} label="Email Akun Toko" placeholder="mis. budi@email.com" value={form.email} onChange={(v) => update("email", v)} error={errors.email} type="email" inputMode="email" autoComplete="email" />
            <TrialField icon={<Store className="h-4 w-4" />} label="Nama Toko Anda" placeholder="mis. Toko Budi Jaya" value={form.storeName} onChange={(v) => update("storeName", v)} error={errors.storeName} autoComplete="organization" />
            <TrialField icon={<Lock className="h-4 w-4" />} label="Kata Sandi (untuk login dashboard)" placeholder="min. 6 karakter" value={form.password} onChange={(v) => update("password", v)} error={errors.password} type="password" revealable autoComplete="new-password" />
          </div>

          {serverError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}
          </div>

          <div className="shrink-0 border-t border-slate-100 bg-white px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-base font-semibold text-white shadow-glow transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70">
            {submitting ? (<><Loader2 className="h-5 w-5 animate-spin" /> Membuat akun uji coba…</>) : (<><Gift className="h-4 w-4" /> Mulai Uji Coba 7 Hari <ArrowRight className="h-4 w-4" /></>)}
          </button>
          <p className="mt-3 text-center text-xs text-ink-muted">
            Setelah 7 hari, langganan berbayar diperlukan untuk melanjutkan.
          </p>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TrialFieldProps {
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
}

const TrialField = forwardRef<HTMLInputElement, TrialFieldProps>(function TrialField(
  { icon, label, placeholder, value, onChange, error, type = "text", revealable = false, inputMode, autoComplete },
  ref
) {
  const [reveal, setReveal] = useState(false);
  const effectiveType = revealable ? (reveal ? "text" : "password") : type;
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
        <input
          ref={ref}
          type={effectiveType}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border bg-white py-2.5 pl-10 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:ring-4 ${
            revealable ? "pr-10" : "pr-3.5"
          } ${
            error ? "border-red-300 focus:border-red-400 focus:ring-red-100" : "border-slate-200 focus:border-brand-400 focus:ring-brand-100"
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
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
});
