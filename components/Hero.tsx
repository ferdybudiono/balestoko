"use client";

import {
  ArrowRight,
  PlayCircle,
  Sparkles,
  CheckCheck,
  Truck,
  Star,
} from "lucide-react";

export default function Hero({ onCtaClick }: { onCtaClick: () => void }) {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 lg:pt-36">
      {/* Background dekoratif */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-faint bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 lg:grid-cols-2">
        {/* Kiri: teks */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <Sparkles className="h-3.5 w-3.5" />
            AI Agent untuk Toko Online
          </span>

          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
            Balas Chat Pelanggan &amp;{" "}
            <span className="relative whitespace-nowrap text-brand-600">
              Cek Ongkir
              <svg
                className="absolute -bottom-1.5 left-0 w-full"
                viewBox="0 0 200 12"
                fill="none"
                aria-hidden
              >
                <path
                  d="M2 9C50 3 150 3 198 9"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="text-brand-300"
                />
              </svg>
            </span>{" "}
            Otomatis di WhatsApp
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
            Bot WhatsApp bertenaga AI yang menjawab pertanyaan pelanggan 24/7,
            menghitung ongkos kirim real-time via API Mengantar, dan bantu
            closing penjualan — tanpa kamu harus online terus.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onCtaClick}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-6 py-3.5 text-base font-semibold text-white shadow-glow transition hover:bg-brand-700"
            >
              Mulai Sekarang
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a
              href="#cara-kerja"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-base font-semibold text-ink transition hover:border-slate-300 hover:bg-slate-50"
            >
              <PlayCircle className="h-5 w-5 text-brand-600" />
              Lihat Cara Kerja
            </a>
          </div>

          {/* Social proof mini */}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {["bg-brand-400", "bg-amber-400", "bg-sky-400", "bg-rose-400"].map(
                  (c, i) => (
                    <span
                      key={i}
                      className={`h-8 w-8 rounded-full border-2 border-white ${c}`}
                    />
                  )
                )}
              </div>
              <span className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">500+</span> toko
                terbantu
              </span>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className="h-4 w-4 fill-amber-400 text-amber-400"
                />
              ))}
              <span className="ml-1 text-sm font-medium text-ink">4.9/5</span>
            </div>
          </div>
        </div>

        {/* Kanan: mockup chat WhatsApp */}
        <div className="animate-fade-up [animation-delay:150ms]">
          <ChatMockup />
        </div>
      </div>
    </section>
  );
}

function ChatMockup() {
  return (
    <div className="relative mx-auto max-w-sm">
      {/* Floating badge */}
      <div className="absolute -left-4 top-16 z-10 hidden animate-float rounded-2xl bg-white p-3 shadow-card-lg sm:block">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-600">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold text-ink">Ongkir real-time</p>
            <p className="text-[11px] text-ink-muted">JNE • J&amp;T • SiCepat</p>
          </div>
        </div>
      </div>

      {/* Phone frame */}
      <div className="overflow-hidden rounded-[2rem] border-8 border-ink bg-ink shadow-card-lg">
        {/* Header WA */}
        <div className="flex items-center gap-3 bg-brand-700 px-4 py-3 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            🤖
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">CS Toko Budi Jaya</p>
            <p className="text-[11px] text-brand-100">online • AI Agent</p>
          </div>
        </div>

        {/* Body chat */}
        <div className="space-y-2.5 bg-[#e6ddd4] px-3 py-4">
          <Bubble side="in">Kak, kalau kirim ke Bandung ongkirnya berapa ya?</Bubble>
          <Bubble side="out">
            Halo Kak! 😊 Untuk pengiriman ke <b>Bandung</b> (berat 1kg):
            <br />• JNE REG: Rp18.000 (2-3 hari)
            <br />• J&amp;T: Rp17.000 (2-3 hari)
            <br />• SiCepat: Rp16.000 (2 hari)
          </Bubble>
          <Bubble side="in">Wah cepet banget balesnya. Ready stok yg warna hitam?</Bubble>
          <Bubble side="out">
            Ready Kak! ✅ Stok warna hitam masih ada 12 pcs. Mau langsung
            dipesankan sekalian? 🛒
          </Bubble>
          <div className="flex justify-end">
            <span className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-brand-700">
              <CheckCheck className="h-3 w-3" /> dibalas otomatis dalam 1 detik
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  side,
  children,
}: {
  side: "in" | "out";
  children: React.ReactNode;
}) {
  const out = side === "out";
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-sm ${
          out
            ? "rounded-br-sm bg-[#d9fdd3] text-ink"
            : "rounded-bl-sm bg-white text-ink"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
