"use client";

import { useCallback, useState } from "react";
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
import { type Plan } from "@/lib/packages";

export default function Home() {
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const openCheckout = useCallback((plan: Plan) => {
    setSelectedPlan(plan);
    setModalOpen(true);
  }, []);

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
      <Navbar onCtaClick={goToPricing} />

      <main>
        <Hero onCtaClick={goToPricing} />
        <TrustBar />
        <Features />
        <HowItWorks />
        <Pricing onSelect={openCheckout} />
        <Testimonials />
        <FAQ />
        <FinalCTA onCtaClick={goToPricing} />
      </main>

      <Footer />

      <CheckoutModal
        plan={selectedPlan}
        open={modalOpen}
        onClose={closeCheckout}
      />
    </>
  );
}
