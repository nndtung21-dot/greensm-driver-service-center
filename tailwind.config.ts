import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          900: "#06402B",
          700: "#0B6E4F",
          500: "#2E8B67",
          100: "#E4F2EA",
        },
        ink: "#16241D",
        paper: "#F6F8F6",
        line: "#D8E5DC",
        warn: "#B8860B",
        danger: "#B3261E",
      },
      fontFamily: {
        display: ["var(--font-manrope)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        card: "20px",
      },
    },
  },
  plugins: [],
};
export default config;
