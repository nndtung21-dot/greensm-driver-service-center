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

type TrendSeriesKey =
  | "tickets"
  | "completed"
  | "visits"
  | "uniqueDrivers"
  | "waiting"
  | "handling"
  | "csat";

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
   TREND CHART
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

const trendSeries = [
  {
    key: "tickets" as TrendSeriesKey,
    label: "Tickets",
    group: "Ticket",
    color: "#16A34A",
  },
  {
    key: "completed" as TrendSeriesKey,
    label: "Completed",
    group: "Ticket",
    color: "#86EFAC",
  },
  {
    key: "visits" as TrendSeriesKey,
    label: "Visits",
    group: "Traffic",
    color: "#2563EB",
  },
  {
    key: "uniqueDrivers" as TrendSeriesKey,
    label: "Unique Drivers",
    group: "Traffic",
    color: "#93C5FD",
  },
  {
    key: "waiting" as TrendSeriesKey,
    label: "Waiting",
    group: "Service",
    color: "#F59E0B",
  },
  {
    key: "handling" as TrendSeriesKey,
    label: "Handling",
    group: "Service",
    color: "#FCD34D",
  },
  {
    key: "csat" as TrendSeriesKey,
    label: "CSAT",
    group: "CSAT",
    color: "#8B5CF6",
  },
];

function TrendChart({
  data,
}: {
  data: ChartRow[];
}) {
  const [activeGroups, setActiveGroups] = useState<string[]>([
    "Ticket",
    "Traffic",
    "Service",
    "CSAT",
  ]);

  const toggleGroup = (group: string) => {
    setActiveGroups((current) => {
      if (current.includes(group)) {
        if (current.length === 1) return current;

        return current.filter(
          (item) => item !== group
        );
      }

      return [...current, group];
    });
  };

  const activeSeries = trendSeries.filter((series) =>
    activeGroups.includes(series.group)
  );

  if (!data.length) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu
      </div>
    );
  }

  const allValues = activeSeries.flatMap((series) =>
    data
      .map((row) => row[series.key])
      .filter(
        (value): value is number =>
          value != null &&
          typeof value === "number" &&
          !Number.isNaN(value)
      )
  );

  const maxValue = Math.max(
    ...allValues,
    1
  );

  const chartHeight = 240;

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          {
            group: "Ticket",
            label: "Ticket",
            color: "#16A34A",
          },
          {
            group: "Traffic",
            label: "Traffic",
            color: "#2563EB",
          },
          {
            group: "Service",
            label: "Service",
            color: "#F59E0B",
          },
          {
            group: "CSAT",
            label: "CSAT",
            color: "#8B5CF6",
          },
        ].map((item) => {
          const active = activeGroups.includes(
            item.group
          );

          return (
            <button
              key={item.group}
              type="button"
              onClick={() =>
                toggleGroup(item.group)
              }
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-body text-xs font-semibold transition ${
                active
                  ? "border-line bg-paper text-ink"
                  : "border-line/60 bg-white text-ink/35"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: active
                    ? item.color
                    : "#D1D5DB",
                }}
              />

              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {activeSeries.map((series) => (
          <div
            key={series.key}
            className="flex items-center gap-2 text-xs text-ink/55"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{
                backgroundColor: series.color,
              }}
            />

            {series.label}
          </div>
        ))}
      </div>

      <div className="relative h-72">
        <div className="absolute inset-0">
          {[0, 25, 50, 75, 100].map(
            (percentage) => (
              <div
                key={percentage}
                className="absolute inset-x-0 border-t border-line/60"
                style={{
                  top: `${100 - percentage}%`,
                }}
              >
                <span className="absolute -left-1 top-1 -translate-x-full font-body text-[9px] text-ink/30">
                  {Math.round(
                    (maxValue * percentage) /
                      100
                  )}
                </span>
              </div>
            )
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 h-[240px] overflow-x-auto">
          <div
            className="flex h-full items-end gap-1 px-2"
            style={{
              minWidth: Math.max(
                data.length * 34,
                100
              ),
            }}
          >
            {data.map((row) => (
              <div
                key={row.date}
                className="group relative flex h-full min-w-[30px] flex-1 items-end justify-center"
              >
                <div
                  className="absolute bottom-0 left-1/2 h-full w-px -translate-x-1/2 opacity-0 transition group-hover:opacity-100"
                  style={{
                    backgroundColor:
                      "#E5E7EB",
                  }}
                />

                <div className="relative flex h-full w-full items-end justify-center gap-[2px]">
                  {activeSeries.map(
                    (series) => {
                      const value =
                        row[series.key];

                      if (
                        value == null ||
                        typeof value !==
                          "number"
                      ) {
                        return null;
                      }

                      const height =
                        Math.max(
                          3,
                          (value /
                            maxValue) *
                            chartHeight
                        );

                      return (
                        <div
                          key={
                            series.key
                          }
                          className="w-1.5 rounded-t transition-all duration-300 group-hover:opacity-90"
                          style={{
                            height: `${height}px`,
                            backgroundColor:
                              series.color,
                          }}
                          title={`${row.date} · ${series.label}: ${
                            series.key ===
                              "waiting" ||
                            series.key ===
                              "handling"
                              ? `${value.toFixed(
                                  1
                                )} phút`
                              : series.key ===
                                "csat"
                              ? `${value.toFixed(
                                  1
                                )}/5`
                              : value.toLocaleString(
                                  "vi-VN"
                                )
                          }`}
                        />
                      );
                    }
                  )}
                </div>

                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-body text-[9px] text-ink/35">
                  {row.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-xl bg-paper/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-ink/45">
          <span>
            <strong className="text-ink/65">
              Ticket:
            </strong>{" "}
            khối lượng yêu cầu
          </span>

          <span>
            <strong className="text-ink/65">
              Traffic:
            </strong>{" "}
            lượng khách/tài xế
          </span>

          <span>
            <strong className="text-ink/65">
              Service:
            </strong>{" "}
            thời gian phục vụ
          </span>

          <span>
            <strong className="text-ink/65">
              CSAT:
            </strong>{" "}
            mức độ hài lòng
          </span>
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

export default function SupervisorDashboardPage() {
  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [rows, setRows] = useState<QueueRow[]>(
    []
  );

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

    try {
      const today = startOfDay(
        new Date()
      );

      const todayStr =
        dateToString(today);

      const yesterdayStr =
        dateToString(
          addDays(today, -1)
        );

      const weekAgoStr =
        dateToString(
          addDays(today, -7)
        );

      const monthAgoStr =
        dateToString(
          getPreviousMonthSamePeriod(
            today
          )
        );

      const chartStart =
        dateToString(
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
          .from(
            "v_report_daily_summary"
          )
          .select("*")
          .eq(
            "business_date",
            todayStr
          ),

        supabase
          .from("v_report_feedback")
          .select(
            "rating, created_at"
          ),

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
          .from(
            "v_report_daily_summary"
          )
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
          .from(
            "v_report_daily_summary"
          )
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

      setRows(
        ((queueData as QueueRow[]) ??
          [])
      );

      setSummary(
        (
          (summaryData as DailySummary[]) ??
          []
        )[0] ?? null
      );

      const loadedFeedback =
        (feedbackData as FeedbackRow[]) ??
        [];

      setFeedback(
        loadedFeedback
      );

      setCounters(
        (counterData as Counter[]) ??
          []
      );

      setColleagues(
        (colleagueData as AgentOption[]) ??
          []
      );

      const summaries =
        (trendData as DailySummary[]) ??
        [];

      const chartSummaries =
        (chartSummaryData as DailySummary[]) ??
        [];

      const getDateSummary = (
        date: string
      ) =>
        summaries.filter(
          (row) =>
            row.business_date ===
            date
        );

      const todaySummary =
        aggregateSummaries(
          getDateSummary(
            todayStr
          )
        );

      const yesterdaySummary =
        aggregateSummaries(
          getDateSummary(
            yesterdayStr
          )
        );

      const weekSummary =
        aggregateSummaries(
          getDateSummary(
            weekAgoStr
          )
        );

      const monthSummary =
        aggregateSummaries(
          getDateSummary(
            monthAgoStr
          )
        );

      const feedbackByDate = (
        start: string,
        end: string
      ) =>
        loadedFeedback.filter(
          (item) => {
            if (!item.created_at)
              return false;

            const date =
              item.created_at.slice(
                0,
                10
              );

            return (
              date >= start &&
              date <= end
            );
          }
        );

      const getCsat = (
        items: FeedbackRow[]
      ) =>
        items.length
          ? items.reduce(
              (
                sum,
                item
              ) =>
                sum +
                Number(
                  item.rating || 0
                ),
              0
            ) / items.length
          : null;

      const todayCsat =
        getCsat(
          feedbackByDate(
            todayStr,
            todayStr
          )
        );

      const yesterdayCsat =
        getCsat(
          feedbackByDate(
            yesterdayStr,
            yesterdayStr
          )
        );

      const weekCsat =
        getCsat(
          feedbackByDate(
            weekAgoStr,
            weekAgoStr
          )
        );

      const monthCsat =
        getCsat(
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

        uniqueDrivers:
          buildTrend(
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

      /* =====================================================
         BUILD 30-DAY CHART
      ===================================================== */

      const groupedChart =
        new Map<
          string,
          ChartRow
        >();

      chartSummaries.forEach(
        (row) => {
          const date =
            row.business_date;

          const existing =
            groupedChart.get(
              date
            );

          if (existing) {
            existing.tickets +=
              Number(
                row.total_tickets ||
                  0
              );

            existing.completed +=
              Number(
                row.completed_tickets ||
                  0
              );

            existing.visits +=
              Number(
                row.total_visits ||
                  0
              );

            existing.uniqueDrivers +=
              Number(
                row.unique_drivers ||
                  0
              );

            if (
              row.avg_waiting_time_min !=
              null
            ) {
              existing.waiting =
                Number(
                  row.avg_waiting_time_min
                );
            }

            if (
              row.avg_handling_time_min !=
              null
            ) {
              existing.handling =
                Number(
                  row.avg_handling_time_min
                );
            }
          } else {
            groupedChart.set(
              date,
              {
                date,

                tickets:
                  Number(
                    row.total_tickets ||
                      0
                  ),

                completed:
                  Number(
                    row.completed_tickets ||
                      0
                  ),

                visits:
                  Number(
                    row.total_visits ||
                      0
                  ),

                uniqueDrivers:
                  Number(
                    row.unique_drivers ||
                      0
                  ),

                waiting:
                  row.avg_waiting_time_min !=
                  null
                    ? Number(
                        row.avg_waiting_time_min
                      )
                    : null,

                handling:
                  row.avg_handling_time_min !=
                  null
                    ? Number(
                        row.avg_handling_time_min
                      )
                    : null,

                csat: null,
              }
            );
          }
        }
      );

      /* =====================================================
         ADD CSAT BY DATE
      ===================================================== */

      const chartFeedback =
        loadedFeedback.filter(
          (item) => {
            if (!item.created_at)
              return false;

            const date =
              item.created_at.slice(
                0,
                10
              );

            return (
              date >= chartStart &&
              date <= todayStr
            );
          }
        );

      const feedbackMap =
        new Map<
          string,
          number[]
        >();

      chartFeedback.forEach(
        (item) => {
          if (!item.created_at)
            return;

          const date =
            item.created_at.slice(
              0,
              10
            );

          const current =
            feedbackMap.get(
              date
            ) ?? [];

          current.push(
            Number(
              item.rating || 0
            )
          );

          feedbackMap.set(
            date,
            current
          );
        }
      );

      feedbackMap.forEach(
        (ratings, date) => {
          const row =
            groupedChart.get(
              date
            );

          if (!row) return;

          row.csat =
            ratings.reduce(
              (
                sum,
                rating
              ) =>
                sum + rating,
              0
            ) /
            ratings.length;
        }
      );

      setChartData(
        Array.from(
          groupedChart.values()
        ).sort((a, b) =>
          a.date.localeCompare(
            b.date
          )
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getCurrentProfile().then(
      setProfile
    );

    load();
  }, [load]);

  useEffect(() => {
    const channel =
      supabase
        .channel(
          "supervisor-dashboard"
        )

        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "queue_tickets",
          },
          load
        )

        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "service_cases",
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
      supabase.removeChannel(
        channel
      );
    };
  }, [load]);

  async function handleToggleCounter(
    counter: Counter
  ) {
    const next =
      counter.status ===
      "AVAILABLE"
        ? "CLOSED"
        : "AVAILABLE";

    await supabase.rpc(
      "set_counter_status",
      {
        p_counter_id:
          counter.id,
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
        p_to_agent_id:
          toAgentId,
      }
    );

    setReassignOpenFor(
      null
    );

    load();
  }

  const filtered = useMemo(() => {
    return rows.filter(
      (r) => {
        return (
          (!categoryFilter ||
            r.category_name ===
              categoryFilter) &&
          (!statusFilter ||
            r.status ===
              statusFilter) &&
          (!agentFilter ||
            r.agent_name ===
              agentFilter)
        );
      }
    );
  }, [
    rows,
    categoryFilter,
    statusFilter,
    agentFilter,
  ]);

  /*
   * IMPORTANT:
   * Dùng type guard để TypeScript hiểu
   * category và agent chắc chắn là string.
   */
  const categories = Array.from(
    new Set(
      rows
        .map((r) => r.category_name)
        .filter(
          (category): category is string =>
            typeof category === "string" &&
            category.length > 0
        )
    )
  );

  const agents = Array.from(
    new Set(
      rows
        .map((r) => r.agent_name)
        .filter(
          (agent): agent is string =>
            typeof agent === "string" &&
            agent.length > 0
        )
    )
  );

  const waiting =
    rows.filter(
      (r) =>
        r.status ===
        "WAITING"
    ).length;

  const processing =
    rows.filter(
      (r) =>
        r.status ===
        "PROCESSING"
    ).length;

  const pending =
    rows.filter(
      (r) =>
        r.status ===
        "PENDING"
    ).length;

  const overSla =
    rows.filter(
      (r) =>
        r.sla_due_at &&
        new Date(
          r.sla_due_at
        ).getTime() <
          Date.now() &&
        !r.resolved_at &&
        !r.closed_at &&
        r.status !==
          "PENDING"
    ).length;

  const completed =
    rows.filter(
      (r) =>
        [
          "RESOLVED",
          "CLOSED",
        ].includes(
          r.status
        )
    ).length;

  const avgCsat =
    feedback.length > 0
      ? (
          feedback.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.rating ||
                  0
              ),
            0
          ) /
          feedback.length
        ).toFixed(1)
      : "—";

  const dod =
    trendMetrics.dod;

  const wow =
    trendMetrics.wow;

  const mom =
    trendMetrics.mom;

  return (
    <div className="space-y-8">
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Dashboard{" "}
          {profile?.role ===
          "admin"
            ? "(toàn hệ thống)"
            : ""}
        </h1>

        <p className="mt-1 font-body text-sm text-ink/50">
          Theo dõi vận hành,
          hiệu suất và xu
          hướng trung tâm
          dịch vụ.
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
              summary?.total_visits ??
              0
            }
          />

          <StatCard
            label="Unique Drivers"
            value={
              summary?.unique_drivers ??
              0
            }
          />

          <StatCard
            label="Total Tickets"
            value={
              summary?.total_tickets ??
              0
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
              summary.total_tickets >
                0
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
            Diễn biến 30 ngày
            gần nhất · gom
            các chỉ số vào
            một biểu đồ
          </p>
        </div>

        <div className="rounded-card border border-line bg-white p-5">
          <ChartHeader
            title="Service Center Trend"
            description="Theo dõi đồng thời Ticket, Traffic, Service Performance và CSAT"
          />

          <TrendChart
            data={chartData}
          />
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
            So sánh hiệu suất
            hôm nay với các
            mốc tham chiếu
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
          {counters.map(
            (counter) => (
              <div
                key={
                  counter.id
                }
                className="flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3"
              >
                <span className="font-body text-sm font-semibold text-ink">
                  {
                    counter.counter_name
                  }
                </span>

                <StatusCounterBadge
                  status={
                    counter.status
                  }
                />

                {(counter.status ===
                  "AVAILABLE" ||
                  counter.status ===
                    "CLOSED") && (
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
            )
          )}
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
              {filtered.length}{" "}
              ticket
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={
                agentFilter
              }
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
                    key={
                      agent
                    }
                    value={
                      agent
                    }
                  >
                    {agent}
                  </option>
                )
              )}
            </select>

            <select
              value={
                categoryFilter
              }
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
                    key={
                      category
                    }
                    value={
                      category
                    }
                  >
                    {category}
                  </option>
                )
              )}
            </select>

            <select
              value={
                statusFilter
              }
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
                        Không có
                        ticket
                        phù hợp.
                      </td>
                    </tr>
                  )}

                {!loading &&
                  filtered.map(
                    (r) => (
                      <tr
                        key={
                          r.ticket_id
                        }
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-4 py-3 font-display font-bold text-brand-900">
                          {
                            r.queue_number
                          }
                        </td>

                        <td className="px-4 py-3">
                          {
                            r.driver_name
                          }
                        </td>

                        <td className="px-4 py-3">
                          {r.agent_name ||
                            "—"}
                        </td>

                        <td className="px-4 py-3">
                          {
                            r.category_name
                          }
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
                              onChange={(
                                e
                              ) =>
                                e
                                  .target
                                  .value &&
                                handleReassign(
                                  r.case_id,
                                  e
                                    .target
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
                                -- Chọn
                                agent
                                --
                              </option>

                              {colleagues.map(
                                (
                                  agent
                                ) => (
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
                    )
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
