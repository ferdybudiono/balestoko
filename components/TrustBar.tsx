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
          Cocok untuk penjual di channel favorit kamu
        </p>
        <div className="group relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <div className="flex w-max animate-marquee items-center gap-12 group-hover:[animation-play-state:paused]">
            {[...LOGOS, ...LOGOS].map((name, i) => (
              <span
                key={i}
                aria-hidden={i >= LOGOS.length}
                className="shrink-0 text-xl font-bold text-slate-400 transition hover:text-slate-500"
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
