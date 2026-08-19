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
  created_at?: string;
};

type TrendValue = {
  current: number;
  previous: number;
  change: number | null;
};

type TrendMetrics = {
  tickets: TrendValue;
  completed: TrendValue;
  visits: TrendValue;
  uniqueDrivers: TrendValue;
  waiting: TrendValue;
  handling: TrendValue;
  csat: TrendValue;
};

function dateToString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getPreviousMonthSamePeriod(date: Date) {
  const currentDay = date.getDate();

  const previousMonthStart = new Date(
    date.getFullYear(),
    date.getMonth() - 1,
    1
  );

  const previousMonthLastDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    0
  ).getDate();

  const day = Math.min(currentDay, previousMonthLastDay);

  return new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    day
  );
}

function percentChange(
  current: number | null,
  previous: number | null
): number | null {
  if (current == null || previous == null) {
    return null;
  }

  if (previous === 0) {
    if (current === 0) {
      return 0;
    }

    return null;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function buildTrend(
  current: number | null,
  previous: number | null
): TrendValue {
  return {
    current: current ?? 0,
    previous: previous ?? 0,
    change: percentChange(current, previous),
  };
}

function formatChange(change: number | null) {
  if (change == null) {
    return "—";
  }

  const rounded = change.toFixed(1);

  if (change > 0) {
    return `+${rounded}%`;
  }

  if (change < 0) {
    return `${rounded}%`;
  }

  return "0.0%";
}

function trendColor(
  change: number | null,
  inverse = false
) {
  if (change == null || change === 0) {
    return "text-ink/50";
  }

  const positive = inverse
    ? change < 0
    : change > 0;

  return positive
    ? "text-brand-700"
    : "text-danger";
}

function trendArrow(change: number | null) {
  if (change == null || change === 0) {
    return "→";
  }

  return change > 0 ? "↑" : "↓";
}

function TrendBadge({
  value,
  inverse = false,
}: {
  value: TrendValue;
  inverse?: boolean;
}) {
  return (
    <span
      className={`font-body text-xs font-semibold ${trendColor(
        value.change,
        inverse
      )}`}
    >
      {trendArrow(value.change)}{" "}
      {formatChange(value.change)}
    </span>
  );
}

function average(
  values: Array<number | null>
): number | null {
  const valid = values.filter(
    (value): value is number =>
      value != null &&
      !Number.isNaN(Number(value))
  );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (sum, value) => sum + value,
      0
    ) / valid.length
  );
}

function aggregateSummaries(
  summaries: DailySummary[]
) {
  return {
    tickets: summaries.reduce(
      (sum, row) =>
        sum + Number(row.total_tickets || 0),
      0
    ),

    completed: summaries.reduce(
      (sum, row) =>
        sum + Number(row.completed_tickets || 0),
      0
    ),

    visits: summaries.reduce(
      (sum, row) =>
        sum + Number(row.total_visits || 0),
      0
    ),

    uniqueDrivers: summaries.reduce(
      (sum, row) =>
        sum + Number(row.unique_drivers || 0),
      0
    ),

    waiting: average(
      summaries.map(
        (row) => row.avg_waiting_time_min
      )
    ),

    handling: average(
      summaries.map(
        (row) => row.avg_handling_time_min
      )
    ),
  };
}

function TrendCard({
  label,
  trend,
  inverse = false,
  suffix = "",
  decimals = 0,
}: {
  label: string;
  trend: TrendValue;
  inverse?: boolean;
  suffix?: string;
  decimals?: number;
}) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-body text-xs font-semibold uppercase tracking-wide text-ink/50">
          {label}
        </span>

        <TrendBadge
          value={trend}
          inverse={inverse}
        />
      </div>

      <div className="font-display text-xl font-bold text-brand-900">
        {trend.current.toFixed(decimals)}
        {suffix}
      </div>

      <div className="mt-1 font-body text-xs text-ink/45">
        Previous:{" "}
        {trend.previous.toFixed(decimals)}
        {suffix}
      </div>
    </div>
  );
}

function BenchmarkSection({
  title,
  metrics,
}: {
  title: string;
  metrics: TrendMetrics;
}) {
  return (
    <div>
      <div className="mb-3">
        <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
          {title}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <TrendCard
          label="Tickets"
          trend={metrics.tickets}
        />

        <TrendCard
          label="Completed"
          trend={metrics.completed}
        />

        <TrendCard
          label="Visits"
          trend={metrics.visits}
        />

        <TrendCard
          label="Drivers"
          trend={metrics.uniqueDrivers}
        />

        <TrendCard
          label="Waiting Time"
          trend={metrics.waiting}
          inverse
          suffix="p"
          decimals={1}
        />

        <TrendCard
          label="Handling Time"
          trend={metrics.handling}
          inverse
          suffix="p"
          decimals={1}
        />
      </div>
    </div>
  );
}

function SimpleTrendChart({
  data,
}: {
  data: Array<{
    date: string;
    tickets: number;
    completed: number;
  }>;
}) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map((item) =>
      Math.max(
        item.tickets,
        item.completed
      )
    ),
    1
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5 font-body text-xs text-ink/60">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-700" />
          Tickets
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-300" />
          Completed
        </div>
      </div>

      <div className="flex h-64 items-end gap-1 overflow-x-auto border-b border-line px-2">
        {data.map((item) => {
          const ticketHeight = Math.max(
            4,
            (item.tickets / maxValue) * 220
          );

          const completedHeight = Math.max(
            4,
            (item.completed / maxValue) * 220
          );

          return (
            <div
              key={item.date}
              className="flex min-w-[28px] flex-1 items-end justify-center gap-0.5"
              title={`${item.date}: ${item.tickets} tickets / ${item.completed} completed`}
            >
              <div
                className="w-2 rounded-t bg-brand-700 transition-all"
                style={{
                  height: `${ticketHeight}px`,
                }}
              />

              <div
                className="w-2 rounded-t bg-brand-300 transition-all"
                style={{
                  height: `${completedHeight}px`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between px-2 font-body text-[10px] text-ink/40">
        <span>{data[0]?.date}</span>
        <span>
          {data[data.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}

export default function SupervisorDashboardPage() {
  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [rows, setRows] =
    useState<AgentQueueRow[]>([]);

  const [summary, setSummary] =
    useState<DailySummary | null>(null);

  const [feedback, setFeedback] =
    useState<FeedbackRow[]>([]);

  const [counters, setCounters] =
    useState<Counter[]>([]);

  const [colleagues, setColleagues] =
    useState<AgentOption[]>([]);

  const [trendMetrics, setTrendMetrics] =
    useState<{
      dod: TrendMetrics | null;
      wow: TrendMetrics | null;
      mom: TrendMetrics | null;
    }>({
      dod: null,
      wow: null,
      mom: null,
    });

  const [chartData, setChartData] =
    useState<
      Array<{
        date: string;
        tickets: number;
        completed: number;
      }>
    >([]);

  const [loading, setLoading] =
    useState(true);

  const [categoryFilter, setCategoryFilter] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("");

  const [agentFilter, setAgentFilter] =
    useState("");

  const [reassignOpenFor, setReassignOpenFor] =
    useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const today = startOfDay(new Date());

    const todayStr = dateToString(today);

    const yesterdayStr = dateToString(
      addDays(today, -1)
    );

    const weekAgoStr = dateToString(
      addDays(today, -7)
    );

    const monthAgoDate =
      getPreviousMonthSamePeriod(today);

    const monthAgoStr =
      dateToString(monthAgoDate);

    const chartStart = dateToString(
      addDays(today, -29)
    );

    const [
      { data: queueData, error: queueError },
      { data: summaryData },
      { data: feedbackData },
      { data: counterData },
      { data: colleagueData },
      { data: trendData },
      { data: chartSummaryData },
    ] = await Promise.all([
      supabase
        .from("v_agent_queue")
        .select("*")
        .order("created_at", {
          ascending: true,
        }),

      supabase
        .from("v_report_daily_summary")
        .select("*")
        .eq("business_date", todayStr),

      supabase
        .from("v_report_feedback")
        .select("rating, created_at"),

      supabase
        .from("counters")
        .select(
          "id, counter_code, counter_name, status, branch_id"
        ),

      supabase
        .from("profiles")
        .select(
          "id, full_name, email, role"
        )
        .eq("role", "agent"),

      supabase
        .from("v_report_daily_summary")
        .select("*")
        .gte(
          "business_date",
          monthAgoStr
        )
        .lte(
          "business_date",
          todayStr
        )
        .order("business_date", {
          ascending: true,
        }),

      supabase
        .from("v_report_daily_summary")
        .select("*")
        .gte(
          "business_date",
          chartStart
        )
        .lte(
          "business_date",
          todayStr
        )
        .order("business_date", {
          ascending: true,
        }),
    ]);

    if (queueError) {
      console.error(
        "Failed to load queue:",
        queueError
      );
    }

    /*
     * AgentQueueRow hiện tại không khai báo agent_name.
     * View thực tế có thể trả về agent_name.
     * Normalize ở đây để tránh phá type gốc.
     */
    const normalizedRows =
      ((queueData as Array<
        AgentQueueRow & {
          agent_name?: string | null;
        }
      >) ?? []) as AgentQueueRow[];

    setRows(normalizedRows);

    setSummary(
      ((summaryData as DailySummary[]) ?? [])[0] ??
        null
    );

    const loadedFeedback =
      (feedbackData as FeedbackRow[]) ?? [];

    setFeedback(loadedFeedback);

    setCounters(
      (counterData as Counter[]) ?? []
    );

    setColleagues(
      (colleagueData as AgentOption[]) ?? []
    );

    const summaries =
      (trendData as DailySummary[]) ?? [];

    const chartSummaries =
      (chartSummaryData as DailySummary[]) ?? [];

    const getDateSummary = (
      date: string
    ) =>
      summaries.filter(
        (row) =>
          row.business_date === date
      );

    const todaySummary =
      aggregateSummaries(
        getDateSummary(todayStr)
      );

    const yesterdaySummary =
      aggregateSummaries(
        getDateSummary(yesterdayStr)
      );

    const weekSummary =
      aggregateSummaries(
        getDateSummary(weekAgoStr)
      );

    const monthSummary =
      aggregateSummaries(
        getDateSummary(monthAgoStr)
      );

    const feedbackByDate = (
      start: string,
      end: string
    ) => {
      return loadedFeedback.filter(
        (item) => {
          if (!item.created_at) {
            return false;
          }

          const date =
            item.created_at.slice(0, 10);

          return (
            date >= start &&
            date <= end
          );
        }
      );
    };

    const calculateCsat = (
      items: FeedbackRow[]
    ) => {
      if (!items.length) {
        return null;
      }

      const validRatings = items
        .map((item) =>
          Number(item.rating)
        )
        .filter(
          (rating) =>
            !Number.isNaN(rating)
        );

      if (!validRatings.length) {
        return null;
      }

      return (
        validRatings.reduce(
          (sum, rating) =>
            sum + rating,
          0
        ) / validRatings.length
      );
    };

    const todayCsat =
      calculateCsat(
        feedbackByDate(
          todayStr,
          todayStr
        )
      );

    const yesterdayCsat =
      calculateCsat(
        feedbackByDate(
          yesterdayStr,
          yesterdayStr
        )
      );

    const weekCsat =
      calculateCsat(
        feedbackByDate(
          weekAgoStr,
          weekAgoStr
        )
      );

    const monthCsat =
      calculateCsat(
        feedbackByDate(
          monthAgoStr,
          monthAgoStr
        )
      );

    setTrendMetrics({
      dod: {
        tickets: buildTrend(
          todaySummary.tickets,
          yesterdaySummary.tickets
        ),

        completed: buildTrend(
          todaySummary.completed,
          yesterdaySummary.completed
        ),

        visits: buildTrend(
          todaySummary.visits,
          yesterdaySummary.visits
        ),

        uniqueDrivers: buildTrend(
          todaySummary.uniqueDrivers,
          yesterdaySummary.uniqueDrivers
        ),

        waiting: buildTrend(
          todaySummary.waiting,
          yesterdaySummary.waiting
        ),

        handling: buildTrend(
          todaySummary.handling,
          yesterdaySummary.handling
        ),

        csat: buildTrend(
          todayCsat,
          yesterdayCsat
        ),
      },

      wow: {
        tickets: buildTrend(
          todaySummary.tickets,
          weekSummary.tickets
        ),

        completed: buildTrend(
          todaySummary.completed,
          weekSummary.completed
        ),

        visits: buildTrend(
          todaySummary.visits,
          weekSummary.visits
        ),

        uniqueDrivers: buildTrend(
          todaySummary.uniqueDrivers,
          weekSummary.uniqueDrivers
        ),

        waiting: buildTrend(
          todaySummary.waiting,
          weekSummary.waiting
        ),

        handling: buildTrend(
          todaySummary.handling,
          weekSummary.handling
        ),

        csat: buildTrend(
          todayCsat,
          weekCsat
        ),
      },

      mom: {
        tickets: buildTrend(
          todaySummary.tickets,
          monthSummary.tickets
        ),

        completed: buildTrend(
          todaySummary.completed,
          monthSummary.completed
        ),

        visits: buildTrend(
          todaySummary.visits,
          monthSummary.visits
        ),

        uniqueDrivers: buildTrend(
          todaySummary.uniqueDrivers,
          monthSummary.uniqueDrivers
        ),

        waiting: buildTrend(
          todaySummary.waiting,
          monthSummary.waiting
        ),

        handling: buildTrend(
          todaySummary.handling,
          monthSummary.handling
        ),

        csat: buildTrend(
          todayCsat,
          monthCsat
        ),
      },
    });

    const groupedChart = new Map<
      string,
      {
        date: string;
        tickets: number;
        completed: number;
      }
    >();

    chartSummaries.forEach((row) => {
      const existing =
        groupedChart.get(
          row.business_date
        );

      if (existing) {
        existing.tickets += Number(
          row.total_tickets || 0
        );

        existing.completed += Number(
          row.completed_tickets || 0
        );
      } else {
        groupedChart.set(
          row.business_date,
          {
            date: row.business_date,
            tickets: Number(
              row.total_tickets || 0
            ),
            completed: Number(
              row.completed_tickets || 0
            ),
          }
        );
      }
    });

    setChartData(
      Array.from(
        groupedChart.values()
      ).sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    getCurrentProfile().then(setProfile);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        () => {
          load();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_cases",
        },
        () => {
          load();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "counters",
        },
        () => {
          load();
        }
      )

      .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [load]);

  async function handleToggleCounter(
    counter: Counter
  ) {
    const next =
      counter.status === "AVAILABLE"
        ? "CLOSED"
        : "AVAILABLE";

    await supabase.rpc(
      "set_counter_status",
      {
        p_counter_id: counter.id,
        p_status: next,
      }
    );

    load();
  }

  async function handleReassign(
    caseId: string,
    toAgentId: string
  ) {
    await supabase.rpc(
      "reassign_case",
      {
        p_case_id: caseId,
        p_to_agent_id: toAgentId,
      }
    );

    setReassignOpenFor(null);
    load();
  }

  /*
   * Không dùng r.agent_name trực tiếp vì
   * AgentQueueRow hiện chưa khai báo field này.
   */
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const row =
        r as AgentQueueRow & {
          agent_name?: string | null;
        };

      return (
        (!categoryFilter ||
          r.category_name ===
            categoryFilter) &&
        (!statusFilter ||
          r.status ===
            statusFilter) &&
        (!agentFilter ||
          row.agent_name ===
            agentFilter)
      );
    });
  }, [
    rows,
    categoryFilter,
    statusFilter,
    agentFilter,
  ]);

  const categories = Array.from(
    new Set(
      rows
        .map((r) => r.category_name)
        .filter(Boolean)
    )
  );

  const agents = Array.from(
    new Set(
      rows
        .map(
          (r) =>
            (
              r as AgentQueueRow & {
                agent_name?: string | null;
              }
            ).agent_name
        )
        .filter(Boolean) as string[]
    )
  );

  const waiting = rows.filter(
    (r) =>
      r.status === "WAITING"
  ).length;

  const processing = rows.filter(
    (r) =>
      r.status === "PROCESSING"
  ).length;

  const pending = rows.filter(
    (r) =>
      r.status === "PENDING"
  ).length;

  const overSla = rows.filter(
    (r) =>
      r.sla_due_at &&
      new Date(
        r.sla_due_at
      ).getTime() <
        Date.now() &&
      !r.resolved_at &&
      !r.closed_at &&
      r.status !== "PENDING"
  ).length;

  const completed = rows.filter(
    (r) =>
      [
        "RESOLVED",
        "CLOSED",
      ].includes(r.status)
  ).length;

  const avgCsat =
    feedback.length > 0
      ? (
          feedback.reduce(
            (a, b) =>
              a +
              Number(b.rating || 0),
            0
          ) / feedback.length
        ).toFixed(1)
      : "—";

  const dod = trendMetrics.dod;
  const wow = trendMetrics.wow;
  const mom = trendMetrics.mom;

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
          Theo dõi vận hành và xu hướng
          hiệu suất theo ngày, tuần và tháng.
        </p>
      </div>

      {/* ================= TODAY ================= */}

      <div>
        <p className="mb-3 font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
          Hôm nay
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard
            label="Total Visits"
            value={
              summary?.total_visits ?? 0
            }
          />

          <StatCard
            label="Unique Drivers"
            value={
              summary?.unique_drivers ?? 0
            }
          />

          <StatCard
            label="Total Tickets"
            value={
              summary?.total_tickets ?? 0
            }
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

      {/* ================= OPERATION KPI ================= */}

      <div>
        <p className="mb-3 font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
          Operation KPI
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Avg Waiting Time"
            value={
              summary?.avg_waiting_time_min !=
              null
                ? `${summary.avg_waiting_time_min}p`
                : "—"
            }
          />

          <StatCard
            label="Avg Handling Time"
            value={
              summary?.avg_handling_time_min !=
              null
                ? `${summary.avg_handling_time_min}p`
                : "—"
            }
          />

          <StatCard
            label="SLA Compliance"
            value={
              summary &&
              summary.total_tickets > 0
                ? `${Math.round(
                    (completed /
                      summary.total_tickets) *
                      100
                  )}%`
                : "—"
            }
          />

          <StatCard
            label="CSAT"
            value={avgCsat}
          />
        </div>
      </div>

      {/* ================= BENCHMARK ================= */}

      {dod && (
        <BenchmarkSection
          title="DoD — So với hôm qua"
          metrics={dod}
        />
      )}

      {wow && (
        <BenchmarkSection
          title="WoW — So với cùng ngày tuần trước"
          metrics={wow}
        />
      )}

      {mom && (
        <BenchmarkSection
          title="MoM — So với cùng kỳ tháng trước"
          metrics={mom}
        />
      )}

      {/* ================= CHART ================= */}

      <div className="rounded-card border border-line bg-white p-5">
        <div className="mb-5">
          <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
            Ticket Trend
          </p>

          <p className="mt-1 font-body text-xs text-ink/45">
            Xu hướng 30 ngày gần nhất
          </p>
        </div>

        <SimpleTrendChart
          data={chartData}
        />
      </div>

      {/* ================= COUNTERS ================= */}

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
              <span className="font-body text-sm font-semibold text-ink">
                {c.counter_name}
              </span>

              <StatusCounterBadge
                status={c.status}
              />

              {(c.status ===
                "AVAILABLE" ||
                c.status ===
                  "CLOSED") && (
                <SecondaryButton
                  onClick={() =>
                    handleToggleCounter(
                      c
                    )
                  }
                  className="px-3 py-1 text-xs"
                >
                  {c.status ===
                  "AVAILABLE"
                    ? "Đóng"
                    : "Mở"}
                </SecondaryButton>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ================= TICKET LIST ================= */}

      <div>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-body text-sm font-semibold uppercase tracking-wide text-ink/50">
              Tất cả ticket
            </p>

            <p className="mt-1 font-body text-xs text-ink/40">
              {filtered.length} ticket
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={agentFilter}
              onChange={(e) =>
                setAgentFilter(
                  e.target.value
                )
              }
              className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
            >
              <option value="">
                Tất cả agent
              </option>

              {agents.map(
                (agent) => (
                  <option
                    key={agent}
                    value={agent}
                  >
                    {agent}
                  </option>
                )
              )}
            </select>

            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(
                  e.target.value
                )
              }
              className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
            >
              <option value="">
                Tất cả category
              </option>

              {categories.map(
                (category) => (
                  <option
                    key={category}
                    value={category}
                  >
                    {category}
                  </option>
                )
              )}
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value
                )
              }
              className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
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
                    Agent
                  </th>

                  <th className="px-4 py-3">
                    Nhu cầu
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
                  filtered.length ===
                    0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-ink/40"
                      >
                        Không có ticket
                        phù hợp.
                      </td>
                    </tr>
                  )}

                {!loading &&
                  filtered.map((r) => {
                    const row =
                      r as AgentQueueRow & {
                        agent_name?: string | null;
                      };

                    return (
                      <tr
                        key={r.ticket_id}
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-4 py-3 font-display font-bold text-brand-900">
                          {r.queue_number}
                        </td>

                        <td className="px-4 py-3">
                          {r.driver_name}
                        </td>

                        <td className="px-4 py-3">
                          {row.agent_name ||
                            "—"}
                        </td>

                        <td className="px-4 py-3">
                          {r.category_name}
                        </td>

                        <td className="px-4 py-3">
                          <SlaBadge
                            slaDueAt={
                              r.sla_due_at
                            }
                          />
                        </td>

                        <td className="px-4 py-3">
                          <StatusBadge
                            status={
                              r.status
                            }
                          />
                        </td>

                        <td className="px-4 py-3">
                          {reassignOpenFor ===
                          r.case_id ? (
                            <select
                              autoFocus
                              onChange={(e) =>
                                e.target
                                  .value &&
                                handleReassign(
                                  r.case_id,
                                  e.target
                                    .value
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
                                (a) => (
                                  <option
                                    key={
                                      a.id
                                    }
                                    value={
                                      a.id
                                    }
                                  >
                                    {
                                      a.full_name
                                    }
                                  </option>
                                )
                              )}
                            </select>
                          ) : (
                            <SecondaryButton
                              onClick={() =>
                                setReassignOpenFor(
                                  r.case_id
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
