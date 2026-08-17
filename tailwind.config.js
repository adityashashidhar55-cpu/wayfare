/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Wayfare design tokens (design.md §3)
        bg: "var(--bg)",
        "bg-subtle": "var(--bg-subtle)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        glass: "var(--glass)",
        "glass-strong": "var(--glass-strong)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        brand: {
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          soft: "var(--brand-soft)",
          ink: "var(--brand-ink)",
        },
        pine: {
          DEFAULT: "var(--pine)",
          soft: "var(--pine-soft)",
        },
        ochre: {
          DEFAULT: "var(--ochre)",
          soft: "var(--ochre-soft)",
        },
        danger: "var(--danger)",
        success: "var(--success)",
        info: "var(--info)",
        // r23 design language tokens
        wayfare: {
          dark: "#0a0a0a",
          text: "#1a1a1a",
          muted: "#767676",
          prompt: "#905831",
        },
        // shadcn aliases mapped onto tokens
        background: "var(--bg)",
        foreground: "var(--ink)",
        card: { DEFAULT: "var(--surface)", foreground: "var(--ink)" },
        popover: { DEFAULT: "var(--surface)", foreground: "var(--ink)" },
        primary: { DEFAULT: "var(--brand)", foreground: "var(--brand-ink)" },
        secondary: { DEFAULT: "var(--surface-2)", foreground: "var(--ink)" },
        muted: { DEFAULT: "var(--bg-subtle)", foreground: "var(--ink-3)" },
        accent: { DEFAULT: "var(--brand-soft)", foreground: "var(--brand)" },
        destructive: { DEFAULT: "var(--danger)", foreground: "#FFFFFF" },
        input: "var(--border-strong)",
        ring: "var(--brand)",
        sidebar: {
          DEFAULT: "var(--bg-subtle)",
          foreground: "var(--ink)",
          primary: "var(--brand)",
          "primary-foreground": "var(--brand-ink)",
          accent: "var(--surface-2)",
          "accent-foreground": "var(--ink)",
          border: "var(--border)",
          ring: "var(--brand)",
        },
      },
      fontFamily: {
        sans: ["Geist", "sans-serif"],
        display: ["Special Elite", "serif"],
        serif: ["Fraunces", "Georgia", "serif"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        pill: "999px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionTimingFunction: {
        expo: "cubic-bezier(.22,1,.36,1)",
        "spring-soft": "cubic-bezier(.34,1.4,.64,1)",
        "in-out": "cubic-bezier(.65,0,.35,1)",
      },
      transitionDuration: {
        instant: "100ms",
        fast: "180ms",
        base: "280ms",
        slow: "480ms",
        story: "900ms",
      },
      maxWidth: {
        prose66: "66ch",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "marquee-reverse": {
          from: { transform: "translateX(-50%)" },
          to: { transform: "translateX(0)" },
        },
        "route-march": {
          to: { strokeDashoffset: "-28" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(188,89,52,0.45)" },
          "70%": { boxShadow: "0 0 0 10px rgba(188,89,52,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(188,89,52,0)" },
        },
        breathe: {
          "0%,100%": { boxShadow: "0 0 0 0 var(--brand-soft), var(--shadow-md)" },
          "50%": { boxShadow: "0 0 44px 6px var(--brand-soft), var(--shadow-md)" },
        },
        sheen: {
          from: { transform: "translateX(-120%) skewX(-18deg)" },
          to: { transform: "translateX(240%) skewX(-18deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        marquee: "marquee 40s linear infinite",
        "marquee-reverse": "marquee-reverse 40s linear infinite",
        "route-march": "route-march 1s linear infinite",
        "pulse-ring": "pulse-ring 2s cubic-bezier(.22,1,.36,1) infinite",
        breathe: "breathe 4s ease-in-out infinite",
        sheen: "sheen 200ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
