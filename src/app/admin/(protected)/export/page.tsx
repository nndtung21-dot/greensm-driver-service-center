"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/csv";
import { PrimaryButton } from "@/components/agent/ui";

const REPORTS = [
  { view: "v_report_visit_log", label: "Visit Log", file: "visit-log.csv" },
  { view: "v_report_case_log", label: "Case Log", file: "case-log.csv" },
  { view: "v_report_agent_performance", label: "Agent Performance", file: "agent-performance.csv" },
  { view: "v_report_daily_summary", label: "Daily Summary", file: "daily-summary.csv" },
  { view: "v_report_feedback", label: "Feedback", file: "feedback.csv" },
];

export default function AdminExportPage() {
  const [loadingView, setLoadingView] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleExport(view: string, file: string) {
    setLoadingView(view);
    setErrorMessage(null);
    const { data, error } = await supabase.from(view).select("*").limit(10000);
    setLoadingView(null);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    downloadCsv(file, data ?? []);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">Xuất dữ liệu</h1>
        <p className="mt-1 font-body text-sm text-ink/60">
          Tải trực tiếp file CSV (mở được bằng Excel/Google Sheets) — không cần
          chờ kết nối Google Sheets tự động (Phase 8) vốn cần tài khoản Google
          riêng của bạn. Đây là cách xuất nhanh, làm được ngay.
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <div className="space-y-3">
        {REPORTS.map((r) => (
          <div
            key={r.view}
            className="flex items-center justify-between rounded-card border border-line bg-white px-5 py-4"
          >
            <span className="font-body text-sm font-medium text-ink">{r.label}</span>
            <PrimaryButton
              onClick={() => handleExport(r.view, r.file)}
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
