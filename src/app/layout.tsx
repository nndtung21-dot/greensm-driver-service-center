import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin", "vietnamese"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Green SM Driver Service Center",
  description: "Hệ thống check-in và hỗ trợ tài xế Green SM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className={`${inter.variable} ${manrope.variable} font-body text-ink bg-paper`}>
        {children}
      </body>
    </html>
  );
}
