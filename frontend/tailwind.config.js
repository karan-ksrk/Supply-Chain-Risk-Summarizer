/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'IBM Plex Mono'", "monospace"],
        display: ["'Syne'", "sans-serif"],
      },
      colors: {
        canvas:  "#010409",
        surface: "#0d1117",
        border:  "#21262d",
        muted:   "#484f58",
        subtle:  "#8b949e",
        primary: "#e6edf3",
        accent:  "#58a6ff",
        risk: {
          high:   "#ef4444",
          medium: "#f59e0b",
          low:    "#10b981",
        },
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease",
        "slide-up": "slideUp 0.25s ease",
        "spin-slow": "spin 1s linear infinite",
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
