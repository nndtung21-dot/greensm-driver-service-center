"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Panel, PrimaryButton, StatusBadge } from "@/components/agent/ui";
import { TicketStatus } from "@/lib/types";

type DriverInfo = {
  id: string;
  sap_id: string | null;
  driver_code: string | null;
  app_code: string | null;
  name: string;
  license_plate: string | null;
  driver_type: string | null;
  work_status: string | null;
  account_status: string | null;
  lock_reason: string | null;
};

type CaseLogRow = {
  case_id: string; // thực chất là case_code (mã dễ đọc), không phải uuid
  ticket_id: string; // ticket_code
  branch: string;
  category: string;
  subcategory: string | null;
  agent: string | null;
  status: TicketStatus;
  check_in: string;
  called_at: string | null;
  started_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  waiting_time_min: number | null;
  handling_time_min: number | null;
  sla_status: string;
  resolution: string | null;
};

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("vi-VN");
}

export default function AdminDriverHistoryPage() {
  const [sapId, setSapId] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [rows, setRows] = useState<CaseLogRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSearch() {
    const trimmed = sapId.trim();
    if (!trimmed) {
      setErrorMessage("Nhập SAP ID trước đã.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setSearched(true);

    const { data: driverData, error: driverError } = await supabase
      .from("drivers")
      .select(
        "id, sap_id, driver_code, app_code, name, license_plate, driver_type, work_status, account_status, lock_reason"
      )
      .eq("sap_id", trimmed)
      .maybeSingle();

    if (driverError) {
      setErrorMessage(driverError.message);
      setLoading(false);
      return;
    }

    if (!driverData) {
      setDriver(null);
      setRows([]);
      setLoading(false);
      return;
    }

    setDriver(driverData as DriverInfo);

    const { data: logData, error: logError } = await supabase
      .from("v_report_case_log")
      .select("*")
      .eq("sap_id", trimmed)
      .order("check_in", { ascending: false });

    if (logError) {
      setErrorMessage(logError.message);
      setRows([]);
    } else {
      setRows((logData as CaseLogRow[]) ?? []);
    }

    setLoading(false);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Lịch sử theo SAP ID
        </h1>
        <p className="mt-1 font-body text-sm text-ink/50">
          Tra cứu toàn bộ ticket/case của 1 tài xế qua SAP ID.
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={sapId}
            onChange={(e) => {
              setSapId(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="Nhập SAP ID..."
            className="w-64 rounded-lg border-2 border-line px-4 py-2.5 font-body text-sm focus:border-brand-700"
          />
          <PrimaryButton onClick={handleSearch} disabled={loading}>
            {loading ? "Đang tra cứu..." : "Tra cứu"}
          </PrimaryButton>
        </div>
        {errorMessage && (
          <p className="mt-3 font-body text-sm text-danger">{errorMessage}</p>
        )}
      </Panel>

      {searched && !loading && !driver && !errorMessage && (
        <Panel>
          <p className="font-body text-sm text-ink/50">
            Không tìm thấy tài xế với SAP ID này.
          </p>
        </Panel>
      )}

      {driver && (
        <Panel title={driver.name}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-body text-sm sm:grid-cols-3">
            <Row label="SAP ID" value={driver.sap_id ?? "—"} />
            <Row label="Mã tài xế" value={driver.driver_code ?? "—"} />
            <Row label="App Code" value={driver.app_code ?? "—"} />
            <Row label="Biển số xe" value={driver.license_plate ?? "—"} />
            <Row label="Loại tài xế" value={driver.driver_type ?? "—"} />
            <Row label="Trạng thái làm việc" value={driver.work_status ?? "—"} />
            <Row label="Trạng thái tài khoản" value={driver.account_status ?? "—"} />
            {driver.lock_reason && (
              <Row label="Lý do khóa" value={driver.lock_reason} />
            )}
          </dl>
        </Panel>
      )}

      {driver && (
        <Panel title={`Lịch sử (${rows.length} case)`}>
          {rows.length === 0 ? (
            <p className="font-body text-sm text-ink/50">
              Tài xế này chưa có case nào.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-body text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-ink/50">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2">Check-in</th>
                    <th className="whitespace-nowrap px-3 py-2">Ticket</th>
                    <th className="whitespace-nowrap px-3 py-2">VP</th>
                    <th className="px-3 py-2">Chủ đề</th>
                    <th className="whitespace-nowrap px-3 py-2">Agent</th>
                    <th className="whitespace-nowrap px-3 py-2">Trạng thái</th>
                    <th className="whitespace-nowrap px-3 py-2">Chờ</th>
                    <th className="whitespace-nowrap px-3 py-2">Xử lý</th>
                    <th className="px-3 py-2">Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.ticket_id}
                      className="border-b border-line last:border-0 align-top"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink/60">
                        {fmt(row.check_in)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-display font-bold text-brand-900">
                        {row.ticket_id}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {row.branch}
                      </td>
                      <td className="px-3 py-2.5">
                        <p>{row.category}</p>
                        {row.subcategory && (
                          <p className="text-xs text-ink/50">
                            {row.subcategory}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {row.agent ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink/60">
                        {row.waiting_time_min ?? "—"}
                        {row.waiting_time_min != null && " ph"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink/60">
                        {row.handling_time_min ?? "—"}
                        {row.handling_time_min != null && " ph"}
                      </td>
                      <td className="max-w-xs px-3 py-2.5 text-ink/70">
                        {row.resolution ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink/40">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
