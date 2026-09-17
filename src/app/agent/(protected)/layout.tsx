"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile, signOut } from "@/lib/auth";
import { Profile } from "@/lib/types";
import { TicketSearchBox } from "@/components/agent/TicketSearchBox";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";

export default function AgentProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);

  const NAV_ITEMS = [
    { href: "/agent/queue", label: t("layout.nav.queue") },
    { href: "/agent/history", label: t("layout.nav.history") },
    { href: "/agent/performance", label: t("layout.nav.performance") },
  ];

  useEffect(() => {
    let active = true;
    getCurrentProfile().then((p) => {
      if (!active) return;
      if (!p || !["agent", "supervisor", "admin"].includes(p.role)) {
        router.replace("/agent/login");
        return;
      }
      setProfile(p);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (checking || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center font-body text-ink/50">
        {t("layout.checkingLogin")}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-64 flex-col border-r border-line bg-white px-5 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-body text-xs font-semibold uppercase tracking-wide text-brand-500">
              {t("layout.brand")}
            </p>
            <p className="font-display text-lg font-bold text-brand-900">
              {t("layout.portalTitle")}
            </p>
          </div>
        </div>
        <div className="mb-6">
          <LanguageSwitcher />
        </div>
        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 font-body text-sm font-medium ${
                pathname?.startsWith(item.href)
                  ? "bg-brand-100 text-brand-900"
                  : "text-ink/70 hover:bg-paper"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line pt-4">
          <p className="font-body text-sm font-semibold text-ink">{profile.full_name}</p>
          <p className="mb-3 font-body text-xs text-ink/50">{profile.email}</p>
          <div className="flex items-center gap-3">
            <Link
              href="/agent/change-password"
              className="font-body text-sm text-brand-700 underline underline-offset-2"
            >
              {t("layout.changePassword")}
            </Link>
            <button
              onClick={async () => {
                await signOut();
                router.replace("/agent/login");
              }}
              className="font-body text-sm text-brand-700 underline underline-offset-2"
            >
              {t("layout.logout")}
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mb-6 flex justify-end">
          <TicketSearchBox />
        </div>
        {children}
      </main>
    </div>
  );
}
