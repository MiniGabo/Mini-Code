/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#131313",
          900: "#191a1b",
          850: "#1e2021",
          800: "#232526",
          700: "#2c2f31",
          600: "#3a3d3f",
          500: "#54585b",
          400: "#7c8184",
          300: "#a7acaf",
        },
        ember: {
          500: "#e08a3c",
          400: "#eda05a",
          300: "#f4bc86",
        },
      },
      fontFamily: {
        ui: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
    },
  },
  plugins: [],
};
