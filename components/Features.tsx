import {
  MessageCircle,
  Truck,
  BrainCircuit,
  Clock,
  BarChart3,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  desc: string;
  highlight?: boolean;
  points?: string[];
}

const MAIN: Feature[] = [
  {
    icon: MessageCircle,
    title: "Balas Chat Otomatis 24/7",
    desc: "Pelanggan chat jam berapa pun langsung dibalas. Nggak ada lagi chat nyangkut semalaman yang bikin calon pembeli kabur.",
    points: ["Balasan instan < 1 detik", "Template & FAQ pintar", "Multi-nomor WhatsApp"],
    highlight: true,
  },
  {
    icon: Truck,
    title: "Cek Ongkir Real-time",
    desc: "Terhubung langsung ke API Mengantar. Bot otomatis hitung ongkir dari semua kurir begitu pelanggan sebut kota tujuan.",
    points: ["JNE, J&T, SiCepat, dll", "Update tarif otomatis", "Estimasi hari sampai"],
  },
  {
    icon: BrainCircuit,
    title: "AI Agent Pintar",
    desc: "Bukan sekadar auto-reply. AI memahami konteks, menjawab pertanyaan produk, dan mengarahkan pelanggan sampai closing.",
    points: ["Paham bahasa sehari-hari", "Rekomendasi produk", "Ingat konteks chat (Pro)"],
  },
];

const SECONDARY: Feature[] = [
  {
    icon: Clock,
    title: "Hemat Waktu Admin",
    desc: "Otomasi tugas repetitif, admin fokus ke hal yang penting.",
  },
  {
    icon: BarChart3,
    title: "Analitik Percakapan",
    desc: "Pantau volume chat, topik yang sering ditanya, dan kota tujuan ongkir.",
  },
  {
    icon: ShieldCheck,
    title: "Data Aman",
    desc: "Percakapan & data pelanggan terenkripsi dan terlindungi.",
  },
];

export default function Features() {
  return (
    <section id="fitur" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            Fitur Unggulan
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Semua yang toko online kamu butuhkan
          </h2>
          <p className="mt-4 text-lg text-ink-muted">
            Satu bot untuk balas chat, hitung ongkir, dan bantu jualan. Tinggal
            pasang, langsung kerja.
          </p>
        </div>

        {/* 3 fitur utama */}
        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {MAIN.map((f) => (
            <article
              key={f.title}
              className={`group relative rounded-3xl border p-7 transition duration-300 hover:-translate-y-1 ${
                f.highlight
                  ? "border-brand-200 bg-brand-50/60 shadow-card"
                  : "border-slate-200 bg-white shadow-card hover:border-brand-200"
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                  f.highlight
                    ? "bg-brand-600 text-white"
                    : "bg-brand-50 text-brand-600"
                }`}
              >
                <f.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-xl font-bold text-ink">{f.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                {f.desc}
              </p>
              {f.points && (
                <ul className="mt-4 space-y-1.5">
                  {f.points.map((p) => (
                    <li
                      key={p}
                      className="flex items-center gap-2 text-sm text-ink-soft"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>

        {/* 3 fitur pendukung */}
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {SECONDARY.map((f) => (
            <div
              key={f.title}
              className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
                <f.icon className="h-5 w-5" />
              </span>
              <div>
                <h4 className="font-semibold text-ink">{f.title}</h4>
                <p className="mt-1 text-sm text-ink-muted">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
