```tsx
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { PrimaryButton } from "@/components/agent/ui";

const RAW_VIEW = "v_report_raw";
const RAW_DATE_COLUMN = "check_in";
const RAW_FILE = "raw";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-01`;
}

/**
 * Timestamp export:
 *
 * MM/DD/YYYY HH:mm:ss
 *
 * Ví dụ:
 * 2026-08-19T14:00:18.006551+00:00
 * =>
 * 08/19/2026 21:00:18
 */
function formatDateTime(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (!value.includes("T")) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${pad(date.getMonth() + 1)}/` +
    `${pad(date.getDate())}/` +
    `${date.getFullYear()} ` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}:` +
    `${pad(date.getSeconds())}`
  );
}

function formatExportData(
  data: Record<string, unknown>[]
): Record<string, unknown>[] {
  return data.map((row) => {
    const formatted: Record<string, unknown> = {};

    Object.entries(row).forEach(([key, value]) => {
      formatted[key] = formatDateTime(value);
    });

    return formatted;
  });
}

export default function AdminExportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function applyPreset(
    preset: "today" | "month" | "year" | "all"
  ) {
    const now = new Date();

    switch (preset) {
      case "today":
        setFromDate(todayStr());
        setToDate(todayStr());
        break;

      case "month":
        setFromDate(firstOfMonthStr());
        setToDate(todayStr());
        break;

      case "year":
        setFromDate(`${now.getFullYear()}-01-01`);
        setToDate(todayStr());
        break;

      case "all":
        setFromDate("");
        setToDate("");
        break;
    }
  }

  async function handleExport() {
    setLoading(true);
    setErrorMessage(null);

    try {
      let query = supabase
        .from(RAW_VIEW)
        .select("*")
        .limit(50000);

      if (fromDate) {
        query = query.gte(
          RAW_DATE_COLUMN,
          fromDate
        );
      }

      if (toDate) {
        const toExclusive = new Date(
          `${toDate}T00:00:00`
        );

        toExclusive.setDate(
          toExclusive.getDate() + 1
        );

        query = query.lt(
          RAW_DATE_COLUMN,
          toExclusive.toISOString()
        );
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(error.message);
      }

      const rows =
        (data ?? []) as Record<string, unknown>[];

      if (rows.length === 0) {
        setErrorMessage(
          "Không có dữ liệu trong khoảng thời gian đã chọn."
        );
        return;
      }

      const exportRows =
        formatExportData(rows);

      const suffix =
        fromDate || toDate
          ? `_${fromDate || "start"}_${toDate || "end"}`
          : "_all";

      downloadCsv(
        `${RAW_FILE}${suffix}.csv`,
        exportRows
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Không thể xuất dữ liệu."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Xuất dữ liệu
        </h1>

        <p className="mt-1 font-body text-sm text-ink/60">
          Xuất RAW toàn bộ hành trình xử lý ticket và CSAT.
        </p>
      </div>

      {errorMessage && (
        <div className="rounded-lg bg-red-50 px-4 py-3 font-body text-sm text-danger">
          {errorMessage}
        </div>
      )}

      <div className="rounded-card border border-line bg-white p-5">
        <p className="mb-3 font-body text-sm font-semibold text-ink">
          Khoảng thời gian
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">
              Từ ngày
            </label>

            <input
              type="date"
              value={fromDate}
              onChange={(e) =>
                setFromDate(e.target.value)
              }
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">
              Đến ngày
            </label>

            <input
              type="date"
              value={toDate}
              onChange={(e) =>
                setToDate(e.target.value)
              }
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              applyPreset("today")
            }
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Hôm nay
          </button>

          <button
            onClick={() =>
              applyPreset("month")
            }
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Tháng này
          </button>

          <button
            onClick={() =>
              applyPreset("year")
            }
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Năm nay
          </button>

          <button
            onClick={() =>
              applyPreset("all")
            }
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Toàn bộ
          </button>
        </div>
      </div>

      <div className="rounded-card border border-line bg-white px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-body text-sm font-semibold text-ink">
              RAW
            </p>

            <p className="mt-1 font-body text-xs text-ink/50">
              1 dòng / 1 case · Có timeline xử lý và CSAT.
            </p>
          </div>

          <PrimaryButton
            onClick={handleExport}
            disabled={loading}
            className="px-5 py-2 text-sm"
          >
            {loading ? "Đang xuất..." : "Xuất RAW"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
```
