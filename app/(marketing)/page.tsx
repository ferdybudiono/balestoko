"use client";

import { useCallback, useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import TrustBar from "@/components/TrustBar";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Pricing from "@/components/Pricing";
import Testimonials from "@/components/Testimonials";
import FAQ from "@/components/FAQ";
import FinalCTA from "@/components/FinalCTA";
import Footer from "@/components/Footer";
import CheckoutModal from "@/components/CheckoutModal";
import TrialModal from "@/components/TrialModal";
import { type Plan } from "@/lib/packages";

export default function Home() {
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);

  /**
   * Sesi dipegang DI SINI, bukan di masing-masing komponen.
   *
   * Dulu `CheckoutModal` mengambilnya sendiri, dan navbar tidak tahu apa-apa soal
   * sesi. Akibatnya tidak ada satu pun jalan keluar dari halaman pemasaran: kolom
   * email checkout terkunci ke akun yang sedang login, sementara satu-satunya
   * tombol logout ada di dalam `/dashboard`. Dengan satu state di induknya,
   * `logout()` cukup menge-set `null` sekali dan kunci di modal ikut terbuka —
   * kalau tiap komponen memegang salinannya sendiri, keluar dari navbar tidak akan
   * diketahui modal yang dibuka sesudahnya.
   *
   * `sessionReady` memisahkan "belum tahu" dari "tidak login" supaya navbar tidak
   * sempat menampilkan tombol Masuk lalu berkedip berubah jadi blok akun.
   */
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setSessionEmail(d?.email || null);
        setSessionReady(true);
      })
      .catch(() => {
        // Gagal mengecek sesi → perlakukan sebagai pengunjung anonim. Server tetap
        // jadi otoritas: perpanjangan tanpa sesi yang cocok ditolak dengan 409.
        if (alive) setSessionReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* abaikan — cookie tetap dihapus di percobaan berikutnya */
    }
    setSessionEmail(null);
  }, []);

  const openCheckout = useCallback((plan: Plan) => {
    setSelectedPlan(plan);
    setModalOpen(true);
  }, []);

  const openTrial = useCallback(() => setTrialOpen(true), []);

  // CTA umum (navbar, hero, final CTA) -> arahkan ke bagian harga supaya
  // user lihat pilihan paket dulu sebelum mengisi form checkout.
  const goToPricing = useCallback(() => {
    document
      .getElementById("harga")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const closeCheckout = useCallback(() => setModalOpen(false), []);

  return (
    <>
      <Navbar
        onCtaClick={goToPricing}
        sessionEmail={sessionEmail}
        sessionReady={sessionReady}
        onLogout={logout}
      />

      <main>
        <Hero onCtaClick={goToPricing} />
        <TrustBar />
        <Features />
        <HowItWorks />
        <Pricing onSelect={openCheckout} onTrial={openTrial} />
        <Testimonials />
        <FAQ />
        <FinalCTA onCtaClick={goToPricing} />
      </main>

      <Footer />

      <CheckoutModal
        plan={selectedPlan}
        open={modalOpen}
        onClose={closeCheckout}
        sessionEmail={sessionEmail}
        onLogout={logout}
      />

      <TrialModal
        open={trialOpen}
        onClose={() => setTrialOpen(false)}
        sessionEmail={sessionEmail}
        onLogout={logout}
      />
    </>
  );
}
