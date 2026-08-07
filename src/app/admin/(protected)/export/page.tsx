"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { PrimaryButton } from "@/components/agent/ui";

// Cột ngày dùng để lọc, theo từng view báo cáo (null = không lọc được, ví dụ
// Agent Performance là số liệu tổng hợp toàn thời gian, không có cột ngày).
const REPORTS: { view: string; label: string; file: string; dateColumn: string | null }[] = [
  { view: "v_report_visit_log", label: "Visit Log", file: "visit-log", dateColumn: "check_in" },
  { view: "v_report_case_log", label: "Case Log", file: "case-log", dateColumn: "check_in" },
  { view: "v_report_agent_performance", label: "Agent Performance (toàn thời gian)", file: "agent-performance", dateColumn: null },
  { view: "v_report_daily_summary", label: "Daily Summary", file: "daily-summary", dateColumn: "business_date" },
  { view: "v_report_feedback", label: "Feedback", file: "feedback", dateColumn: "created_at" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function AdminExportPage() {
  const [fromDate, setFromDate] = useState(firstOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());
  const [loadingView, setLoadingView] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function applyPreset(preset: "today" | "month" | "year" | "all") {
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
  }

  async function handleExport(report: (typeof REPORTS)[number]) {
    setLoadingView(report.view);
    setErrorMessage(null);

    let query = supabase.from(report.view).select("*").limit(10000);
    if (report.dateColumn && fromDate) {
      query = query.gte(report.dateColumn, fromDate);
    }
    if (report.dateColumn && toDate) {
      // +1 ngày để bao trọn hết ngày "đến" kể cả các cột kiểu timestamp
      const toExclusive = new Date(toDate);
      toExclusive.setDate(toExclusive.getDate() + 1);
      query = query.lt(report.dateColumn, toExclusive.toISOString().slice(0, 10));
    }

    const { data, error } = await query;
    setLoadingView(null);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    const suffix = report.dateColumn && (fromDate || toDate) ? `_${fromDate || "start"}_${toDate || "end"}` : "";
    downloadCsv(`${report.file}${suffix}.csv`, data ?? []);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">Xuất dữ liệu</h1>
        <p className="mt-1 font-body text-sm text-ink/60">
          Tải trực tiếp file CSV (mở được bằng Excel/Google Sheets).
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <div className="rounded-card border border-line bg-white p-5">
        <p className="mb-3 font-body text-sm font-semibold text-ink">Khoảng thời gian</p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Từ ngày</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Đến ngày</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => applyPreset("today")} className="rounded-lg border-2 border-line px-3 py-1 font-body text-xs hover:border-brand-500">
            Hôm nay
          </button>
          <button onClick={() => applyPreset("month")} className="rounded-lg border-2 border-line px-3 py-1 font-body text-xs hover:border-brand-500">
            Tháng này
          </button>
          <button onClick={() => applyPreset("year")} className="rounded-lg border-2 border-line px-3 py-1 font-body text-xs hover:border-brand-500">
            Năm nay
          </button>
          <button onClick={() => applyPreset("all")} className="rounded-lg border-2 border-line px-3 py-1 font-body text-xs hover:border-brand-500">
            Toàn bộ (không lọc)
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {REPORTS.map((r) => (
          <div
            key={r.view}
            className="flex items-center justify-between rounded-card border border-line bg-white px-5 py-4"
          >
            <span className="font-body text-sm font-medium text-ink">{r.label}</span>
            <PrimaryButton
              onClick={() => handleExport(r)}
              disabled={loadingView === r.view}
              className="px-4 py-2 text-sm"
            >
              {loadingView === r.view ? "Đang tải..." : "Xuất CSV"}
            </PrimaryButton>
          </div>
        ))}
      </div>
    </div>
  );
}
