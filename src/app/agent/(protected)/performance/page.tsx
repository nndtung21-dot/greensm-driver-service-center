"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import { Profile } from "@/lib/types";
import { Panel, StatCard } from "@/components/agent/ui";

type CaseRow = {
  status: string;
  started_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

export default function AgentPerformancePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentProfile().then(async (p) => {
      setProfile(p);
      if (!p) return;
      const { data } = await supabase
        .from("service_cases")
        .select("status, started_at, resolved_at, created_at")
        .eq("assigned_agent_id", p.id);
      setCases((data as CaseRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  const processed = cases.length;
  const completed = cases.filter((c) => ["RESOLVED", "CLOSED"].includes(c.status)).length;

  const handlingTimes = cases
    .filter((c) => c.started_at && c.resolved_at)
    .map((c) => (new Date(c.resolved_at!).getTime() - new Date(c.started_at!).getTime()) / 60000);
  const avgHandlingMin =
    handlingTimes.length > 0
      ? Math.round(handlingTimes.reduce((a, b) => a + b, 0) / handlingTimes.length)
      : null;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-brand-900">Hiệu suất cá nhân</h1>
      {loading ? (
        <p className="font-body text-ink/50">Đang tải...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Ticket đã xử lý" value={processed} />
            <StatCard label="Ticket hoàn thành" value={completed} />
            <StatCard
              label="Avg. Handling Time"
              value={avgHandlingMin !== null ? `${avgHandlingMin}p` : "—"}
            />
          </div>
          <Panel title="Chưa có dữ liệu">
            <p className="font-body text-sm text-ink/60">
              SLA Compliance, FCR và CSAT sẽ hiển thị ở đây sau khi hoàn thành Phase 5
              (SLA) và Phase 7 (Feedback) — hiện schema đã có sẵn (`sla_due_at`,
              bảng `feedback`), chỉ cần bật tính năng thu thập dữ liệu.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
