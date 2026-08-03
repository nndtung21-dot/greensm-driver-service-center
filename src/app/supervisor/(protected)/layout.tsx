"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentProfile, signOut } from "@/lib/auth";
import { Profile } from "@/lib/types";

export default function SupervisorProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    getCurrentProfile().then((p) => {
      if (!active) return;
      if (!p || !["supervisor", "admin"].includes(p.role)) {
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
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-line bg-white px-8 py-4">
        <div>
          <p className="font-body text-xs font-semibold uppercase tracking-wide text-brand-500">
            Green SM · Supervisor Dashboard
          </p>
          <p className="font-display text-lg font-bold text-brand-900">{profile.full_name}</p>
        </div>
        <button
          onClick={async () => {
            await signOut();
            router.replace("/agent/login");
          }}
          className="font-body text-sm text-brand-700 underline underline-offset-2"
        >
          Đăng xuất
        </button>
      </header>
      <main className="px-8 py-8">{children}</main>
    </div>
  );
}
