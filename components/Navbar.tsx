"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Menu, X, LayoutDashboard, LogOut, UserRound } from "lucide-react";

const NAV_LINKS = [
  { href: "#fitur", label: "Fitur" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#harga", label: "Harga" },
  { href: "#faq", label: "FAQ" },
];

interface NavbarProps {
  onCtaClick: () => void;
  /** Email toko yang sedang login, atau `null` bila pengunjung anonim. */
  sessionEmail: string | null;
  /**
   * `false` = jawaban `/api/auth/session` belum tiba. Dibedakan dari "tidak
   * login" supaya slot autentikasi tidak sempat menampilkan tombol Masuk lalu
   * berkedip berubah jadi blok akun sepersekian detik kemudian.
   */
  sessionReady: boolean;
  onLogout: () => Promise<void>;
}

/**
 * Navbar landing page — sekarang sadar sesi.
 *
 * Sebelumnya navbar ini selalu menampilkan "Masuk", termasuk kepada orang yang
 * sedang login. Itu terasa di jalur uang: modal checkout mengunci kolom email ke
 * akun yang sedang login, dan tidak ada satu pun tombol keluar di halaman
 * pemasaran — logout hanya ada di dalam `/dashboard`, tempat yang tidak akan
 * ditebak orang yang sedang berada di halaman harga.
 */
export default function Navbar({ onCtaClick, sessionEmail, sessionReady, onLogout }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
      setMobileOpen(false);
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Tutup menu mobile dengan Escape & kunci scroll body saat terbuka.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-slate-200/70 bg-white/85 backdrop-blur-lg"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2" aria-label="BalesToko.ai beranda">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-glow">
            <MessageCircle className="h-5 w-5" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-ink">
            BalesToko<span className="text-brand-600">.ai</span>
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-ink-soft transition hover:text-brand-600"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {!sessionReady ? (
            // Penahan tempat selebar slotnya. Tanpa ini tombol "Masuk" tampil
            // sekejap kepada orang yang sebenarnya sedang login.
            <div
              className="h-9 w-[7.5rem] animate-pulse rounded-xl bg-slate-200/50"
              aria-hidden="true"
            />
          ) : sessionEmail ? (
            <>
              {/* Chip ini yang menjawab pertanyaan "checkout tadi terkunci ke akun
                  siapa?" sebelum modalnya dibuka. Disembunyikan di bawah `lg`
                  karena di sana empat elemen tidak lagi muat; identitas akunnya
                  tetap disebut di dalam modal checkout. */}
              <span
                title={sessionEmail}
                className="hidden max-w-[11rem] items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-ink-soft lg:flex"
              >
                <UserRound className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                <span className="truncate">{sessionEmail}</span>
              </span>
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
              >
                <LayoutDashboard className="h-4 w-4 text-brand-600" />
                <span>Dashboard</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-slate-100 hover:text-ink disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                <span>{loggingOut ? "Keluar…" : "Keluar"}</span>
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
            >
              <LayoutDashboard className="h-4 w-4 text-brand-600" />
              <span>Masuk</span>
            </Link>
          )}
          <button
            onClick={onCtaClick}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Mulai Sekarang
          </button>
        </div>

        <button
          className="rounded-lg p-2 text-ink md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Tutup menu" : "Buka menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="mobile-menu" className="border-t border-slate-200 bg-white px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft transition hover:bg-slate-50"
              >
                {l.label}
              </a>
            ))}
            {sessionReady && sessionEmail ? (
              <>
                <span className="mt-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2.5 text-xs font-semibold text-ink-soft">
                  <UserRound className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                  <span className="truncate">{sessionEmail}</span>
                </span>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink"
                >
                  <LayoutDashboard className="h-4 w-4 text-brand-600" />
                  <span>Dashboard</span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{loggingOut ? "Keluar…" : "Keluar"}</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink"
              >
                <LayoutDashboard className="h-4 w-4 text-brand-600" />
                <span>Masuk</span>
              </Link>
            )}
            <button
              onClick={() => {
                setMobileOpen(false);
                onCtaClick();
              }}
              className="mt-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Mulai Sekarang
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
