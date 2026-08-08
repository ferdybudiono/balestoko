import { Star, Quote } from "lucide-react";

const TESTIMONIALS = [
  {
    name: "Sarah Wijaya",
    role: "Owner, Hijab Sarah",
    avatar: "bg-rose-400",
    text: "Sejak pakai bot ini, chat masuk tengah malam pun kebalas. Omzet naik 40% karena nggak ada calon pembeli yang kabur gara-gara lama dibales.",
  },
  {
    name: "Andi Pratama",
    role: "Owner, Gadget Corner",
    avatar: "bg-sky-400",
    text: "Fitur cek ongkirnya juara. Pelanggan tanya ongkir langsung dijawab lengkap semua kurir. Admin jadi nggak kewalahan lagi.",
  },
  {
    name: "Maya Lestari",
    role: "Owner, Dapur Maya",
    avatar: "bg-amber-400",
    text: "AI-nya beneran pinter, bisa jawab pertanyaan produk dengan natural. Pelanggan sampai nggak sadar itu bot. Recommended banget!",
  },
];

export default function Testimonials() {
  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            Testimoni
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Dipercaya ratusan pemilik toko
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="flex flex-col rounded-3xl border border-slate-200 bg-white p-7 shadow-card"
            >
              <Quote className="h-8 w-8 text-brand-200" />
              <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-soft">
                “{t.text}”
              </blockquote>
              <div className="mt-5 flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className="h-4 w-4 fill-amber-400 text-amber-400"
                  />
                ))}
              </div>
              <figcaption className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${t.avatar} text-sm font-bold text-white`}
                >
                  {t.name.charAt(0)}
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{t.name}</p>
                  <p className="text-xs text-ink-muted">{t.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
