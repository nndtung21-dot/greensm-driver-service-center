"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Lang } from "@/lib/i18n/translations";

const OPTIONS: { code: Lang; label: string }[] = [
  { code: "vi", label: "VI" },
  { code: "en", label: "EN" },
];

/**
 * Small VI/EN toggle. Two visual variants:
 * - "kiosk": bigger tap targets for touchscreen check-in pages
 * - "compact": smaller, for login/agent headers
 */
export function LanguageSwitcher({
  variant = "compact",
  className = "",
}: {
  variant?: "kiosk" | "compact";
  className?: string;
}) {
  const { lang, setLang } = useLanguage();

  const sizing =
    variant === "kiosk"
      ? "px-4 py-2 text-base"
      : "px-2.5 py-1 text-xs";

  return (
    <div
      className={`inline-flex overflow-hidden rounded-full border border-line bg-white ${className}`}
      role="group"
      aria-label="Language / Ngôn ngữ"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => setLang(opt.code)}
          className={`${sizing} font-body font-semibold transition-colors ${
            lang === opt.code
              ? "bg-brand-700 text-white"
              : "bg-transparent text-brand-700 hover:bg-brand-100"
          }`}
          aria-pressed={lang === opt.code}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
