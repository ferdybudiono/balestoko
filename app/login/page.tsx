"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Mail, Lock, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simpan session email sederhana ke localStorage untuk demo
    if (typeof window !== "undefined") {
      localStorage.setItem("user_email", email || "demo@balestoko.com");
    }
    setTimeout(() => {
      router.push("/dashboard");
    }, 600);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Background Decorator Gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[400px] h-[400px] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Header Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-white mb-2 hover:opacity-90 transition-opacity">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20">
              <Bot className="w-6 h-6" />
            </div>
            <span>BalesToko<span className="text-emerald-400">.ai</span></span>
          </Link>
          <p className="text-sm text-slate-400">
            Login ke Dashboard Pengaturan WhatsApp CS AI & Mengantar Ongkir
          </p>
        </div>

        {/* Card Form */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Email Terdaftar / Email Pembelian
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="nama@tokomu.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold rounded-xl transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 group disabled:opacity-50"
            >
              {loading ? (
                <span>Memproses Login...</span>
              ) : (
                <>
                  <span>Masuk ke Dashboard</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">
              Belum berlangganan paket?{" "}
              <Link href="/#pricing" className="text-emerald-400 hover:underline font-medium">
                Pilih Paket & Bayar via Midtrans
              </Link>
            </p>
          </div>
        </div>

        {/* Feature Badges */}
        <div className="mt-8 flex flex-wrap justify-center gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Integrasi Fonnte WA Gateway</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Cek Ongkir Mengantar API</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-900/60 border border-slate-800 px-3 py-1.5 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Midtrans Payment Verified</span>
          </div>
        </div>
      </div>
    </div>
  );
}
