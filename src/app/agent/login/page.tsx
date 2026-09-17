"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/common/LanguageSwitcher";

export default function AgentLoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      setLoading(false);
      setError(t("login.errors.badCredentials"));
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", data.session.user.id)
      .maybeSingle();
    setLoading(false);

    if (!profile || profile.status === "INACTIVE") {
      await supabase.auth.signOut();
      setError(t("login.errors.accountLocked"));
      return;
    }

    if (profile?.role === "admin") {
      router.push("/admin/agents");
    } else if (profile?.role === "supervisor") {
      router.push("/supervisor/dashboard");
    } else {
      router.push("/agent/queue");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="rounded-card border border-line bg-white p-10 shadow-sm">
          <p className="mb-1 font-body text-sm font-semibold uppercase tracking-wide text-brand-500">
            {t("common.brand")}
          </p>
          <h1 className="mb-8 font-display text-3xl font-bold text-brand-900">
            {t("login.heading")}
          </h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block font-body text-sm text-ink/70">
                {t("login.email")}
              </label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-base focus:border-brand-700"
              />
            </div>
            <div>
              <label className="mb-1 block font-body text-sm text-ink/70">
                {t("login.password")}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-base focus:border-brand-700"
              />
            </div>
            {error && <p className="font-body text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-700 py-3 font-display text-lg font-semibold text-white hover:bg-brand-900 disabled:opacity-50"
            >
              {loading ? t("login.submitting") : t("login.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
