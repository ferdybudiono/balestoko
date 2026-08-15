import Link from "next/link";
import { MessageCircle } from "lucide-react";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const PRODUCT_LINKS: FooterLink[] = [
  { label: "Fitur", href: "/#fitur" },
  { label: "Cara Kerja", href: "/#cara-kerja" },
  { label: "Harga", href: "/#harga" },
  { label: "FAQ", href: "/#faq" },
];

const HELP_LINKS: FooterLink[] = [
  { label: "Login Dashboard", href: "/login" },
  { label: "Lupa Kata Sandi", href: "/reset-password" },
  { label: "Hubungi Kami", href: "mailto:halo@balestoko.ai", external: true },
];

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2" aria-label="BalesToko.ai beranda">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
                <MessageCircle className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-lg font-extrabold tracking-tight text-ink">
                BalesToko<span className="text-brand-600">.ai</span>
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-ink-muted">
              CS WhatsApp otomatis + cek ongkir real-time bertenaga AI untuk
              toko online Indonesia.
            </p>
          </div>

          <FooterCol title="Produk" links={PRODUCT_LINKS} />
          <FooterCol title="Bantuan" links={HELP_LINKS} />
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-6 sm:flex-row">
          <p className="text-sm text-ink-muted">
            © {new Date().getFullYear()} BalesToko.ai. Semua hak dilindungi.
          </p>
          <p className="text-sm text-ink-muted">
            Dibuat dengan ❤️ untuk UMKM Indonesia
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.external ? (
              <a
                href={l.href}
                className="text-sm text-ink-muted transition hover:text-brand-600"
              >
                {l.label}
              </a>
            ) : (
              <Link
                href={l.href}
                className="text-sm text-ink-muted transition hover:text-brand-600"
              >
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
