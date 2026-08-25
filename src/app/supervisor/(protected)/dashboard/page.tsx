
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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

/* =========================================================
   TYPES
========================================================= */

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

type CheckinRow = {
  checkin_at: string;
};

type CheckinByHour = {
  label: string;
  count: number;
};

type CheckinByDay = {
  date: string;
  label: string;
  count: number;
};

type CategoryTrendPoint = {
  business_date: string;
  category: string;
  visit_count: number;
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

type QueueRow = AgentQueueRow & {
  agent_name?: string | null;
};

/* =========================================================
   DATE / TIME HELPERS
========================================================= */

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

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

  const day = Math.min(
    currentDay,
    previousMonthLastDay
  );

  return new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    day
  );
}

/*
 * Supabase trả timestamptz theo ISO.
 * Không dùng getHours()/slice(0,10) trực tiếp vì
 * có thể bị lệch ngày/giờ theo timezone browser/UTC.
 */
function getVietnamParts(value: string) {
  const formatter = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: VN_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  );

  const parts = formatter.formatToParts(
    new Date(value)
  );

  const map: Record<string, string> = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  });

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function getVietnamDate(value: string) {
  const parts = getVietnamParts(value);

  return `${parts.year}-${String(
    parts.month
  ).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

function getVietnamMinutes(value: string) {
  const parts = getVietnamParts(value);

  return (
    parts.hour * 60 +
    parts.minute
  );
}

/*
 * Tạo ISO có timezone VN để query timestamptz.
 */
function vietnamStartIso(date: string) {
  return `${date}T00:00:00+07:00`;
}

function vietnamEndIso(date: string) {
  return `${date}T23:59:59.999+07:00`;
}

/* =========================================================
   TREND HELPERS
========================================================= */

function percentChange(
  current: number | null,
  previous: number | null
): number | null {
  if (
    current == null ||
    previous == null
  ) {
    return null;
  }

  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }

  return (
    ((current - previous) /
      Math.abs(previous)) *
    100
  );
}

function buildTrend(
  current: number | null,
  previous: number | null
): TrendValue {
  return {
    current: current ?? 0,
    previous: previous ?? 0,
    change: percentChange(
      current,
      previous
    ),
  };
}

function average(
  values: Array<number | null>
) {
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
      (sum, value) =>
        sum + value,
      0
    ) / valid.length
  );
}

function aggregateSummaries(
  summaries: DailySummary[]
): PeriodSummary {
  const tickets =
    summaries.reduce(
      (sum, row) =>
        sum +
        Number(
          row.total_tickets || 0
        ),
      0
    );

  const completed =
    summaries.reduce(
      (sum, row) =>
        sum +
        Number(
          row.completed_tickets || 0
        ),
      0
    );

  const visits =
    summaries.reduce(
      (sum, row) =>
        sum +
        Number(
          row.total_visits || 0
        ),
      0
    );

  const uniqueDrivers =
    summaries.reduce(
      (sum, row) =>
        sum +
        Number(
          row.unique_drivers || 0
        ),
      0
    );

  return {
    tickets,
    completed,
    visits,
    uniqueDrivers,
    waiting: average(
      summaries.map(
        (row) =>
          row.avg_waiting_time_min
      )
    ),
    handling: average(
      summaries.map(
        (row) =>
          row.avg_handling_time_min
      )
    ),
    csat: null,
  };
}

function formatChange(
  change: number | null
) {
  if (change == null) {
    return "—";
  }

  if (change > 0) {
    return `+${change.toFixed(1)}%`;
  }

  if (change < 0) {
    return `${change.toFixed(1)}%`;
  }

  return "0.0%";
}

function trendColor(
  change: number | null,
  inverse = false
) {
  if (
    change == null ||
    change === 0
  ) {
    return "text-ink/45";
  }

  const positive = inverse
    ? change < 0
    : change > 0;

  return positive
    ? "text-brand-700"
    : "text-danger";
}

function trendArrow(
  change: number | null
) {
  if (
    change == null ||
    change === 0
  ) {
    return "→";
  }

  return change > 0
    ? "↑"
    : "↓";
}

/* =========================================================
   BENCHMARK
========================================================= */

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
        {value.current.toFixed(
          decimals
        )}
      </div>

      <div className="mt-0.5 font-body text-[11px] text-ink/40">
        Trước:{" "}
        {value.previous.toFixed(
          decimals
        )}
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
          value={
            metrics.uniqueDrivers
          }
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
   CHECK-IN HOURLY CHART
========================================================= */

function CheckinHourlyChart({
  data,
}: {
  data: CheckinByHour[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu check-in
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.map(
      (item) => item.count
    ),
    1
  );

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div>
      <div className="relative h-[310px]">
        {/* Y AXIS / GRID */}
        <div className="absolute inset-x-0 top-0 bottom-12">
          {yTicks.map(
            (percentage) => {
              const value = Math.round(
                (maxValue *
                  percentage) /
                  100
              );

              return (
                <div
                  key={
                    percentage
                  }
                  className="absolute inset-x-0 border-t border-line/70"
                  style={{
                    top: `${
                      100 -
                      percentage
                    }%`,
                  }}
                >
                  <span className="absolute -left-1 top-1 -translate-x-full font-body text-[11px] font-semibold text-ink/45">
                    {value.toLocaleString(
                      "vi-VN"
                    )}
                  </span>
                </div>
              );
            }
          )}
        </div>

        {/* BARS */}
        <div className="absolute inset-x-0 bottom-12 top-0 flex items-end gap-2 px-2">
          {data.map(
            (item) => {
              const height =
                item.count > 0
                  ? Math.max(
                      5,
                      (item.count /
                        maxValue) *
                        100
                    )
                  : 0;

              return (
                <div
                  key={
                    item.label
                  }
                  className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                >
                  <div className="relative flex h-full w-full items-end justify-center">
                    {item.count >
                      0 && (
                      <span className="absolute bottom-[calc(var(--bar-height)+7px)] z-10 font-display text-sm font-bold text-brand-900">
                        {item.count.toLocaleString(
                          "vi-VN"
                        )}
                      </span>
                    )}

                    <div
                      className="w-full max-w-[44px] rounded-t-lg bg-brand-700 transition-all duration-300 group-hover:bg-brand-900"
                      style={
                        {
                          height: `${height}%`,
                          "--bar-height": `${height}%`,
                        } as React.CSSProperties
                      }
                      title={`${item.label}: ${item.count.toLocaleString(
                        "vi-VN"
                      )} check-in`}
                    />
                  </div>

                  <span className="mt-2 whitespace-nowrap text-center font-body text-[11px] font-semibold text-ink/55">
                    {item.label}
                  </span>
                </div>
              );
            }
          )}
        </div>
      </div>

      <div className="mt-2 text-center font-body text-xs text-ink/40">
        Check-in trong giờ hoạt động
        08:30 – 17:30 · Hôm nay
      </div>
    </div>
  );
}

/* =========================================================
   CHECK-IN DAILY LINE CHART
========================================================= */

function CheckinDailyChart({
  data,
}: {
  data: CheckinByDay[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-[310px] items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu check-in
      </div>
    );
  }

  const width = 1000;
  const height = 320;

  const paddingLeft = 52;
  const paddingRight = 20;
  const paddingTop = 38;
  const paddingBottom = 55;

  const chartWidth =
    width -
    paddingLeft -
    paddingRight;

  const chartHeight =
    height -
    paddingTop -
    paddingBottom;

  const maxValue = Math.max(
    ...data.map(
      (item) => item.count
    ),
    1
  );

  const points = data.map(
    (item, index) => {
      const x =
        data.length === 1
          ? paddingLeft +
            chartWidth / 2
          : paddingLeft +
            (index /
              (data.length - 1)) *
              chartWidth;

      const y =
        paddingTop +
        chartHeight -
        (item.count /
          maxValue) *
          chartHeight;

      return {
        ...item,
        x,
        y,
      };
    }
  );

  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${
          point.x
        } ${point.y}`
    )
    .join(" ");

  const areaPath = `${path} L ${
    points[points.length - 1].x
  } ${
    paddingTop +
    chartHeight
  } L ${
    points[0].x
  } ${
    paddingTop +
    chartHeight
  } Z`;

  const yTicks = [
    0, 25, 50, 75, 100,
  ];

  return (
    <div className="w-full">
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-[310px] w-full overflow-visible"
        >
          {/* GRID */}
          {yTicks.map(
            (percentage) => {
              const y =
                paddingTop +
                chartHeight -
                (percentage /
                  100) *
                  chartHeight;

              const value =
                Math.round(
                  (maxValue *
                    percentage) /
                    100
                );

              return (
                <g
                  key={
                    percentage
                  }
                >
                  <line
                    x1={
                      paddingLeft
                    }
                    x2={
                      width -
                      paddingRight
                    }
                    y1={y}
                    y2={y}
                    stroke="#E5E7EB"
                    strokeWidth="1"
                  />

                  <text
                    x={
                      paddingLeft -
                      10
                    }
                    y={y + 5}
                    textAnchor="end"
                    className="fill-ink/40"
                    fontSize="12"
                    fontWeight="600"
                  >
                    {value.toLocaleString(
                      "vi-VN"
                    )}
                  </text>
                </g>
              );
            }
          )}

          {/* AREA */}
          <path
            d={areaPath}
            fill="rgba(22, 163, 74, 0.08)"
            stroke="none"
          />

          {/* LINE */}
          <path
            d={path}
            fill="none"
            stroke="#16A34A"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* POINTS + LABELS */}
          {points.map(
            (point, index) => {
              const showDate =
                index === 0 ||
                index ===
                  points.length -
                    1 ||
                index % 3 ===
                  0;

              const showValue =
                point.count > 0;

              return (
                <g
                  key={
                    point.date
                  }
                >
                  {/* HIT AREA */}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="14"
                    fill="transparent"
                  />

                  {/* POINT */}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="5"
                    fill="#FFFFFF"
                    stroke="#16A34A"
                    strokeWidth="3"
                  />

                  {/* VALUE */}
                  {showValue && (
                    <text
                      x={
                        point.x
                      }
                      y={
                        point.y -
                        13
                      }
                      textAnchor="middle"
                      className="fill-brand-900"
                      fontSize="13"
                      fontWeight="800"
                    >
                      {point.count}
                    </text>
                  )}

                  {/* DATE */}
                  {showDate && (
                    <text
                      x={
                        point.x
                      }
                      y={
                        height -
                        19
                      }
                      textAnchor="middle"
                      className="fill-ink/55"
                      fontSize="12"
                      fontWeight="700"
                    >
                      {
                        point.label
                      }
                    </text>
                  )}
                </g>
              );
            }
          )}
        </svg>
      </div>

      <div className="mt-1 text-center font-body text-xs text-ink/40">
        Số lượng check-in trong 30 ngày
        gần nhất
      </div>
    </div>
  );
}

/* =========================================================
   CATEGORY TREND (7 NGÀY) — cột chồng, mỗi màu 1 category.
   Số trên đầu mỗi cột là tổng ngày đó (đã có Total Visits/DoD
   ở nơi khác, nên ở đây không lặp lại thẻ tổng riêng).
========================================================= */

const CATEGORY_TREND_COLORS = [
  "bg-brand-700",
  "bg-accent-500",
  "bg-brand-500",
  "bg-warn",
  "bg-ink",
];

function CategoryTrendChart({
  data,
}: {
  data: CategoryTrendPoint[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-ink/40">
        Chưa có dữ liệu
      </div>
    );
  }

  const dates = Array.from(
    new Set(
      data.map((d) => d.business_date)
    )
  ).sort();

  const totalsByCategory = new Map<
    string,
    number
  >();

  data.forEach((d) => {
    totalsByCategory.set(
      d.category,
      (totalsByCategory.get(d.category) ?? 0) +
        d.visit_count
    );
  });

  // Top 5 category theo tổng lượt 7 ngày. Hiện tại hệ thống có đúng 5
  // category nên chưa cần gộp "Khác" — nếu sau này thêm category thứ 6
  // trở lên, phần vượt quá sẽ không hiện trên chart (cần bổ sung logic
  // gộp "Khác" khi đó).
  const categories = Array.from(
    totalsByCategory.entries()
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  const dailyTotals = dates.map((date) =>
    data
      .filter((d) => d.business_date === date)
      .reduce((sum, d) => sum + d.visit_count, 0)
  );

  const maxTotal = Math.max(
    ...dailyTotals,
    1
  );

  const barMaxHeight = 140;

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap gap-3">
        {categories.map((cat, i) => (
          <span
            key={cat}
            className="flex items-center gap-1.5 font-body text-xs text-ink/60"
          >
            <span
              className={`h-2.5 w-2.5 rounded-sm ${CATEGORY_TREND_COLORS[i % CATEGORY_TREND_COLORS.length]}`}
            />
            {cat}
          </span>
        ))}
      </div>

      <div
        className="flex items-end justify-between gap-2"
        style={{
          height: barMaxHeight + 40,
        }}
      >
        {dates.map((date, dateIndex) => {
          const dayRows = data.filter(
            (d) => d.business_date === date
          );

          const [year, month, day] =
            date.split("-");

          return (
            <div
              key={date}
              className="flex flex-1 flex-col items-center gap-1.5"
            >
              <span className="font-body text-[11px] font-semibold text-ink/60">
                {dailyTotals[dateIndex]}
              </span>

              <div
                className="flex w-full max-w-[36px] flex-col-reverse overflow-hidden rounded-t"
                style={{
                  height: barMaxHeight,
                }}
              >
                {categories.map((cat, i) => {
                  const value =
                    dayRows.find(
                      (d) => d.category === cat
                    )?.visit_count ?? 0;

                  const segHeight =
                    (value / maxTotal) *
                    barMaxHeight;

                  return value > 0 ? (
                    <div
                      key={cat}
                      className={
                        CATEGORY_TREND_COLORS[
                          i %
                            CATEGORY_TREND_COLORS.length
                        ]
                      }
                      style={{
                        height: segHeight,
                      }}
                      title={`${cat}: ${value}`}
                    />
                  ) : null;
                })}
              </div>

              <span className="font-body text-[11px] text-ink/40">
                {day}/{month}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================
   TAB BUTTON — dùng chung cho Check-in Trend và Benchmark
========================================================= */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border-2 px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
        active
          ? "border-brand-700 bg-brand-700 text-white"
          : "border-line bg-white text-ink/60 hover:border-brand-500"
      }`}
    >
      {children}
    </button>
  );
}

/* =========================================================
   COUNTER STATUS
========================================================= */

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

/* =========================================================
   PAGE
========================================================= */

export default function SupervisorDashboardPage() {
  const [
    profile,
    setProfile,
  ] = useState<Profile | null>(
    null
  );

  const [
    rows,
    setRows,
  ] = useState<QueueRow[]>([]);

  const [
    summary,
    setSummary,
  ] = useState<DailySummary | null>(
    null
  );

  const [
    feedback,
    setFeedback,
  ] = useState<FeedbackRow[]>(
    []
  );

  const [
    counters,
    setCounters,
  ] = useState<Counter[]>([]);

  const [
    colleagues,
    setColleagues,
  ] = useState<AgentOption[]>(
    []
  );

  const [
    trendMetrics,
    setTrendMetrics,
  ] = useState<{
    dod: TrendMetrics | null;
    wow: TrendMetrics | null;
    mom: TrendMetrics | null;
  }>({
    dod: null,
    wow: null,
    mom: null,
  });

  const [
    checkinHourly,
    setCheckinHourly,
  ] = useState<CheckinByHour[]>(
    []
  );

  const [
    checkinDaily,
    setCheckinDaily,
  ] = useState<CheckinByDay[]>(
    []
  );

  const [
    categoryTrend,
    setCategoryTrend,
  ] = useState<CategoryTrendPoint[]>(
    []
  );

  const [
    trendTab,
    setTrendTab,
  ] = useState<
    "hour" | "day" | "category"
  >("hour");

  const [
    benchmarkTab,
    setBenchmarkTab,
  ] = useState<
    "dod" | "wow" | "mom"
  >("dod");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("");

  const [
    agentFilter,
    setAgentFilter,
  ] = useState("");

  const [
    reassignOpenFor,
    setReassignOpenFor,
  ] = useState<string | null>(
    null
  );

  /* =======================================================
     LOAD DATA
  ======================================================= */

  const load = useCallback(
    async () => {
      setLoading(true);

      try {
        const today =
          startOfDay(new Date());

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

        const sevenDaysAgoStr =
          dateToString(
            addDays(today, -6)
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

        const tomorrowStr =
          dateToString(
            addDays(today, 1)
          );

        /*
         * QUAN TRỌNG:
         * Check-in lấy từ visits.checkin_at.
         *
         * Không lấy queue_tickets.created_at.
         */
        const checkinStartIso =
          vietnamStartIso(
            chartStart
          );

        const checkinEndIso =
          vietnamStartIso(
            tomorrowStr
          );

        const [
          {
            data: queueData,
          },
          {
            data: summaryData,
          },
          {
            data: feedbackData,
          },
          {
            data: counterData,
          },
          {
            data: colleagueData,
          },
          {
            data: trendData,
          },
          {
            data: categoryTrendData,
          },
          {
            data: checkinData,
          },
        ] = await Promise.all([
          /* QUEUE */
          supabase
            .from(
              "v_agent_queue"
            )
            .select("*")
            .order(
              "created_at",
              {
                ascending: true,
              }
            ),

          /* TODAY SUMMARY */
          supabase
            .from(
              "v_report_daily_summary"
            )
            .select("*")
            .eq(
              "business_date",
              todayStr
            ),

          /* FEEDBACK */
          supabase
            .from(
              "v_report_feedback"
            )
            .select(
              "rating, created_at"
            ),

          /* COUNTERS */
          supabase
            .from("counters")
            .select(
              "id, counter_code, counter_name, status, branch_id"
            ),

          /* AGENTS */
          supabase
            .from("profiles")
            .select(
              "id, full_name, email, role"
            )
            .eq(
              "role",
              "agent"
            ),

          /* TREND */
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
            .order(
              "business_date",
              {
                ascending: true,
              }
            ),

          /* CATEGORY TREND — 7 ngày gần nhất */
          supabase
            .from(
              "v_report_category_trend"
            )
            .select(
              "business_date, category, visit_count"
            )
            .gte(
              "business_date",
              sevenDaysAgoStr
            )
            .lte(
              "business_date",
              todayStr
            )
            .order(
              "business_date",
              {
                ascending: true,
              }
            ),

          /*
           * CHECK-IN TREND
           *
           * visits.checkin_at là thời điểm
           * tài xế thực sự check-in.
           */
          supabase
            .from("visits")
            .select(
              "checkin_at"
            )
            .gte(
              "checkin_at",
              checkinStartIso
            )
            .lt(
              "checkin_at",
              checkinEndIso
            )
            .order(
              "checkin_at",
              {
                ascending: true,
              }
            ),
        ]);

        /* ===================================================
           BASIC DATA
        =================================================== */

        setRows(
          (queueData as QueueRow[]) ??
            []
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

        /* ===================================================
           BENCHMARK
        =================================================== */

        const summaries =
          (trendData as DailySummary[]) ??
          [];

        const todaySummary =
          aggregateSummaries(
            summaries.filter(
              (row) =>
                row.business_date ===
                todayStr
            )
          );

        const yesterdaySummary =
          aggregateSummaries(
            summaries.filter(
              (row) =>
                row.business_date ===
                yesterdayStr
            )
          );

        const weekSummary =
          aggregateSummaries(
            summaries.filter(
              (row) =>
                row.business_date ===
                weekAgoStr
            )
          );

        const monthSummary =
          aggregateSummaries(
            summaries.filter(
              (row) =>
                row.business_date ===
                monthAgoStr
            )
          );

        const feedbackByDate = (
          start: string,
          end: string
        ) =>
          loadedFeedback.filter(
            (item) => {
              if (
                !item.created_at
              ) {
                return false;
              }

              const date =
                getVietnamDate(
                  item.created_at
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
                    item.rating ||
                      0
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
          tickets:
            buildTrend(
              todaySummary.tickets,
              previous.tickets
            ),

          completed:
            buildTrend(
              todaySummary.completed,
              previous.completed
            ),

          visits:
            buildTrend(
              todaySummary.visits,
              previous.visits
            ),

          uniqueDrivers:
            buildTrend(
              todaySummary.uniqueDrivers,
              previous.uniqueDrivers
            ),

          waiting:
            buildTrend(
              todaySummary.waiting,
              previous.waiting
            ),

          handling:
            buildTrend(
              todaySummary.handling,
              previous.handling
            ),

          csat:
            buildTrend(
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

        /* ===================================================
           CHECK-IN DATA
        =================================================== */

        const checkins =
          (checkinData as CheckinRow[]) ??
          [];

        /* ===================================================
           1. CHECK-IN THEO KHUNG GIỜ
           HÔM NAY
        =================================================== */

        const hourlyDefinitions = [
          {
            start: 8 * 60 + 30,
            end: 9 * 60,
            label: "08:30–09:00",
          },
          {
            start: 9 * 60,
            end: 10 * 60,
            label: "09:00–10:00",
          },
          {
            start: 10 * 60,
            end: 11 * 60,
            label: "10:00–11:00",
          },
          {
            start: 11 * 60,
            end: 12 * 60,
            label: "11:00–12:00",
          },
          {
            start: 12 * 60,
            end: 13 * 60,
            label: "12:00–13:00",
          },
          {
            start: 13 * 60,
            end: 14 * 60,
            label: "13:00–14:00",
          },
          {
            start: 14 * 60,
            end: 15 * 60,
            label: "14:00–15:00",
          },
          {
            start: 15 * 60,
            end: 16 * 60,
            label: "15:00–16:00",
          },
          {
            start: 16 * 60,
            end: 17 * 60,
            label: "16:00–17:00",
          },
          {
            start: 17 * 60,
            end: 17 * 60 + 30,
            label: "17:00–17:30",
          },
        ];

        const hourlyBuckets =
          hourlyDefinitions.map(
            (bucket) => {
              const count =
                checkins.filter(
                  (item) => {
                    /*
                     * Chỉ tính check-in của hôm nay.
                     */
                    const date =
                      getVietnamDate(
                        item.checkin_at
                      );

                    if (
                      date !==
                      todayStr
                    ) {
                      return false;
                    }

                    const minutes =
                      getVietnamMinutes(
                        item.checkin_at
                      );

                    return (
                      minutes >=
                        bucket.start &&
                      minutes <
                        bucket.end
                    );
                  }
                ).length;

              return {
                label:
                  bucket.label,
                count,
              };
            }
          );

        setCheckinHourly(
          hourlyBuckets
        );

        /* ===================================================
           2. CHECK-IN THEO NGÀY
           30 NGÀY
        =================================================== */

        const dailyMap =
          new Map<
            string,
            number
          >();

        /*
         * Luôn tạo đủ 30 ngày.
         */
        for (
          let i = 0;
          i < 30;
          i++
        ) {
          const date =
            dateToString(
              addDays(
                today,
                -29 + i
              )
            );

          dailyMap.set(
            date,
            0
          );
        }

        /*
         * Gom check-in theo ngày VN.
         */
        checkins.forEach(
          (item) => {
            const date =
              getVietnamDate(
                item.checkin_at
              );

            if (
              dailyMap.has(
                date
              )
            ) {
              dailyMap.set(
                date,
                (
                  dailyMap.get(
                    date
                  ) ?? 0
                ) + 1
              );
            }
          }
        );

        const dailyChart =
          Array.from(
            dailyMap.entries()
          ).map(
            ([date, count]) => {
              const [
                year,
                month,
                day,
              ] =
                date.split(
                  "-"
                );

              return {
                date,
                label: `${day}/${month}`,
                count,
              };
            }
          );

        setCheckinDaily(
          dailyChart
        );

        setCategoryTrend(
          (categoryTrendData as CategoryTrendPoint[]) ??
            []
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    getCurrentProfile().then(
      setProfile
    );

    load();
  }, [load]);

  /* =======================================================
     REALTIME
  ======================================================= */

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
              "visits",
          },
          load
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
            table:
              "counters",
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

  /* =======================================================
     COUNTER
  ======================================================= */

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

  /* =======================================================
     REASSIGN
  ======================================================= */

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

  /* =======================================================
     FILTER
  ======================================================= */

  const filtered = useMemo(
    () => {
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
    },
    [
      rows,
      categoryFilter,
      statusFilter,
      agentFilter,
    ]
  );

  const categories =
    Array.from(
      new Set(
        rows
          .map(
            (r) =>
              r.category_name
          )
          .filter(
            (
              category
            ): category is string =>
              typeof category ===
                "string" &&
              category.length >
                0
          )
      )
    );

  const agents =
    Array.from(
      new Set(
        rows
          .map(
            (r) =>
              r.agent_name
          )
          .filter(
            (
              agent
            ): agent is string =>
              typeof agent ===
                "string" &&
              agent.length >
                0
          )
      )
    );

  /* =======================================================
     LIVE QUEUE KPI
  ======================================================= */

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

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="space-y-8">
      {/* ===================================================
          HEADER
      =================================================== */}

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

      {/* ===================================================
          TỔNG QUAN HÔM NAY
      =================================================== */}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
            Tổng quan hôm nay
          </p>

          <span className="font-body text-xs text-ink/40">
            Real-time
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            value={
              summary?.completed_tickets ??
              0
            }
          />

          <StatCard
            label="Waiting"
            value={
              waiting
            }
          />

          <StatCard
            label="Processing"
            value={
              processing
            }
          />

          <StatCard
            label="Pending"
            value={
              pending
            }
            tone="warn"
          />

          <StatCard
            label="Over SLA"
            value={
              overSla
            }
            tone="danger"
          />

          <StatCard
            label="Avg Waiting Time"
            value={
              summary?.avg_waiting_time_min !=
              null
                ? `${Number(
                    summary.avg_waiting_time_min
                  ).toFixed(
                    1
                  )}p`
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
                  ).toFixed(
                    1
                  )}p`
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
                    (summary.completed_tickets /
                      summary.total_tickets) *
                      100
                  )}%`
                : "—"
            }
          />

          <StatCard
            label="CSAT"
            value={
              avgCsat
            }
          />
        </div>
      </section>

      {/* ===================================================
          CHECK-IN TREND
      =================================================== */}

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
              Check-in Trend
            </p>

            <p className="mt-1 font-body text-xs text-ink/40">
              {trendTab === "hour"
                ? "Hôm nay · 08:30 – 17:30"
                : trendTab === "day"
                ? "Biến động số lượng check-in trong 30 ngày gần nhất."
                : "Visit theo category · 7 ngày gần nhất."}
            </p>
          </div>

          <div className="flex gap-2">
            <TabButton
              active={trendTab === "hour"}
              onClick={() => setTrendTab("hour")}
            >
              Theo giờ
            </TabButton>

            <TabButton
              active={trendTab === "day"}
              onClick={() => setTrendTab("day")}
            >
              Theo ngày
            </TabButton>

            <TabButton
              active={trendTab === "category"}
              onClick={() => setTrendTab("category")}
            >
              Category
            </TabButton>
          </div>
        </div>

        <div className="min-w-0 rounded-card border border-line bg-white p-6">
          {trendTab === "hour" && (
            <CheckinHourlyChart
              data={checkinHourly}
            />
          )}

          {trendTab === "day" && (
            <CheckinDailyChart
              data={checkinDaily}
            />
          )}

          {trendTab === "category" && (
            <CategoryTrendChart
              data={categoryTrend}
            />
          )}
        </div>
      </section>

      {/* ===================================================
          BENCHMARK
      =================================================== */}

      <section className="rounded-card border border-line bg-white p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-body text-sm font-bold uppercase tracking-wide text-ink/50">
              Benchmark
            </p>

            <p className="mt-1 font-body text-xs text-ink/40">
              So sánh hiệu suất
              hôm nay với các
              mốc tham chiếu
            </p>
          </div>

          <div className="flex gap-2">
            <TabButton
              active={benchmarkTab === "dod"}
              onClick={() => setBenchmarkTab("dod")}
            >
              Hôm qua
            </TabButton>

            <TabButton
              active={benchmarkTab === "wow"}
              onClick={() => setBenchmarkTab("wow")}
            >
              Tuần trước
            </TabButton>

            <TabButton
              active={benchmarkTab === "mom"}
              onClick={() => setBenchmarkTab("mom")}
            >
              Tháng trước
            </TabButton>
          </div>
        </div>

        {benchmarkTab === "dod" &&
          (dod ? (
            <BenchmarkGroup
              title="DoD · So với hôm qua"
              metrics={dod}
            />
          ) : (
            <p className="font-body text-sm text-ink/40">
              Chưa có dữ liệu để so sánh.
            </p>
          ))}

        {benchmarkTab === "wow" &&
          (wow ? (
            <BenchmarkGroup
              title="WoW · So với cùng ngày tuần trước"
              metrics={wow}
            />
          ) : (
            <p className="font-body text-sm text-ink/40">
              Chưa có dữ liệu để so sánh.
            </p>
          ))}

        {benchmarkTab === "mom" &&
          (mom ? (
            <BenchmarkGroup
              title="MoM · So với cùng kỳ tháng trước"
              metrics={mom}
            />
          ) : (
            <p className="font-body text-sm text-ink/40">
              Chưa có dữ liệu để so sánh.
            </p>
          ))}
      </section>

      {/* ===================================================
          COUNTERS
      =================================================== */}

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

                {(
                  counter.status ===
                    "AVAILABLE" ||
                  counter.status ===
                    "CLOSED"
                ) && (
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

      {/* ===================================================
          TICKET LIST
      =================================================== */}

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
            {/* AGENT FILTER */}
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

            {/* CATEGORY FILTER */}
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

            {/* STATUS FILTER */}
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

