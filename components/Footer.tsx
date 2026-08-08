import { MessageCircle } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <a href="#" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
                <MessageCircle className="h-5 w-5" />
              </span>
              <span className="text-lg font-extrabold tracking-tight text-ink">
                Bot<span className="text-brand-600">WA</span>
              </span>
            </a>
            <p className="mt-3 max-w-xs text-sm text-ink-muted">
              CS WhatsApp otomatis + cek ongkir real-time bertenaga AI untuk
              toko online Indonesia.
            </p>
          </div>

          <FooterCol
            title="Produk"
            links={["Fitur", "Harga", "Cara Kerja", "FAQ"]}
          />
          <FooterCol
            title="Perusahaan"
            links={["Tentang Kami", "Blog", "Karier", "Kontak"]}
          />
          <FooterCol
            title="Bantuan"
            links={["Pusat Bantuan", "Syarat & Ketentuan", "Kebijakan Privasi"]}
          />
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-6 sm:flex-row">
          <p className="text-sm text-ink-muted">
            © {new Date().getFullYear()} BotWA. Semua hak dilindungi.
          </p>
          <p className="text-sm text-ink-muted">
            Dibuat dengan ❤️ untuk UMKM Indonesia
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l}>
            <a
              href="#"
              className="text-sm text-ink-muted transition hover:text-brand-600"
            >
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
