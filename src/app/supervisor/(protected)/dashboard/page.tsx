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

type PeriodSummary = {
  tickets: number;
  completed: number;
  visits: number;
  uniqueDrivers: number;
  waiting: number | null;
  handling: number | null;
  csat: number | null;
};

type ChartRow = {
  date: string;
  tickets: number;
  completed: number;
  visits: number;
  uniqueDrivers: number;
  waiting: number | null;
  handling: number | null;
  csat: number | null;
};

type QueueRow = AgentQueueRow & {
  agent_name?: string | null;
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
  if (current == null || previous == null) return null;

  if (previous === 0) {
    if (current === 0) return 0;
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

function average(values: Array<number | null>) {
  const valid = values.filter(
    (value): value is number =>
      value != null && !Number.isNaN(Number(value))
  );

  if (!valid.length) return null;

  return (
    valid.reduce((sum, value) => sum + value, 0) /
    valid.length
  );
}

function aggregateSummaries(
  summaries: DailySummary[]
): PeriodSummary {
  const tickets = summaries.reduce(
    (sum, row) => sum + Number(row.total_tickets || 0),
    0
  );

  const completed = summaries.reduce(
    (sum, row) => sum + Number(row.completed_tickets || 0),
    0
  );

  const visits = summaries.reduce(
    (sum, row) => sum + Number(row.total_visits || 0),
    0
  );

  const uniqueDrivers = summaries.reduce(
    (sum, row) => sum + Number(row.unique_drivers || 0),
    0
  );

  return {
    tickets,
    completed,
    visits,
    uniqueDrivers,
    waiting: average(
      summaries.map((row) => row.avg_waiting_time_min)
    ),
    handling: average(
      summaries.map((row) => row.avg_handling_time_min)
    ),
    csat: null,
  };
}

function formatChange(change: number | null) {
  if (change == null) return "—";
  if (change > 0) return `+${change.toFixed(1)}%`;
  if (change < 0) return `${change.toFixed(1)}%`;
  return "0.0%";
}

function trendColor(
  change: number | null,
  inverse = false
) {
  if (change == null || change === 0) {
    return "text-ink/45";
  }

  const positive = inverse ? change < 0 : change > 0;

  return positive ? "text-brand-700" : "text-danger";
}

function trendArrow(change: number | null) {
  if (change == null || change === 0) return "→";
  return change > 0 ? "↑" : "↓";
}

function BenchmarkItem({
  label,
  value,
  inverse = false,
  decimals = 0,
}: {
  label: string;
  value: TrendValue;
  inverse?: boolean;
  decimals?: number;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper/30 px-4 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-body text-xs text-ink/50">
          {label}
        </span>

        <span
          className={`font-body text-xs font-bold ${trendColor(
            value.change,
            inverse
          )}`}
        >
          {trendArrow(value.change)}{" "}
          {formatChange(value.change)}
        </span>
      </div>

      <div className="font-display text-lg font-bold text-brand-900">
        {value.current.toFixed(decimals)}
      </div>

      <div className="mt-0.5 font-body text-[11px] text-ink/40">
        Trước: {value.previous.toFixed(decimals)}
      </div>
    </div>
  );
}

function BenchmarkGroup({
  title,
  metrics,
}: {
  title: string;
  metrics: TrendMetrics;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-700" />
        <span className="font-body text-xs font-bold uppercase tracking-wide text-ink/55">
          {title}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <BenchmarkItem
          label="Tickets"
          value={metrics.tickets}
        />

        <BenchmarkItem
          label="Completed"
          value={metrics.completed}
        />

        <BenchmarkItem
          label="Visits"
          value={metrics.visits}
        />

        <BenchmarkItem
          label="Unique Drivers"
          value={metrics.uniqueDrivers}
        />

        <BenchmarkItem
          label="Waiting"
          value={metrics.waiting}
          inverse
          decimals={1}
        />

        <BenchmarkItem
          label="Handling"
          value={metrics.handling}
          inverse
          decimals={1}
        />
      </div>
    </div>
  );
}

/* =========================================================
   TREND CHARTS
========================================================= */

function ChartHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <p className="font-body text-sm font-bold text-brand-900">
        {title}
      </p>

      <p className="mt-1 font-body text-xs text-ink/45">
        {description}
      </p>
    </div>
  );
}

function VolumeChart({
  data,
}: {
  data: ChartRow[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map((row) =>
      Math.max(row.tickets, row.completed)
    ),
    1
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-5 text-xs text-ink/55">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-700" />
          Total Tickets
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-300" />
          Completed
        </div>
      </div>

      <div className="relative h-64 border-b border-line">
        <div className="absolute inset-x-0 bottom-0 flex h-[220px] items-end gap-1 overflow-x-auto px-1">
          {data.map((row) => {
            const ticketHeight =
              (row.tickets / maxValue) * 210;

            const completedHeight =
              (row.completed / maxValue) * 210;

            return (
              <div
                key={row.date}
                className="flex h-full min-w-[24px] flex-1 items-end justify-center gap-[2px]"
                title={`${row.date} · ${row.tickets} tickets · ${row.completed} completed`}
              >
                <div
                  className="w-2.5 rounded-t bg-brand-700 transition-all"
                  style={{
                    height: `${Math.max(
                      row.tickets > 0 ? 4 : 0,
                      ticketHeight
                    )}px`,
                  }}
                />

                <div
                  className="w-2.5 rounded-t bg-brand-300 transition-all"
                  style={{
                    height: `${Math.max(
                      row.completed > 0 ? 4 : 0,
                      completedHeight
                    )}px`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between px-1 text-[10px] text-ink/35">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function TrafficChart({
  data,
}: {
  data: ChartRow[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map((row) =>
      Math.max(
        row.visits,
        row.uniqueDrivers
      )
    ),
    1
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-5 text-xs text-ink/55">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-700" />
          Visits
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-300" />
          Unique Drivers
        </div>
      </div>

      <div className="relative h-64 border-b border-line">
        <div className="absolute inset-x-0 bottom-0 flex h-[220px] items-end gap-1 overflow-x-auto px-1">
          {data.map((row) => {
            const visitHeight =
              (row.visits / maxValue) * 210;

            const driverHeight =
              (row.uniqueDrivers / maxValue) *
              210;

            return (
              <div
                key={row.date}
                className="flex h-full min-w-[24px] flex-1 items-end justify-center gap-[2px]"
                title={`${row.date} · ${row.visits} visits · ${row.uniqueDrivers} drivers`}
              >
                <div
                  className="w-2.5 rounded-t bg-brand-700"
                  style={{
                    height: `${Math.max(
                      row.visits > 0 ? 4 : 0,
                      visitHeight
                    )}px`,
                  }}
                />

                <div
                  className="w-2.5 rounded-t bg-brand-300"
                  style={{
                    height: `${Math.max(
                      row.uniqueDrivers > 0
                        ? 4
                        : 0,
                      driverHeight
                    )}px`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between px-1 text-[10px] text-ink/35">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function PerformanceChart({
  data,
}: {
  data: ChartRow[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu
      </div>
    );
  }

  const valid = data.filter(
    (row) =>
      row.waiting != null ||
      row.handling != null
  );

  if (!valid.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu thời gian xử lý
      </div>
    );
  }

  const maxValue = Math.max(
    ...valid.flatMap((row) => [
      row.waiting ?? 0,
      row.handling ?? 0,
    ]),
    1
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-5 text-xs text-ink/55">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-700" />
          Waiting
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-300" />
          Handling
        </div>
      </div>

      <div className="relative h-64 border-b border-line">
        <div className="absolute inset-x-0 bottom-0 flex h-[220px] items-end gap-1 overflow-x-auto px-1">
          {valid.map((row) => {
            const waitingHeight =
              ((row.waiting ?? 0) / maxValue) *
              210;

            const handlingHeight =
              ((row.handling ?? 0) / maxValue) *
              210;

            return (
              <div
                key={row.date}
                className="flex h-full min-w-[24px] flex-1 items-end justify-center gap-[2px]"
                title={`${row.date} · Waiting ${(
                  row.waiting ?? 0
                ).toFixed(1)}p · Handling ${(
                  row.handling ?? 0
                ).toFixed(1)}p`}
              >
                <div
                  className="w-2.5 rounded-t bg-brand-700"
                  style={{
                    height: `${Math.max(
                      row.waiting != null ? 4 : 0,
                      waitingHeight
                    )}px`,
                  }}
                />

                <div
                  className="w-2.5 rounded-t bg-brand-300"
                  style={{
                    height: `${Math.max(
                      row.handling != null
                        ? 4
                        : 0,
                      handlingHeight
                    )}px`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between px-1 text-[10px] text-ink/35">
        <span>{valid[0]?.date}</span>
        <span>{valid[valid.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function CsATChart({
  data,
}: {
  data: ChartRow[];
}) {
  const valid = data.filter(
    (row) => row.csat != null
  );

  if (!valid.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu rating
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs text-ink/55">
        <span className="h-2.5 w-2.5 rounded-sm bg-brand-700" />
        CSAT / Rating
      </div>

      <div className="relative h-64 border-b border-line">
        <div className="absolute inset-x-0 bottom-0 flex h-[220px] items-end gap-1 overflow-x-auto px-1">
          {valid.map((row) => {
            const value = row.csat ?? 0;

            const height =
              Math.max(4, (value / 5) * 210);

            return (
              <div
                key={row.date}
                className="flex h-full min-w-[24px] flex-1 items-end justify-center"
                title={`${row.date} · Rating ${value.toFixed(
                  1
                )}/5`}
              >
                <div
                  className="w-3 rounded-t bg-brand-700"
                  style={{
                    height: `${height}px`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between px-1 text-[10px] text-ink/35">
        <span>{valid[0]?.date}</span>
        <span>
          {valid[valid.length - 1]?.date}
        </span>
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

export default function SupervisorDashboardPage() {
  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [rows, setRows] = useState<QueueRow[]>([]);
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
    useState<ChartRow[]>([]);

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

    const monthAgoStr = dateToString(
      getPreviousMonthSamePeriod(today)
    );

    const chartStart = dateToString(
      addDays(today, -29)
    );

    const [
      { data: queueData },
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
        .gte("business_date", monthAgoStr)
        .lte("business_date", todayStr)
        .order("business_date", {
          ascending: true,
        }),

      supabase
        .from("v_report_daily_summary")
        .select("*")
        .gte("business_date", chartStart)
        .lte("business_date", todayStr)
        .order("business_date", {
          ascending: true,
        }),
    ]);

    setRows(
      ((queueData as QueueRow[]) ?? [])
    );

    setSummary(
      ((summaryData as DailySummary[]) ?? [])[0] ??
        null
    );

    setFeedback(
      (feedbackData as FeedbackRow[]) ?? []
    );

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
    ) =>
      feedback.filter((item) => {
        if (!item.created_at) return false;

        const date =
          item.created_at.slice(0, 10);

        return (
          date >= start &&
          date <= end
        );
      });

    const getCsat = (
      items: FeedbackRow[]
    ) =>
      items.length
        ? items.reduce(
            (sum, item) =>
              sum + Number(item.rating || 0),
            0
          ) / items.length
        : null;

    const todayCsat = getCsat(
      feedbackByDate(
        todayStr,
        todayStr
      )
    );

    const yesterdayCsat = getCsat(
      feedbackByDate(
        yesterdayStr,
        yesterdayStr
      )
    );

    const weekCsat = getCsat(
      feedbackByDate(
        weekAgoStr,
        weekAgoStr
      )
    );

    const monthCsat = getCsat(
      feedbackByDate(
        monthAgoStr,
        monthAgoStr
      )
    );

    const createMetrics = (
      previous: PeriodSummary,
      previousCsat: number | null
    ): TrendMetrics => ({
      tickets: buildTrend(
        todaySummary.tickets,
        previous.tickets
      ),

      completed: buildTrend(
        todaySummary.completed,
        previous.completed
      ),

      visits: buildTrend(
        todaySummary.visits,
        previous.visits
      ),

      uniqueDrivers: buildTrend(
        todaySummary.uniqueDrivers,
        previous.uniqueDrivers
      ),

      waiting: buildTrend(
        todaySummary.waiting,
        previous.waiting
      ),

      handling: buildTrend(
        todaySummary.handling,
        previous.handling
      ),

      csat: buildTrend(
        todayCsat,
        previousCsat
      ),
    });

    setTrendMetrics({
      dod: createMetrics(
        yesterdaySummary,
        yesterdayCsat
      ),

      wow: createMetrics(
        weekSummary,
        weekCsat
      ),

      mom: createMetrics(
        monthSummary,
        monthCsat
      ),
    });

    /*
     * ============================
     * BUILD 30-DAY CHART
     * ============================
     */

    const groupedChart =
      new Map<string, ChartRow>();

    chartSummaries.forEach((row) => {
      const date = row.business_date;

      const existing =
        groupedChart.get(date);

      if (existing) {
        existing.tickets += Number(
          row.total_tickets || 0
        );

        existing.completed += Number(
          row.completed_tickets || 0
        );

        existing.visits += Number(
          row.total_visits || 0
        );

        existing.uniqueDrivers += Number(
          row.unique_drivers || 0
        );
      } else {
        groupedChart.set(date, {
          date,
          tickets: Number(
            row.total_tickets || 0
          ),
          completed: Number(
            row.completed_tickets || 0
          ),
          visits: Number(
            row.total_visits || 0
          ),
          uniqueDrivers: Number(
            row.unique_drivers || 0
          ),
          waiting:
            row.avg_waiting_time_min != null
              ? Number(
                  row.avg_waiting_time_min
                )
              : null,
          handling:
            row.avg_handling_time_min != null
              ? Number(
                  row.avg_handling_time_min
                )
              : null,
          csat: null,
        });
      }
    });

    /*
     * Add CSAT by date
     */
    const chartFeedback =
      feedback.filter((item) => {
        if (!item.created_at) return false;

        const date =
          item.created_at.slice(0, 10);

        return (
          date >= chartStart &&
          date <= todayStr
        );
      });

    const feedbackMap =
      new Map<string, number[]>();

    chartFeedback.forEach((item) => {
      if (!item.created_at) return;

      const date =
        item.created_at.slice(0, 10);

      const current =
        feedbackMap.get(date) ?? [];

      current.push(Number(item.rating || 0));

      feedbackMap.set(date, current);
    });

    feedbackMap.forEach(
      (ratings, date) => {
        const row =
          groupedChart.get(date);

        if (!row) return;

        row.csat =
          ratings.reduce(
            (sum, rating) =>
              sum + rating,
            0
          ) / ratings.length;
      }
    );

    setChartData(
      Array.from(
        groupedChart.values()
      ).sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );

    setLoading(false);
  }, [feedback]);

  useEffect(() => {
    getCurrentProfile().then(setProfile);
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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      return (
        (!categoryFilter ||
          r.category_name ===
            categoryFilter) &&
        (!statusFilter ||
          r.status === statusFilter) &&
        (!agentFilter ||
          r.agent_name === agentFilter)
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
        .map((r) => r.agent_name)
        .filter(Boolean)
    )
  );

  const waiting = rows.filter(
    (r) => r.status === "WAITING"
  ).length;

  const processing = rows.filter(
    (r) => r.status === "PROCESSING"
  ).length;

  const pending = rows.filter(
    (r) => r.status === "PENDING"
  ).length;

  const overSla = rows.filter(
    (r) =>
      r.sla_due_at &&
      new Date(r.sla_due_at).getTime() <
        Date.now() &&
      !r.resolved_at &&
      !r.closed_at &&
      r.status !== "PENDING"
  ).length;

  const completed = rows.filter(
    (r) =>
      ["RESOLVED", "CLOSED"].includes(
        r.status
      )
  ).length;

  const avgCsat =
    feedback.length > 0
      ? (
          feedback.reduce(
            (sum, item) =>
              sum + Number(item.rating || 0),
            0
          ) / feedback.length
        ).toFixed(1)
      : "—";

  const dod = trendMetrics.dod;
  const wow = trendMetrics.wow;
  const mom = trendMetrics.mom;

  return (
    <div className="space-y-8">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Dashboard{" "}
          {profile?.role === "admin"
            ? "(toàn hệ thống)"
            : ""}
        </h1>

        <p className="mt-1 font-body text-sm text-ink/50">
          Theo dõi vận hành, hiệu suất và xu
          hướng trung tâm dịch vụ.
        </p>
      </div>

      {/* =====================================================
          TODAY
      ===================================================== */}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
            Hôm nay
          </p>

          <span className="font-body text-xs text-ink/40">
            Real-time
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
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
      </section>

      {/* =====================================================
          OPERATION KPI
      ===================================================== */}

      <section>
        <p className="mb-3 font-body text-sm font-bold uppercase tracking-wide text-ink/50">
          Operation KPI
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Avg Waiting Time"
            value={
              summary?.avg_waiting_time_min !=
              null
                ? `${Number(
                    summary.avg_waiting_time_min
                  ).toFixed(1)}p`
                : "—"
            }
          />

          <StatCard
            label="Avg Handling Time"
            value={
              summary?.avg_handling_time_min !=
              null
                ? `${Number(
                    summary.avg_handling_time_min
                  ).toFixed(1)}p`
                : "—"
            }
          />

          <StatCard
            label="Completion Rate"
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
      </section>

      {/* =====================================================
          TREND
      ===================================================== */}

      <section>
        <div className="mb-4">
          <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
            Trend theo chủ đề
          </p>

          <p className="mt-1 font-body text-xs text-ink/40">
            Diễn biến 30 ngày gần nhất
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-line bg-white p-5">
            <ChartHeader
              title="Ticket Volume"
              description="Khối lượng ticket và số ticket đã hoàn tất"
            />

            <VolumeChart
              data={chartData}
            />
          </div>

          <div className="rounded-card border border-line bg-white p-5">
            <ChartHeader
              title="Traffic"
              description="Lượt ghé quầy và số tài xế duy nhất"
            />

            <TrafficChart
              data={chartData}
            />
          </div>

          <div className="rounded-card border border-line bg-white p-5">
            <ChartHeader
              title="Service Performance"
              description="Thời gian chờ và thời gian xử lý trung bình"
            />

            <PerformanceChart
              data={chartData}
            />
          </div>

          <div className="rounded-card border border-line bg-white p-5">
            <ChartHeader
              title="Customer Satisfaction"
              description="Rating trung bình theo ngày"
            />

            <CsATChart
              data={chartData}
            />
          </div>
        </div>
      </section>

      {/* =====================================================
          BENCHMARK
      ===================================================== */}

      <section className="rounded-card border border-line bg-white p-5">
        <div className="mb-5">
          <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
            Benchmark
          </p>

          <p className="mt-1 font-body text-xs text-ink/40">
            So sánh hiệu suất hôm nay với các mốc
            tham chiếu
          </p>
        </div>

        <div className="space-y-5">
          {dod && (
            <BenchmarkGroup
              title="DoD · So với hôm qua"
              metrics={dod}
            />
          )}

          {wow && (
            <BenchmarkGroup
              title="WoW · So với cùng ngày tuần trước"
              metrics={wow}
            />
          )}

          {mom && (
            <BenchmarkGroup
              title="MoM · So với cùng kỳ tháng trước"
              metrics={mom}
            />
          )}
        </div>
      </section>

      {/* =====================================================
          COUNTERS
      ===================================================== */}

      <section>
        <p className="mb-3 font-body text-sm font-bold uppercase tracking-wide text-ink/50">
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
                    handleToggleCounter(
                      counter
                    )
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
      </section>

      {/* =====================================================
          TICKET LIST
      ===================================================== */}

      <section>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
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

              {agents.map((agent) => (
                <option
                  key={agent}
                  value={agent}
                >
                  {agent}
                </option>
              ))}
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

              {categories.map((category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              ))}
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
                  filtered.length === 0 && (
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
                  filtered.map((r) => (
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
                        {r.agent_name || "—"}
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
                          status={r.status}
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
                              (agent) => (
                                <option
                                  key={
                                    agent.id
                                  }
                                  value={
                                    agent.id
                                  }
                                >
                                  {
                                    agent.full_name
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
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
