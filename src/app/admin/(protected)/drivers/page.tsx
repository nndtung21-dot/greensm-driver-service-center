"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csvParse";
import { DRIVER_UPLOAD_HEADER_MAP, DriverUploadRow } from "@/lib/types";
import { Panel, PrimaryButton } from "@/components/agent/ui";

function parseVnDateTime(raw: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = "0", mi = "0", s = "0"] = m;
  const iso = new Date(
    Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)
  );
  if (isNaN(iso.getTime())) return null;
  return iso.toISOString();
}

function mapRow(raw: Record<string, string>): DriverUploadRow | null {
  const mapped: Record<string, string> = {};
  for (const [viHeader, dbCol] of Object.entries(DRIVER_UPLOAD_HEADER_MAP)) {
    mapped[dbCol] = raw[viHeader] ?? "";
  }
  if (!mapped.driver_code || !mapped.name) return null;

  return {
    driver_code: mapped.driver_code,
    sap_id: mapped.sap_id || null,
    app_code: mapped.app_code || null,
    name: mapped.name,
    work_status: mapped.work_status || null,
    account_status: mapped.account_status || null,
    lock_reason: mapped.lock_reason || null,
    vehicle_model: mapped.vehicle_model || null,
    license_plate: mapped.license_plate || null,
    assignment_status: mapped.assignment_status || null,
    assigned_at: parseVnDateTime(mapped.assigned_at ?? ""),
    driver_type: mapped.driver_type || null,
  };
}

export default function AdminDriversPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<DriverUploadRow[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rawRows = parseCsv(text);
      const mapped = rawRows.map(mapRow);
      const valid = mapped.filter((r): r is DriverUploadRow => r !== null);
      setInvalidCount(mapped.length - valid.length);
      setRows(valid);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleConfirmUpload() {
    if (rows.length === 0) return;
    setUploading(true);
    setErrorMessage(null);
    setResult(null);

    const CHUNK = 300;
    let uploaded = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("drivers")
        .upsert(chunk, { onConflict: "driver_code" });
      if (error) {
        setErrorMessage(`Lỗi ở dòng ${i + 1}-${i + chunk.length}: ${error.message}`);
        setUploading(false);
        return;
      }
      uploaded += chunk.length;
    }

    setUploading(false);
    setResult(`Đã cập nhật ${uploaded} tài xế thành công.`);
    setRows([]);
    setFileName(null);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Danh sách tài xế
        </h1>
        <p className="mt-1 font-body text-sm text-ink/60">
          Upload file CSV danh sách tài xế mới nhất mỗi ngày trước ca làm. Hệ
          thống sẽ tự thêm tài xế mới và cập nhật thông tin tài xế đã có (dựa
          theo cột &quot;Mã tài xế&quot;) — không xoá dữ liệu cũ.
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">{errorMessage}</p>
      )}
      {result && (
        <p className="rounded-lg bg-brand-100 px-4 py-2 font-body text-sm text-brand-900">{result}</p>
      )}

      <Panel title="Tải file lên">
        <p className="mb-3 font-body text-xs text-ink/50">
          File CSV cần có đúng các cột (theo thứ tự bất kỳ): Mã tài xế, Mã SAP, Mã
          APP, Họ &amp; tên, Trạng thái, Trạng thái tài khoản, Lý do khóa, Dòng
          xe, Biển số, Trạng thái gán, Thời gian gán, Loại tài xế.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="block font-body text-sm"
        />
        {fileName && (
          <p className="mt-2 font-body text-xs text-ink/50">
            Đã đọc file: {fileName} — {rows.length} dòng hợp lệ
            {invalidCount > 0 && `, ${invalidCount} dòng bị bỏ qua (thiếu Mã tài xế hoặc Họ & tên)`}.
          </p>
        )}
        {rows.length > 0 && (
          <div className="mt-4">
            <div className="mb-3 max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-left font-body text-xs">
                <thead className="border-b border-line bg-paper/60 uppercase text-ink/50">
                  <tr>
                    <th className="px-3 py-2">Mã tài xế</th>
                    <th className="px-3 py-2">Họ &amp; tên</th>
                    <th className="px-3 py-2">SAP ID</th>
                    <th className="px-3 py-2">Trạng thái TK</th>
                    <th className="px-3 py-2">Biển số</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r) => (
                    <tr key={r.driver_code} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5">{r.driver_code}</td>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5">{r.sap_id ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.account_status ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.license_plate ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 && (
                <p className="px-3 py-2 font-body text-xs text-ink/40">
                  ... và {rows.length - 20} dòng khác
                </p>
              )}
            </div>
            <PrimaryButton onClick={handleConfirmUpload} disabled={uploading}>
              {uploading ? "Đang tải lên..." : `XÁC NHẬN CẬP NHẬT ${rows.length} TÀI XẾ`}
            </PrimaryButton>
          </div>
        )}
      </Panel>
    </div>
  );
}
