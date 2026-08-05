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

type PerfRow = {
  sla_compliance_pct: number | null;
  fcr_pct: number | null;
};

export default function AgentPerformancePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [perf, setPerf] = useState<PerfRow | null>(null);
  const [avgCsat, setAvgCsat] = useState<string>("—");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentProfile().then(async (p) => {
      setProfile(p);
      if (!p) return;
      const [{ data: caseData }, { data: perfData }] = await Promise.all([
        supabase
          .from("service_cases")
          .select("status, started_at, resolved_at, created_at")
          .eq("assigned_agent_id", p.id),
        supabase
          .from("v_report_agent_performance")
          .select("sla_compliance_pct, fcr_pct")
          .eq("agent", p.full_name)
          .maybeSingle(),
      ]);
      setCases((caseData as CaseRow[]) ?? []);
      setPerf((perfData as PerfRow) ?? null);

      // CSAT thật: rating của các case do agent này xử lý
      const { data: myCsat } = await supabase
        .from("feedback")
        .select("rating, service_cases!inner(assigned_agent_id)")
        .eq("service_cases.assigned_agent_id", p.id);
      const ratings = ((myCsat as { rating: number }[]) ?? []).map((r) => r.rating);
      setAvgCsat(ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : "—");
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
            <StatCard
              label="SLA Compliance"
              value={perf?.sla_compliance_pct != null ? `${perf.sla_compliance_pct}%` : "—"}
            />
            <StatCard
              label="FCR"
              value={perf?.fcr_pct != null ? `${perf.fcr_pct}%` : "—"}
            />
            <StatCard label="CSAT" value={avgCsat} />
          </div>
          <Panel title="Ghi chú">
            <p className="font-body text-sm text-ink/60">
              FCR (First Contact Resolution) = tỉ lệ ticket hoàn thành mà KHÔNG
              từng bị Transfer sang bộ phận/agent khác. SLA Compliance chỉ tính
              trên ticket đã hoàn thành và có cấu hình SLA áp dụng.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
