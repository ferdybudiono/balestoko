"use client";

import { ArrowRight, MessageCircle } from "lucide-react";

export default function FinalCTA({ onCtaClick }: { onCtaClick: () => void }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-brand-600 px-6 py-16 text-center shadow-glow sm:px-16">
          {/* dekorasi */}
          <div className="pointer-events-none absolute inset-0 opacity-20">
            <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white blur-2xl" />
            <div className="absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-brand-900 blur-3xl" />
          </div>

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
              <MessageCircle className="h-4 w-4" />
              Mulai otomasi hari ini
            </span>
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Jangan biarkan chat pelanggan terabaikan lagi
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-brand-50">
              Setiap chat yang lama dibalas adalah potensi penjualan yang hilang.
              Aktifkan bot sekarang dan biarkan AI yang bekerja.
            </p>
            <button
              onClick={onCtaClick}
              className="group mt-8 inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-brand-700 shadow-lg transition hover:bg-brand-50"
            >
              Coba Sekarang
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </button>
            <p className="mt-4 text-sm text-brand-100">
              Garansi 7 hari uang kembali • Tanpa kontrak
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
