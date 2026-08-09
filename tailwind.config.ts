import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Màu thương hiệu thật của Green SM (trước là Xanh SM): #28BDBF —
        // xanh cyan/ngọc (kết hợp xanh lá + xanh dương), không phải xanh lá đậm.
        brand: {
          900: "#0B4142", // đậm nhất — tiêu đề, chữ trên nền trắng
          700: "#147476", // nút chính/CTA — đủ đậm để chữ trắng rõ
          500: "#28BDBF", // ĐÚNG màu thương hiệu — điểm nhấn, badge, hover
          100: "#E2F7F7", // nền nhạt — vùng chọn/hover
        },
        // Màu phụ — cam, dùng cho điểm nhấn thứ 2, tách biệt với "brand"
        accent: {
          700: "#C2570F",
          500: "#F2711F",
          100: "#FDEAD9",
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
