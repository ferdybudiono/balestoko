import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "BotWA — CS WhatsApp Otomatis + Cek Ongkir AI untuk Toko Online",
  description:
    "Bot WhatsApp bertenaga AI yang membalas chat pelanggan 24/7, menghitung ongkir real-time via API Mengantar, dan bantu closing penjualan. Cocok untuk toko online Indonesia.",
  keywords: [
    "bot whatsapp",
    "cs otomatis",
    "cek ongkir",
    "AI agent",
    "toko online",
    "customer service AI",
  ],
  openGraph: {
    title: "BotWA — CS WhatsApp Otomatis + Cek Ongkir AI",
    description:
      "Balas chat & cek ongkir otomatis di WhatsApp dengan AI. Hemat waktu, tingkatkan penjualan.",
    type: "website",
    locale: "id_ID",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#12994f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const snapUrl = isProduction
    ? "https://app.midtrans.com/snap/snap.js"
    : "https://app.sandbox.midtrans.com/snap/snap.js";
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? "";

  return (
    <html lang="id" className={jakarta.variable}>
      <body>
        {children}

        {/* Midtrans Snap.js — menyediakan window.snap untuk pop-up pembayaran. */}
        <Script
          src={snapUrl}
          data-client-key={clientKey}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
