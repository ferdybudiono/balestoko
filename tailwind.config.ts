import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        // Ponsel kecil (≤360px) — dipakai untuk menyembunyikan label sekunder
        // di header dashboard tanpa mengubah breakpoint bawaan Tailwind.
        xs: "400px",
      },
      colors: {
        // Brand green (WhatsApp-adjacent, but a touch more refined)
        brand: {
          50: "#effdf5",
          100: "#d9f9e6",
          200: "#b5f1cf",
          300: "#7fe4ac",
          400: "#42cf82",
          500: "#1eb964",
          600: "#12994f",
          700: "#127843",
          800: "#145f39",
          900: "#134e31",
          950: "#042c19",
        },
        ink: {
          DEFAULT: "#0b1220",
          soft: "#1a2434",
          muted: "#5b6675",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px -8px rgba(16,24,40,.12)",
        "card-lg": "0 8px 40px -12px rgba(16,24,40,.22)",
        glow: "0 0 0 1px rgba(30,185,100,.15), 0 20px 60px -20px rgba(30,185,100,.45)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "fade-up": "fade-up .6s cubic-bezier(.16,1,.3,1) both",
        "fade-in": "fade-in .5s ease both",
        "scale-in": "scale-in .25s cubic-bezier(.16,1,.3,1) both",
        float: "float 6s ease-in-out infinite",
        marquee: "marquee 28s linear infinite",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(15,23,42,.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,.04) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
