import { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * KioskButton — the one interactive control of the whole flow.
 * Large tap target (min 88px tall), high-contrast, no decoration beyond
 * what a touchscreen at arm's length actually needs.
 */
export function KioskButton({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const base =
    "w-full rounded-card px-8 py-6 text-2xl font-display font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-brand-700 text-white hover:bg-brand-900 active:bg-brand-900",
    secondary:
      "bg-white text-brand-900 border-2 border-brand-100 hover:border-brand-500",
    ghost: "bg-transparent text-brand-700 underline underline-offset-4",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function StepCard({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
      <div className="rounded-card border border-line bg-white p-8 shadow-sm sm:p-12">
        {eyebrow && (
          <p className="mb-2 font-body text-sm font-semibold uppercase tracking-wide text-brand-500">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-4xl font-bold text-brand-900 sm:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 font-body text-lg text-ink/70">{subtitle}</p>
        )}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
