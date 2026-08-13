"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Mail, Lock, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("user_email", email || "demo@balestoko.com");
    }
    setTimeout(() => {
      router.push("/dashboard");
    }, 600);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 text-gray-900 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Decorative Circles */}
      <div className="absolute top-20 right-20 w-72 h-72 bg-emerald-200/30 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-20 left-20 w-96 h-96 bg-teal-200/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Header Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gray-900 mb-2 hover:opacity-90 transition-opacity">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <Bot className="w-6 h-6" />
            </div>
            <span>BalesToko<span className="text-emerald-600">.ai</span></span>
          </Link>
          <p className="text-sm text-gray-500 mt-1">
            Masuk ke Dashboard Pengaturan WhatsApp AI Toko Anda
          </p>
        </div>

        {/* Card Form */}
        <div className="bg-white border border-gray-200 rounded-3xl p-6 sm:p-8 shadow-xl shadow-gray-200/50">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
                Email Terdaftar
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  required
                  placeholder="nama@tokomu.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 group disabled:opacity-50"
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

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
              Belum berlangganan?{" "}
              <Link href="/#pricing" className="text-emerald-600 hover:underline font-medium">
                Pilih Paket & Daftar Sekarang
              </Link>
            </p>
          </div>
        </div>

        {/* Feature Badges */}
        <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Bot WhatsApp AI Otomatis</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Cek Ongkir Kurir Otomatis</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-teal-500" />
            <span>AI CS 24/7 Non-Stop</span>
          </div>
        </div>
      </div>
    </div>
  );
}
