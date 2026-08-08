import { UserPlus, Plug, Rocket } from "lucide-react";

const STEPS = [
  {
    icon: UserPlus,
    step: "01",
    title: "Daftar & Pilih Paket",
    desc: "Isi data toko kamu dan pilih paket yang sesuai. Proses cuma butuh 2 menit.",
  },
  {
    icon: Plug,
    step: "02",
    title: "Hubungkan WhatsApp",
    desc: "Scan QR untuk menyambungkan nomor WhatsApp bisnis. Tim kami bantu setup sampai jalan.",
  },
  {
    icon: Rocket,
    step: "03",
    title: "Bot Langsung Bekerja",
    desc: "Bot mulai balas chat & cek ongkir otomatis. Kamu tinggal pantau order yang masuk.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="cara-kerja"
      className="scroll-mt-20 bg-ink py-20 text-white sm:py-24"
    >
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-brand-400">
            Cara Kerja
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Siap jalan dalam 3 langkah
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Tanpa ribet, tanpa perlu skill teknis. Dari daftar sampai bot aktif
            di hari yang sama.
          </p>
        </div>

        <div className="relative mt-16 grid grid-cols-1 gap-10 md:grid-cols-3">
          {/* garis penghubung */}
          <div className="absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-white/15 to-transparent md:block" />
          {STEPS.map((s) => (
            <div key={s.step} className="relative text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                <s.icon className="h-7 w-7 text-brand-400" />
              </div>
              <div className="mt-5 text-sm font-bold tracking-widest text-brand-400">
                {s.step}
              </div>
              <h3 className="mt-2 text-xl font-bold">{s.title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-300">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
