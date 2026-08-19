"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { PrimaryButton } from "@/components/agent/ui";

/**
 * RAW EXPORT
 *
 * Một file duy nhất chứa toàn bộ Case Log.
 * Có lọc theo khoảng ngày dựa trên check_in.
 */
const RAW_VIEW = "v_report_case_log";
const RAW_FILE = "raw-case-log";
const RAW_DATE_COLUMN = "check_in";

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
 * Format timestamp cho Excel/CSV.
 *
 * Ví dụ:
 * 2026-08-19T14:00:18.006551+00:00
 * =>
 * 19/08/2026 21:00:18
 *
 * Dùng timezone của browser.
 * Với máy ở Việt Nam sẽ hiển thị giờ Việt Nam.
 */
function formatDateTime(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  // Chỉ xử lý ISO datetime có phần T.
  // Date-only như 2026-08-19 không bị xử lý như timestamp.
  if (!value.includes("T")) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return [
    pad(date.getDate()),
    pad(date.getMonth() + 1),
    date.getFullYear(),
  ].join("/") +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
}

/**
 * Convert toàn bộ timestamp trong dataset trước khi export.
 *
 * Không hard-code tên cột.
 * Bất kỳ field nào có giá trị ISO datetime đều được format.
 */
function formatExportData(data: Record<string, unknown>[]) {
  return data.map((row) => {
    const formatted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      formatted[key] = formatDateTime(value);
    }

    return formatted;
  });
}

export default function AdminExportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function applyPreset(preset: "today" | "month" | "year" | "all") {
    const now = new Date();

    if (preset === "today") {
      setFromDate(todayStr());
      setToDate(todayStr());
      return;
    }

    if (preset === "month") {
      setFromDate(firstOfMonthStr());
      setToDate(todayStr());
      return;
    }

    if (preset === "year") {
      setFromDate(`${now.getFullYear()}-01-01`);
      setToDate(todayStr());
      return;
    }

    setFromDate("");
    setToDate("");
  }

  async function handleExport() {
    setLoading(true);
    setErrorMessage(null);

    try {
      let query = supabase
        .from(RAW_VIEW)
        .select("*")
        .limit(50000);

      /**
       * Lọc từ ngày.
       *
       * Dùng >= ngày bắt đầu.
       */
      if (fromDate) {
        query = query.gte(RAW_DATE_COLUMN, fromDate);
      }

      /**
       * Lọc đến hết ngày.
       *
       * Ví dụ:
       * toDate = 2026-08-19
       *
       * => < 2026-08-20
       *
       * để không bị mất các record ngày 19/08 sau 00:00.
       */
      if (toDate) {
        const toExclusive = new Date(`${toDate}T00:00:00`);

        toExclusive.setDate(toExclusive.getDate() + 1);

        const exclusiveDate = toExclusive
          .toISOString()
          .slice(0, 10);

        query = query.lt(RAW_DATE_COLUMN, exclusiveDate);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(error.message);
      }

      const rows = (data ?? []) as Record<string, unknown>[];

      if (rows.length === 0) {
        setErrorMessage(
          "Không có dữ liệu trong khoảng thời gian đã chọn."
        );
        return;
      }

      /**
       * Format toàn bộ timestamp trước khi tạo CSV.
       */
      const exportRows = formatExportData(rows);

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
      {/* HEADER */}
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Xuất dữ liệu
        </h1>

        <p className="mt-1 font-body text-sm text-ink/60">
          Xuất toàn bộ dữ liệu RAW theo khoảng thời gian.
        </p>
      </div>

      {/* ERROR */}
      {errorMessage && (
        <div className="rounded-lg bg-red-50 px-4 py-3 font-body text-sm text-danger">
          {errorMessage}
        </div>
      )}

      {/* DATE FILTER */}
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
              onChange={(e) => setFromDate(e.target.value)}
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
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
        </div>

        {/* PRESETS */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => applyPreset("today")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Hôm nay
          </button>

          <button
            onClick={() => applyPreset("month")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Tháng này
          </button>

          <button
            onClick={() => applyPreset("year")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Năm nay
          </button>

          <button
            onClick={() => applyPreset("all")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Toàn bộ
          </button>
        </div>
      </div>

      {/* RAW EXPORT */}
      <div className="rounded-card border border-line bg-white px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-body text-sm font-semibold text-ink">
              RAW Data
            </p>

            <p className="mt-1 font-body text-xs text-ink/50">
              Toàn bộ Case Log, bao gồm các mốc thời gian xử lý.
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
