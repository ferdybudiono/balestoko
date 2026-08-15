"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "Apakah perlu install aplikasi tambahan?",
    a: "Tidak. Bot langsung terhubung ke nomor WhatsApp bisnis kamu lewat scan QR. Kamu tetap bisa buka WhatsApp seperti biasa, bot bekerja di belakang layar.",
  },
  {
    q: "Bagaimana cara cek ongkirnya bisa real-time?",
    a: "Kami terintegrasi langsung dengan API Mengantar yang menyediakan data tarif dari berbagai kurir (JNE, J&T, SiCepat, dan lainnya). Saat pelanggan menyebut kota tujuan, bot langsung mengambil tarif terkini.",
  },
  {
    q: "Apakah AI-nya bisa jawab pertanyaan spesifik produk saya?",
    a: "Bisa. Pada paket Pro, kamu bisa memasukkan katalog & informasi produk. AI akan belajar dari data tersebut dan menjawab pertanyaan pelanggan sesuai konteks toko kamu.",
  },
  {
    q: "Metode pembayaran apa saja yang didukung?",
    a: "Semua pembayaran diproses aman lewat Midtrans: Transfer Bank (Virtual Account), e-Wallet (GoPay, OVO, ShopeePay, Dana), QRIS, hingga Kartu Kredit/Debit.",
  },
  {
    q: "Apakah bisa berhenti berlangganan kapan saja?",
    a: "Tentu. Tidak ada kontrak jangka panjang. Kamu bisa upgrade, downgrade, atau berhenti berlangganan kapan pun tanpa penalti.",
  },
  {
    q: "Apakah ada garansi atau masa coba?",
    a: "Kami memberikan garansi uang kembali 7 hari jika kamu merasa layanan tidak sesuai. Hubungi tim support kami dan dana akan dikembalikan penuh.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-5">
        <div className="text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            FAQ
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Pertanyaan yang sering ditanyakan
          </h2>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                >
                  <span className="font-semibold text-ink">{item.q}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-brand-600 transition-transform duration-300 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  id={`faq-panel-${i}`}
                  aria-hidden={!isOpen}
                  className={`grid transition-all duration-300 ease-in-out ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-[15px] leading-relaxed text-ink-muted">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
