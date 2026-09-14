"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { PrimaryButton } from "@/components/agent/ui";

const RAW_VIEW = "v_report_raw";
const RAW_DATE_COLUMN = "_filter_date";
const RAW_FILE = "raw";

// Lấy dữ liệu theo từng batch để không bị giới hạn số dòng
const PAGE_SIZE = 1000;

/**
 * Lấy ngày hiện tại theo timezone của máy người dùng.
 * Không dùng toISOString() vì có thể bị lệch ngày do UTC.
 */
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function todayStr() {
  return getLocalDateString();
}

function firstOfMonthStr() {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-01`;
}

/**
 * Format timestamp thành:
 * MM/DD/YYYY HH:mm:ss
 *
 * Ví dụ:
 * 08/19/2026 15:35:21
 */
function formatDateTime(value: unknown): string {
  if (!value) return "";

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
}

const DATETIME_COLUMNS = new Set([
  "Check-in",
  "Called At",
  "Started At",
  "Resolved At",
  "Closed At",
  "Feedback Created At",
]);

function formatRawRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const formatted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      // Không export cột kỹ thuật dùng để filter
      if (key === RAW_DATE_COLUMN) {
        continue;
      }

      if (DATETIME_COLUMNS.has(key)) {
        formatted[key] = formatDateTime(value);
      } else {
        formatted[key] = value ?? "";
      }
    }

    return formatted;
  });
}

/**
 * Convert ngày Việt Nam GMT+7 sang ISO UTC.
 *
 * Ví dụ:
 *
 * 2026-09-14 00:00 GMT+7
 * =>
 * 2026-09-13 17:00 UTC
 */
function vietnamDateToUTC(dateStr: string) {
  return new Date(
    `${dateStr}T00:00:00+07:00`
  ).toISOString();
}

/**
 * Lấy timestamp đầu ngày tiếp theo theo timezone GMT+7.
 *
 * Ví dụ:
 *
 * Đến ngày 14/09
 * =>
 * < 15/09 00:00 GMT+7
 *
 * Như vậy toàn bộ ngày 14/09 được lấy.
 */
function vietnamNextDateToUTC(dateStr: string) {
  const date = new Date(
    `${dateStr}T00:00:00+07:00`
  );

  date.setUTCDate(date.getUTCDate() + 1);

  return date.toISOString();
}

export default function AdminExportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    null
  );

  function applyPreset(
    preset: "today" | "month" | "year" | "all"
  ) {
    const now = new Date();

    if (preset === "today") {
      setFromDate(todayStr());
      setToDate(todayStr());
    } else if (preset === "month") {
      setFromDate(firstOfMonthStr());
      setToDate(todayStr());
    } else if (preset === "year") {
      setFromDate(`${now.getFullYear()}-01-01`);
      setToDate(todayStr());
    } else {
      setFromDate("");
      setToDate("");
    }

    setErrorMessage(null);
  }

  async function handleExport() {
    setLoading(true);
    setErrorMessage(null);

    try {
      /**
       * Validate khoảng ngày
       */
      if (fromDate && toDate && fromDate > toDate) {
        throw new Error(
          "Ngày bắt đầu không được lớn hơn ngày kết thúc."
        );
      }

      /**
       * Convert khoảng ngày Việt Nam sang UTC.
       *
       * Ví dụ:
       *
       * Từ 01/09:
       * >= 2026-08-31 17:00:00 UTC
       *
       * Đến 14/09:
       * < 2026-09-14 17:00:00 UTC
       *
       * => lấy đầy đủ từ 01/09 đến hết 14/09 theo giờ Việt Nam.
       */
      let fromISO: string | null = null;
      let toExclusiveISO: string | null = null;

      if (fromDate) {
        fromISO = vietnamDateToUTC(fromDate);
      }

      if (toDate) {
        toExclusiveISO = vietnamNextDateToUTC(toDate);
      }

      /**
       * Lưu toàn bộ dữ liệu của tất cả các page.
       */
      const allRows: Record<string, unknown>[] = [];

      let page = 0;

      /**
       * Pagination.
       *
       * Supabase/PostgREST có giới hạn số record trả về.
       * Vì vậy không dùng .limit(10000).
       *
       * Mỗi lần lấy 1.000 dòng:
       *
       * page 0 => 0 - 999
       * page 1 => 1000 - 1999
       * page 2 => 2000 - 2999
       * ...
       *
       * Cho tới khi không còn dữ liệu.
       */
      while (true) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let query = supabase
          .from(RAW_VIEW)
          .select("*")
          .order(RAW_DATE_COLUMN, {
            ascending: true,
          })
          .range(from, to);

        /**
         * Filter từ đầu ngày.
         */
        if (fromISO) {
          query = query.gte(
            RAW_DATE_COLUMN,
            fromISO
          );
        }

        /**
         * Filter đến đầu ngày kế tiếp.
         *
         * Dùng < thay vì <=.
         *
         * Ví dụ:
         *
         * chọn đến 14/09
         *
         * < 15/09 00:00 GMT+7
         *
         * => bao gồm toàn bộ record ngày 14.
         */
        if (toExclusiveISO) {
          query = query.lt(
            RAW_DATE_COLUMN,
            toExclusiveISO
          );
        }

        const { data, error } = await query;

        if (error) {
          throw new Error(error.message);
        }

        const rows = (data ?? []) as Record<
          string,
          unknown
        >[];

        /**
         * Append page hiện tại vào tổng dữ liệu.
         */
        allRows.push(...rows);

        /**
         * Nếu page không đủ PAGE_SIZE
         * thì đã tới cuối dữ liệu.
         */
        if (rows.length < PAGE_SIZE) {
          break;
        }

        page++;
      }

      /**
       * Không có dữ liệu.
       */
      if (allRows.length === 0) {
        setErrorMessage(
          "Không có dữ liệu trong khoảng thời gian đã chọn."
        );
        return;
      }

      /**
       * Format dữ liệu trước khi export.
       */
      const formattedRows = formatRawRows(allRows);

      /**
       * Tên file.
       *
       * Ví dụ:
       * raw_2026-09-01_2026-09-14.csv
       */
      const suffix =
        fromDate || toDate
          ? `_${fromDate || "start"}_${
              toDate || "end"
            }`
          : "";

      downloadCsv(
        `${RAW_FILE}${suffix}.csv`,
        formattedRows
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
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Xuất dữ liệu RAW
        </h1>

        <p className="mt-1 font-body text-sm text-ink/60">
          Xuất toàn bộ dữ liệu check-in, xử lý ticket và feedback.
        </p>
      </div>

      {errorMessage && (
        <div className="rounded-lg bg-red-50 px-4 py-3 font-body text-sm text-danger">
          {errorMessage}
        </div>
      )}

      <div className="rounded-card border border-line bg-white p-5">
        <p className="mb-4 font-body text-sm font-semibold text-ink">
          Khoảng thời gian
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">
              Từ ngày
            </label>

            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setErrorMessage(null);
              }}
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
              onChange={(e) => {
                setToDate(e.target.value);
                setErrorMessage(null);
              }}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyPreset("today")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Hôm nay
          </button>

          <button
            type="button"
            onClick={() => applyPreset("month")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Tháng này
          </button>

          <button
            type="button"
            onClick={() => applyPreset("year")}
            className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-xs hover:border-brand-500"
          >
            Năm nay
          </button>

          <button
            type="button"
            onClick={() => applyPreset("all")}
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
              Bao gồm thông tin tài xế, ticket, Agent, SLA, thời gian xử lý
              và đánh giá CSAT.
            </p>
          </div>

          <PrimaryButton
            onClick={handleExport}
            disabled={loading}
            className="shrink-0 px-5 py-2 text-sm"
          >
            {loading ? "Đang tải..." : "Xuất RAW"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
