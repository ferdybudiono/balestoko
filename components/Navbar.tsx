"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Menu, X, LayoutDashboard } from "lucide-react";

const NAV_LINKS = [
  { href: "#fitur", label: "Fitur" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#harga", label: "Harga" },
  { href: "#faq", label: "FAQ" },
];

export default function Navbar({ onCtaClick }: { onCtaClick: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-slate-200/70 bg-white/85 backdrop-blur-lg"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-glow">
            <MessageCircle className="h-5 w-5" />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-ink">
            Bot<span className="text-brand-600">WA</span>.ai
          </span>
        </a>

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
          <Link
            href="/login"
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
          >
            <LayoutDashboard className="h-4 w-4 text-brand-600" />
            <span>Login Dashboard</span>
          </Link>
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
          aria-label="Menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-5 py-4 md:hidden">
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
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink"
            >
              <LayoutDashboard className="h-4 w-4 text-brand-600" />
              <span>Login Dashboard</span>
            </Link>
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
