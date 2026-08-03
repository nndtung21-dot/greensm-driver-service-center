"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import { AgentOption, AgentQueueRow, Counter, Profile } from "@/lib/types";
import { PrimaryButton, SecondaryButton, SlaBadge, StatCard, StatusBadge } from "@/components/agent/ui";

type DailySummary = {
  branch: string;
  business_date: string;
  total_visits: number;
  unique_drivers: number;
  total_tickets: number;
  completed_tickets: number;
  avg_waiting_time_min: number | null;
  avg_handling_time_min: number | null;
};

type FeedbackRow = { rating: number };

export default function SupervisorDashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<AgentQueueRow[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [colleagues, setColleagues] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reassignOpenFor, setReassignOpenFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: queueData }, { data: summaryData }, { data: feedbackData }, { data: counterData }, { data: colleagueData }] =
      await Promise.all([
        supabase.from("v_agent_queue").select("*").order("created_at", { ascending: true }),
        supabase.from("v_report_daily_summary").select("*").eq("business_date", today),
        supabase.from("v_report_feedback").select("rating"),
        supabase.from("counters").select("id, counter_code, counter_name, status, branch_id"),
        supabase.from("profiles").select("id, full_name, email, role").eq("role", "agent"),
      ]);
    setRows((queueData as AgentQueueRow[]) ?? []);
    setSummary(((summaryData as DailySummary[]) ?? [])[0] ?? null);
    setFeedback((feedbackData as FeedbackRow[]) ?? []);
    setCounters((counterData as Counter[]) ?? []);
    setColleagues((colleagueData as AgentOption[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    getCurrentProfile().then(setProfile);
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("supervisor-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_cases" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "counters" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function handleToggleCounter(counter: Counter) {
    const next = counter.status === "AVAILABLE" ? "CLOSED" : "AVAILABLE";
    await supabase.rpc("set_counter_status", { p_counter_id: counter.id, p_status: next });
    load();
  }

  async function handleReassign(caseId: string, toAgentId: string) {
    await supabase.rpc("reassign_case", { p_case_id: caseId, p_to_agent_id: toAgentId });
    setReassignOpenFor(null);
    load();
  }

  const filtered = rows.filter(
    (r) =>
      (!categoryFilter || r.category_name === categoryFilter) &&
      (!statusFilter || r.status === statusFilter)
  );
  const categories = Array.from(new Set(rows.map((r) => r.category_name)));

  const waiting = rows.filter((r) => r.status === "WAITING").length;
  const processing = rows.filter((r) => r.status === "PROCESSING").length;
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const overSla = rows.filter(
    (r) =>
      r.sla_due_at &&
      new Date(r.sla_due_at).getTime() < Date.now() &&
      !r.resolved_at &&
      !r.closed_at &&
      r.status !== "PENDING"
  ).length;
  const completed = rows.filter((r) => ["RESOLVED", "CLOSED"].includes(r.status)).length;
  const avgCsat =
    feedback.length > 0
      ? (feedback.reduce((a, b) => a + b.rating, 0) / feedback.length).toFixed(1)
      : "—";

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-bold text-brand-900">
        Dashboard {profile?.role === "admin" ? "(toàn hệ thống)" : ""}
      </h1>

      <div>
        <p className="mb-3 font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
          Hôm nay
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard label="Total Visits" value={summary?.total_visits ?? 0} />
          <StatCard label="Unique Drivers" value={summary?.unique_drivers ?? 0} />
          <StatCard label="Total Tickets" value={summary?.total_tickets ?? 0} />
          <StatCard label="Completed" value={completed} />
          <StatCard label="Waiting" value={waiting} />
          <StatCard label="Processing" value={processing} />
          <StatCard label="Pending" value={pending} tone="warn" />
          <StatCard label="Over SLA" value={overSla} tone="danger" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Avg Waiting Time"
          value={summary?.avg_waiting_time_min != null ? `${summary.avg_waiting_time_min}p` : "—"}
        />
        <StatCard
          label="Avg Handling Time"
          value={summary?.avg_handling_time_min != null ? `${summary.avg_handling_time_min}p` : "—"}
        />
        <StatCard
          label="SLA Compliance"
          value={
            summary && summary.total_tickets > 0
              ? `${Math.round((completed / summary.total_tickets) * 100)}%`
              : "—"
          }
        />
        <StatCard label="CSAT" value={avgCsat} />
      </div>

      <div>
        <p className="mb-3 font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
          Quầy
        </p>
        <div className="flex flex-wrap gap-3">
          {counters.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3"
            >
              <span className="font-body text-sm font-semibold text-ink">{c.counter_name}</span>
              <StatusCounterBadge status={c.status} />
              {(c.status === "AVAILABLE" || c.status === "CLOSED") && (
                <SecondaryButton onClick={() => handleToggleCounter(c)} className="px-3 py-1 text-xs">
                  {c.status === "AVAILABLE" ? "Đóng" : "Mở"}
                </SecondaryButton>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
            Tất cả ticket
          </p>
          <div className="flex gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
            >
              <option value="">Tất cả category</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="WAITING">Đang chờ</option>
              <option value="CALLED">Đã gọi</option>
              <option value="PROCESSING">Đang xử lý</option>
              <option value="PENDING">Tạm hoãn</option>
              <option value="TRANSFERRED">Đã chuyển</option>
              <option value="RESOLVED">Đã giải quyết</option>
              <option value="CLOSED">Đã đóng</option>
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-left font-body text-sm">
            <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-3">Số</th>
                <th className="px-4 py-3">Tài xế</th>
                <th className="px-4 py-3">Nhu cầu</th>
                <th className="px-4 py-3">SLA</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Reassign</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink/40">
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((r) => (
                  <tr key={r.ticket_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-display font-bold text-brand-900">
                      {r.queue_number}
                    </td>
                    <td className="px-4 py-3">{r.driver_name}</td>
                    <td className="px-4 py-3">{r.category_name}</td>
                    <td className="px-4 py-3">
                      <SlaBadge slaDueAt={r.sla_due_at} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      {reassignOpenFor === r.case_id ? (
                        <select
                          autoFocus
                          onChange={(e) => e.target.value && handleReassign(r.case_id, e.target.value)}
                          onBlur={() => setReassignOpenFor(null)}
                          className="rounded-lg border-2 border-line px-2 py-1 font-body text-xs"
                        >
                          <option value="">-- Chọn agent --</option>
                          {colleagues.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.full_name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <SecondaryButton
                          onClick={() => setReassignOpenFor(r.case_id)}
                          className="px-3 py-1 text-xs"
                        >
                          Reassign
                        </SecondaryButton>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusCounterBadge({ status }: { status: Counter["status"] }) {
  const color =
    status === "AVAILABLE"
      ? "bg-green-50 text-brand-700"
      : status === "BUSY"
      ? "bg-brand-100 text-brand-900"
      : status === "OFFLINE"
      ? "bg-red-50 text-danger"
      : "bg-line/40 text-ink/50";
  return (
    <span className={`rounded-full px-2 py-0.5 font-body text-xs font-semibold ${color}`}>
      {status}
    </span>
  );
}
