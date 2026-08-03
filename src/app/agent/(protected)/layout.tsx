"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile, signOut } from "@/lib/auth";
import { Profile } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/agent/queue", label: "Queue của tôi" },
  { href: "/agent/performance", label: "Hiệu suất" },
];

export default function AgentProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);

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
        Đang kiểm tra đăng nhập...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-64 flex-col border-r border-line bg-white px-5 py-6">
        <p className="mb-1 font-body text-xs font-semibold uppercase tracking-wide text-brand-500">
          Green SM
        </p>
        <p className="mb-8 font-display text-lg font-bold text-brand-900">
          Agent Portal
        </p>
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
          <button
            onClick={async () => {
              await signOut();
              router.replace("/agent/login");
            }}
            className="font-body text-sm text-brand-700 underline underline-offset-2"
          >
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
    </div>
  );
}
