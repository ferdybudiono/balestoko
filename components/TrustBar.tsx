const LOGOS = [
  "Tokopedia",
  "Shopee",
  "TikTok Shop",
  "Lazada",
  "Instagram",
  "WhatsApp",
  "Blibli",
  "Bukalapak",
];

export default function TrustBar() {
  return (
    <section className="border-y border-slate-100 bg-white py-8">
      <div className="mx-auto max-w-6xl px-5">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-ink-muted">
          Terintegrasi dengan channel jualan favorit kamu
        </p>
        <div className="relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <div className="flex w-max animate-marquee items-center gap-12">
            {[...LOGOS, ...LOGOS].map((name, i) => (
              <span
                key={i}
                className="shrink-0 text-xl font-bold text-slate-300 transition hover:text-slate-400"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
