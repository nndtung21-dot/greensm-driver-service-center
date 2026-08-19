"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import {
  AgentOption,
  AgentQueueRow,
  Counter,
  Profile,
} from "@/lib/types";
import {
  PrimaryButton,
  SecondaryButton,
  SlaBadge,
  StatCard,
  StatusBadge,
} from "@/components/agent/ui";

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

type FeedbackRow = {
  rating: number;
};

type QueueRowExtended = AgentQueueRow & {
  branch_id?: string | null;
  branch_name?: string | null;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  created_at?: string | null;
};

export default function SupervisorDashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null);

  const [rows, setRows] = useState<QueueRowExtended[]>([]);
  const [summaryRows, setSummaryRows] = useState<DailySummary[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [colleagues, setColleagues] = useState<AgentOption[]>([]);

  const [loading, setLoading] = useState(true);

  // ==========================================================
  // FILTER
  // ==========================================================

  const today = new Date().toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  const [agentFilter, setAgentFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: today,
    toDate: today,
    agent: "",
    branch: "",
    category: "",
    status: "",
  });

  const [reassignOpenFor, setReassignOpenFor] =
    useState<string | null>(null);

  // ==========================================================
  // LOAD DATA
  // ==========================================================

  const load = useCallback(async () => {
    setLoading(true);

    const currentProfile = await getCurrentProfile();

    const [
      { data: queueData },
      { data: summaryData },
      { data: feedbackData },
      { data: counterData },
      { data: colleagueData },
    ] = await Promise.all([
      supabase
        .from("v_agent_queue")
        .select("*")
        .order("created_at", { ascending: true }),

      supabase
        .from("v_report_daily_summary")
        .select("*")
        .gte("business_date", appliedFilters.fromDate)
        .lte("business_date", appliedFilters.toDate),

      supabase
        .from("v_report_feedback")
        .select("rating"),

      supabase
        .from("counters")
        .select(
          "id, counter_code, counter_name, status, branch_id"
        ),

      supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .eq("role", "agent"),
    ]);

    setRows(
      ((queueData ?? []) as QueueRowExtended[]) ?? []
    );

    setSummaryRows(
      ((summaryData ?? []) as DailySummary[]) ?? []
    );

    setFeedback(
      ((feedbackData ?? []) as FeedbackRow[]) ?? []
    );

    setCounters(
      ((counterData ?? []) as Counter[]) ?? []
    );

    setColleagues(
      ((colleagueData ?? []) as AgentOption[]) ?? []
    );

    setProfile(currentProfile);

    setLoading(false);
  }, [
    appliedFilters.fromDate,
    appliedFilters.toDate,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  // ==========================================================
  // REALTIME
  // ==========================================================

  useEffect(() => {
    const channel = supabase
      .channel("supervisor-dashboard")

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_tickets",
        },
        load
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_cases",
        },
        load
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "counters",
        },
        load
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  // ==========================================================
  // FILTER ACTION
  // ==========================================================

  function handleApplyFilters() {
    if (!fromDate || !toDate) {
      return;
    }

    if (fromDate > toDate) {
      window.alert(
        "Ngày bắt đầu không được lớn hơn ngày kết thúc."
      );
      return;
    }

    setAppliedFilters({
      fromDate,
      toDate,
      agent: agentFilter,
      branch: branchFilter,
      category: categoryFilter,
      status: statusFilter,
    });
  }

  function handleResetFilters() {
    setFromDate(today);
    setToDate(today);
    setAgentFilter("");
    setBranchFilter("");
    setCategoryFilter("");
    setStatusFilter("");

    setAppliedFilters({
      fromDate: today,
      toDate: today,
      agent: "",
      branch: "",
      category: "",
      status: "",
    });
  }

  // ==========================================================
  // COUNTER
  // ==========================================================

  async function handleToggleCounter(counter: Counter) {
    const next =
      counter.status === "AVAILABLE"
        ? "CLOSED"
        : "AVAILABLE";

    await supabase.rpc("set_counter_status", {
      p_counter_id: counter.id,
      p_status: next,
    });

    load();
  }

  // ==========================================================
  // REASSIGN
  // ==========================================================

  async function handleReassign(
    caseId: string,
    toAgentId: string
  ) {
    await supabase.rpc("reassign_case", {
      p_case_id: caseId,
      p_to_agent_id: toAgentId,
    });

    setReassignOpenFor(null);
    load();
  }

  // ==========================================================
  // FILTER OPTIONS
  // ==========================================================

  const categories = useMemo(() => {
    return Array.from(
      new Set(
        rows
          .map((r) => r.category_name)
          .filter(Boolean)
      )
    ).sort();
  }, [rows]);

  const branches = useMemo(() => {
    const result = new Map<string, string>();

    rows.forEach((row) => {
      const extended = row as QueueRowExtended;

      if (
        extended.branch_id &&
        extended.branch_name
      ) {
        result.set(
          extended.branch_id,
          extended.branch_name
        );
      }
    });

    counters.forEach((counter) => {
      if (counter.branch_id) {
        result.set(
          counter.branch_id,
          counter.branch_id
        );
      }
    });

    return Array.from(result.entries());
  }, [rows, counters]);

  // ==========================================================
  // FILTER TICKETS
  // ==========================================================

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const extended = row as QueueRowExtended;

      const matchCategory =
        !appliedFilters.category ||
        row.category_name === appliedFilters.category;

      const matchStatus =
        !appliedFilters.status ||
        row.status === appliedFilters.status;

      const matchAgent =
        !appliedFilters.agent ||
        extended.assigned_agent_id ===
          appliedFilters.agent;

      const matchBranch =
        !appliedFilters.branch ||
        extended.branch_id ===
          appliedFilters.branch;

      let matchDate = true;

      if (extended.created_at) {
        const createdDate =
          new Date(extended.created_at)
            .toISOString()
            .slice(0, 10);

        matchDate =
          createdDate >= appliedFilters.fromDate &&
          createdDate <= appliedFilters.toDate;
      }

      return (
        matchCategory &&
        matchStatus &&
        matchAgent &&
        matchBranch &&
        matchDate
      );
    });
  }, [rows, appliedFilters]);

  // ==========================================================
  // SUMMARY
  // ==========================================================

  const summary = useMemo<DailySummary | null>(() => {
    if (summaryRows.length === 0) {
      return null;
    }

    const totalVisits = summaryRows.reduce(
      (sum, row) => sum + (row.total_visits ?? 0),
      0
    );

    const uniqueDrivers = summaryRows.reduce(
      (sum, row) => sum + (row.unique_drivers ?? 0),
      0
    );

    const totalTickets = summaryRows.reduce(
      (sum, row) => sum + (row.total_tickets ?? 0),
      0
    );

    const completedTickets = summaryRows.reduce(
      (sum, row) =>
        sum + (row.completed_tickets ?? 0),
      0
    );

    const waitingValues = summaryRows
      .map((row) => row.avg_waiting_time_min)
      .filter(
        (value): value is number =>
          value != null
      );

    const handlingValues = summaryRows
      .map((row) => row.avg_handling_time_min)
      .filter(
        (value): value is number =>
          value != null
      );

    const avgWaiting =
      waitingValues.length > 0
        ? waitingValues.reduce(
            (sum, value) => sum + value,
            0
          ) / waitingValues.length
        : null;

    const avgHandling =
      handlingValues.length > 0
        ? handlingValues.reduce(
            (sum, value) => sum + value,
            0
          ) / handlingValues.length
        : null;

    return {
      branch: "ALL",
      business_date: appliedFilters.fromDate,
      total_visits: totalVisits,
      unique_drivers: uniqueDrivers,
      total_tickets: totalTickets,
      completed_tickets: completedTickets,
      avg_waiting_time_min:
        avgWaiting !== null
          ? Number(avgWaiting.toFixed(1))
          : null,
      avg_handling_time_min:
        avgHandling !== null
          ? Number(avgHandling.toFixed(1))
          : null,
    };
  }, [summaryRows, appliedFilters.fromDate]);

  // ==========================================================
  // LIVE KPI FROM FILTERED TICKETS
  // ==========================================================

  const waiting = filtered.filter(
    (r) => r.status === "WAITING"
  ).length;

  const processing = filtered.filter(
    (r) => r.status === "PROCESSING"
  ).length;

  const pending = filtered.filter(
    (r) => r.status === "PENDING"
  ).length;

  const overSla = filtered.filter((r) => {
    return (
      r.sla_due_at &&
      new Date(r.sla_due_at).getTime() <
        Date.now() &&
      !r.resolved_at &&
      !r.closed_at &&
      r.status !== "PENDING"
    );
  }).length;

  const completed = filtered.filter((r) =>
    ["RESOLVED", "CLOSED"].includes(r.status)
  ).length;

  const avgCsat =
    feedback.length > 0
      ? (
          feedback.reduce(
            (sum, row) => sum + row.rating,
            0
          ) / feedback.length
        ).toFixed(1)
      : "—";

  const slaCompliance =
    summary && summary.total_tickets > 0
      ? Math.round(
          (completed /
            summary.total_tickets) *
            100
        )
      : null;

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Dashboard{" "}
          {profile?.role === "admin"
            ? "(toàn hệ thống)"
            : ""}
        </h1>

        <p className="font-body text-sm text-ink/50">
          Theo dõi vận hành và hiệu suất xử lý
          ticket.
        </p>
      </div>

      {/* ======================================================
          FILTER
      ====================================================== */}

      <div className="rounded-card border border-line bg-white p-5">
        <div className="mb-4">
          <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
            Bộ lọc
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Từ ngày
            </label>

            <input
              type="date"
              value={fromDate}
              onChange={(e) =>
                setFromDate(e.target.value)
              }
              className="w-full rounded-lg border-2 border-line px-3 py-2 font-body text-sm focus:border-brand-700"
            />
          </div>

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Đến ngày
            </label>

            <input
              type="date"
              value={toDate}
              onChange={(e) =>
                setToDate(e.target.value)
              }
              className="w-full rounded-lg border-2 border-line px-3 py-2 font-body text-sm focus:border-brand-700"
            />
          </div>

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Agent
            </label>

            <select
              value={agentFilter}
              onChange={(e) =>
                setAgentFilter(e.target.value)
              }
              className="w-full rounded-lg border-2 border-line bg-white px-3 py-2 font-body text-sm focus:border-brand-700"
            >
              <option value="">
                Tất cả Agent
              </option>

              {colleagues.map((agent) => (
                <option
                  key={agent.id}
                  value={agent.id}
                >
                  {agent.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              VP
            </label>

            <select
              value={branchFilter}
              onChange={(e) =>
                setBranchFilter(e.target.value)
              }
              className="w-full rounded-lg border-2 border-line bg-white px-3 py-2 font-body text-sm focus:border-brand-700"
            >
              <option value="">
                Tất cả VP
              </option>

              {branches.map(
                ([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                )
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Category
            </label>

            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value)
              }
              className="w-full rounded-lg border-2 border-line bg-white px-3 py-2 font-body text-sm focus:border-brand-700"
            >
              <option value="">
                Tất cả Category
              </option>

              {categories.map((category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Trạng thái
            </label>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value)
              }
              className="min-w-[200px] rounded-lg border-2 border-line bg-white px-3 py-2 font-body text-sm focus:border-brand-700"
            >
              <option value="">
                Tất cả trạng thái
              </option>
              <option value="WAITING">
                Đang chờ
              </option>
              <option value="CALLED">
                Đã gọi
              </option>
              <option value="PROCESSING">
                Đang xử lý
              </option>
              <option value="PENDING">
                Tạm hoãn
              </option>
              <option value="TRANSFERRED">
                Đã chuyển
              </option>
              <option value="RESOLVED">
                Đã giải quyết
              </option>
              <option value="CLOSED">
                Đã đóng
              </option>
            </select>
          </div>

          <div className="flex gap-3">
            <PrimaryButton
              onClick={handleApplyFilters}
              disabled={loading}
            >
              ÁP DỤNG
            </PrimaryButton>

            <SecondaryButton
              onClick={handleResetFilters}
              disabled={loading}
            >
              RESET
            </SecondaryButton>
          </div>
        </div>
      </div>

      {/* ======================================================
          SUMMARY
      ====================================================== */}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
            Tổng quan
          </p>

          <p className="font-body text-xs text-ink/40">
            {appliedFilters.fromDate ===
            appliedFilters.toDate
              ? appliedFilters.fromDate
              : `${appliedFilters.fromDate} → ${appliedFilters.toDate}`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard
            label="Total Visits"
            value={summary?.total_visits ?? 0}
          />

          <StatCard
            label="Unique Drivers"
            value={summary?.unique_drivers ?? 0}
          />

          <StatCard
            label="Total Tickets"
            value={summary?.total_tickets ?? 0}
          />

          <StatCard
            label="Completed"
            value={completed}
          />

          <StatCard
            label="Waiting"
            value={waiting}
          />

          <StatCard
            label="Processing"
            value={processing}
          />

          <StatCard
            label="Pending"
            value={pending}
            tone="warn"
          />

          <StatCard
            label="Over SLA"
            value={overSla}
            tone="danger"
          />
        </div>
      </div>

      {/* ======================================================
          PERFORMANCE KPI
      ====================================================== */}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Avg Waiting Time"
          value={
            summary?.avg_waiting_time_min != null
              ? `${summary.avg_waiting_time_min}p`
              : "—"
          }
        />

        <StatCard
          label="Avg Handling Time"
          value={
            summary?.avg_handling_time_min != null
              ? `${summary.avg_handling_time_min}p`
              : "—"
          }
        />

        <StatCard
          label="SLA Compliance"
          value={
            slaCompliance !== null
              ? `${slaCompliance}%`
              : "—"
          }
        />

        <StatCard
          label="CSAT"
          value={avgCsat}
        />
      </div>

      {/* ======================================================
          COUNTERS
      ====================================================== */}

      <div>
        <p className="mb-3 font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
          Quầy
        </p>

        <div className="flex flex-wrap gap-3">
          {counters.map((counter) => (
            <div
              key={counter.id}
              className="flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3"
            >
              <span className="font-body text-sm font-semibold text-ink">
                {counter.counter_name}
              </span>

              <StatusCounterBadge
                status={counter.status}
              />

              {(counter.status ===
                "AVAILABLE" ||
                counter.status === "CLOSED") && (
                <SecondaryButton
                  onClick={() =>
                    handleToggleCounter(counter)
                  }
                  className="px-3 py-1 text-xs"
                >
                  {counter.status ===
                  "AVAILABLE"
                    ? "Đóng"
                    : "Mở"}
                </SecondaryButton>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ======================================================
          TICKET LIST
      ====================================================== */}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
              Tất cả ticket
            </p>

            <p className="mt-1 font-body text-xs text-ink/40">
              {filtered.length} ticket
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left font-body text-sm">
              <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
                <tr>
                  <th className="px-4 py-3">
                    Số
                  </th>

                  <th className="px-4 py-3">
                    Tài xế
                  </th>

                  <th className="px-4 py-3">
                    Nhu cầu
                  </th>

                  <th className="px-4 py-3">
                    Agent
                  </th>

                  <th className="px-4 py-3">
                    SLA
                  </th>

                  <th className="px-4 py-3">
                    Trạng thái
                  </th>

                  <th className="px-4 py-3">
                    Reassign
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-ink/40"
                    >
                      Đang tải...
                    </td>
                  </tr>
                )}

                {!loading &&
                  filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-ink/40"
                      >
                        Không có ticket phù hợp
                        với bộ lọc.
                      </td>
                    </tr>
                  )}

                {!loading &&
                  filtered.map((row) => {
                    const extended =
                      row as QueueRowExtended;

                    return (
                      <tr
                        key={row.ticket_id}
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-4 py-3 font-display font-bold text-brand-900">
                          {row.queue_number}
                        </td>

                        <td className="px-4 py-3">
                          {row.driver_name}
                        </td>

                        <td className="px-4 py-3">
                          {row.category_name}
                        </td>

                        <td className="px-4 py-3">
                          {extended.assigned_agent_name ??
                            colleagues.find(
                              (agent) =>
                                agent.id ===
                                extended.assigned_agent_id
                            )?.full_name ??
                            "—"}
                        </td>

                        <td className="px-4 py-3">
                          <SlaBadge
                            slaDueAt={
                              row.sla_due_at
                            }
                          />
                        </td>

                        <td className="px-4 py-3">
                          <StatusBadge
                            status={row.status}
                          />
                        </td>

                        <td className="px-4 py-3">
                          {reassignOpenFor ===
                          row.case_id ? (
                            <select
                              autoFocus
                              onChange={(e) =>
                                e.target.value &&
                                handleReassign(
                                  row.case_id,
                                  e.target.value
                                )
                              }
                              onBlur={() =>
                                setReassignOpenFor(
                                  null
                                )
                              }
                              className="rounded-lg border-2 border-line px-2 py-1 font-body text-xs"
                            >
                              <option value="">
                                -- Chọn agent --
                              </option>

                              {colleagues.map(
                                (agent) => (
                                  <option
                                    key={agent.id}
                                    value={agent.id}
                                  >
                                    {agent.full_name}
                                  </option>
                                )
                              )}
                            </select>
                          ) : (
                            <SecondaryButton
                              onClick={() =>
                                setReassignOpenFor(
                                  row.case_id
                                )
                              }
                              className="px-3 py-1 text-xs"
                            >
                              Reassign
                            </SecondaryButton>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusCounterBadge({
  status,
}: {
  status: Counter["status"];
}) {
  const color =
    status === "AVAILABLE"
      ? "bg-green-50 text-brand-700"
      : status === "BUSY"
      ? "bg-brand-100 text-brand-900"
      : status === "OFFLINE"
      ? "bg-red-50 text-danger"
      : "bg-line/40 text-ink/50";

  return (
    <span
      className={`rounded-full px-2 py-0.5 font-body text-xs font-semibold ${color}`}
    >
      {status}
    </span>
  );
}
