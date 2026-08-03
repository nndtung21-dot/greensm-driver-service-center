"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import { AgentQueueRow, Profile } from "@/lib/types";
import { PrimaryButton, SecondaryButton, SlaBadge, StatCard, StatusBadge } from "@/components/agent/ui";

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export default function AgentQueuePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<AgentQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const { data } = await supabase
      .from("v_agent_queue")
      .select("*")
      .order("created_at", { ascending: true });
    setRows((data as AgentQueueRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    getCurrentProfile().then(setProfile);
    loadQueue();
  }, [loadQueue]);

  // Section 32: realtime — no manual refresh needed
  useEffect(() => {
    const channel = supabase
      .channel("agent-queue-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, loadQueue)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_cases" }, loadQueue)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadQueue]);

  async function handleCallNext() {
    setCalling(true);
    setErrorMessage(null);
    const { data, error } = await supabase.rpc("call_next_ticket").maybeSingle();
    setCalling(false);
    if (error || !data) {
      setErrorMessage(error?.message ?? "Không thể gọi số tiếp theo.");
      return;
    }
    router.push(`/agent/ticket/${(data as { case_id: string }).case_id}`);
  }

  async function handleCallSpecific(ticketId: string, caseId: string) {
    setErrorMessage(null);
    const { error } = await supabase.rpc("call_specific_ticket", { p_ticket_id: ticketId });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    router.push(`/agent/ticket/${caseId}`);
  }

  const waiting = rows.filter((r) => r.status === "WAITING");
  const processing = rows.filter((r) => r.status === "PROCESSING");
  const pending = rows.filter((r) => r.status === "PENDING");
  const overSla = rows.filter(
    (r) =>
      r.sla_due_at &&
      new Date(r.sla_due_at).getTime() < Date.now() &&
      !r.resolved_at &&
      !r.closed_at &&
      r.status !== "PENDING" // SLA đang pause khi Pending (Section 22)
  );
  const completedToday = rows.filter(
    (r) =>
      (r.status === "RESOLVED" || r.status === "CLOSED") &&
      r.resolved_at &&
      new Date(r.resolved_at).toDateString() === new Date().toDateString()
  );

  const myQueue = rows.filter(
    (r) => r.status === "WAITING" || (r.assigned_agent_id === profile?.id && !["RESOLVED", "CLOSED"].includes(r.status))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-brand-900">Queue của tôi</h1>
        <PrimaryButton onClick={handleCallNext} disabled={calling || waiting.length === 0}>
          {calling ? "Đang gọi..." : "GỌI TIẾP THEO"}
        </PrimaryButton>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Waiting" value={waiting.length} />
        <StatCard label="Processing" value={processing.length} />
        <StatCard label="Pending" value={pending.length} tone="warn" />
        <StatCard label="Over SLA" value={overSla.length} tone="danger" />
        <StatCard label="Completed Today" value={completedToday.length} />
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <table className="w-full text-left font-body text-sm">
          <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Số</th>
              <th className="px-4 py-3">Tài xế</th>
              <th className="px-4 py-3">SAP ID</th>
              <th className="px-4 py-3">Nhu cầu</th>
              <th className="px-4 py-3">Thời gian chờ</th>
              <th className="px-4 py-3">SLA</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink/40">
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && myQueue.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink/40">
                  Không có ticket nào.
                </td>
              </tr>
            )}
            {myQueue.map((r) => (
              <tr
                key={r.ticket_id}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-paper/40"
                onClick={() => router.push(`/agent/ticket/${r.case_id}`)}
              >
                <td className="px-4 py-3 font-display font-bold text-brand-900">
                  {r.queue_number}
                </td>
                <td className="px-4 py-3">{r.driver_name}</td>
                <td className="px-4 py-3 text-ink/60">{r.sap_id ?? "—"}</td>
                <td className="px-4 py-3">{r.category_name}</td>
                <td className="px-4 py-3 text-ink/60">{minutesSince(r.created_at)} phút</td>
                <td className="px-4 py-3">
                  <SlaBadge slaDueAt={r.sla_due_at} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  {r.status === "WAITING" && (
                    <SecondaryButton
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCallSpecific(r.ticket_id, r.case_id);
                      }}
                    >
                      Gọi
                    </SecondaryButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
