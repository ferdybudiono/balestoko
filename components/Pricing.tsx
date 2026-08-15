"use client";

import { Check, X, Sparkles, Gift } from "lucide-react";
import { PLAN_LIST, formatIDR, type Plan } from "@/lib/packages";

export default function Pricing({
  onSelect,
  onTrial,
}: {
  onSelect: (plan: Plan) => void;
  onTrial?: () => void;
}) {
  return (
    <section id="harga" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            Harga
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Investasi kecil, hasil maksimal
          </h2>
          <p className="mt-4 text-lg text-ink-muted">
            Pilih paket yang sesuai skala toko kamu. Tanpa kontrak, bisa
            berhenti kapan saja.
          </p>

          {onTrial && (
            <div className="mt-6 inline-flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-4 sm:flex-row">
              <span className="text-sm font-medium text-emerald-800">
                Belum yakin? Coba dulu gratis 7 hari — tanpa kartu kredit.
              </span>
              <button
                onClick={onTrial}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-emerald-700"
              >
                <Gift className="h-4 w-4" />
                Mulai Uji Coba Gratis
              </button>
            </div>
          )}
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 items-stretch gap-6 md:grid-cols-2">
          {PLAN_LIST.map((plan) => (
            <PricingCard key={plan.id} plan={plan} onSelect={onSelect} />
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-ink-muted">
          💳 Pembayaran aman via Midtrans — Transfer Bank, e-Wallet, QRIS, Kartu
          Kredit.
        </p>
      </div>
    </section>
  );
}

function PricingCard({
  plan,
  onSelect,
}: {
  plan: Plan;
  onSelect: (plan: Plan) => void;
}) {
  const featured = plan.highlighted;
  return (
    <div
      className={`relative flex flex-col rounded-3xl p-8 transition ${
        featured
          ? "border-2 border-brand-500 bg-white shadow-card-lg"
          : "border border-slate-200 bg-white shadow-card"
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand-600 px-3.5 py-1 text-xs font-semibold text-white shadow-glow">
          <Sparkles className="h-3.5 w-3.5" />
          {plan.badge}
        </span>
      )}

      <h3 className="text-lg font-bold text-ink">{plan.name}</h3>
      <p className="mt-1 text-sm text-ink-muted">{plan.tagline}</p>

      <div className="mt-5 flex items-end gap-1">
        <span className="text-4xl font-extrabold tracking-tight text-ink">
          {formatIDR(plan.price)}
        </span>
        <span className="mb-1 text-sm text-ink-muted">{plan.period}</span>
      </div>

      <button
        onClick={() => onSelect(plan)}
        className={`mt-6 w-full rounded-2xl px-5 py-3 text-base font-semibold transition ${
          featured
            ? "bg-brand-600 text-white shadow-glow hover:bg-brand-700"
            : "border border-slate-200 bg-white text-ink hover:border-brand-300 hover:bg-brand-50"
        }`}
      >
        {plan.ctaLabel}
      </button>

      <div className="mt-7 space-y-3">
        {plan.features.map((f) => (
          <div key={f} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <span className="text-sm text-ink-soft">{f}</span>
          </div>
        ))}
        {plan.notIncluded?.map((f) => (
          <div key={f} className="flex items-start gap-3 opacity-50">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <X className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <span className="text-sm text-ink-muted line-through">{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
