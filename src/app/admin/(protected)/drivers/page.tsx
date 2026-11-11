"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csvParse";
import {
  DRIVER_UPLOAD_HEADER_MAP,
  DriverUploadRow,
} from "@/lib/types";
import {
  Panel,
  PrimaryButton,
} from "@/components/agent/ui";

function parseVnDateTime(
  raw: string
): string | null {
  if (!raw) return null;

  const m = raw
    .trim()
    .match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );

  if (!m) return null;

  const [
    ,
    d,
    mo,
    y,
    h = "0",
    mi = "0",
    s = "0",
  ] = m;

  const iso = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  );

  if (isNaN(iso.getTime())) {
    return null;
  }

  return iso.toISOString();
}

// Ký tự ẩn hay dính khi copy từ Excel/web: NBSP, zero-width, BOM, tab
const HIDDEN_CHARS = /[\u00A0\u200B\u200C\u200D\uFEFF\t]/g;

// Các cột là mã: không bao giờ có khoảng trắng
const CODE_COLUMNS = new Set(["driver_code", "sap_id", "app_code"]);

const REQUIRED_HEADERS = ["Mã tài xế", "Họ & tên"];

/** Chữ: bỏ ký tự ẩn, chuẩn Unicode NFC (tiếng Việt có dấu), gộp khoảng trắng. */
function cleanText(raw: string): string {
  return raw
    .replace(HIDDEN_CHARS, " ")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

// Mã bị Excel đổi sang dạng số khoa học, vd 3.5355E+17 (mất luôn các chữ số cuối)
const SCIENTIFIC_CODE = /^\d+(?:[.,]\d+)?E\+?\d+$/i;

/** Mã (tài xế, SAP, APP): bỏ ký tự ẩn và mọi khoảng trắng. */
function cleanCode(raw: string): string {
  return raw
    .replace(HIDDEN_CHARS, "")
    .normalize("NFC")
    .replace(/\s+/g, "");
}

/** Tên: như cleanText; nếu viết thường toàn bộ thì viết hoa chữ cái đầu mỗi từ. */
function cleanName(raw: string): string {
  const s = cleanText(raw);
  if (
    s &&
    s === s.toLocaleLowerCase("vi") &&
    s !== s.toLocaleUpperCase("vi")
  ) {
    return s
      .split(" ")
      .map(
        (w) =>
          w.charAt(0).toLocaleUpperCase("vi") +
          w.slice(1)
      )
      .join(" ");
  }
  return s;
}

/**
 * Đổi 1 dòng CSV thành dòng gửi lên DB.
 * CHỈ lấy những cột có trong file: cột không có trong file không được đưa vào
 * object, nên khi upsert, dữ liệu cũ của cột đó được giữ nguyên (trước đây
 * cột thiếu bị gán null và xoá trắng dữ liệu cũ).
 * Trả về số giá trị đã được tự làm sạch để báo cho người dùng.
 */
function mapRow(
  raw: Record<string, string>
): { row: DriverUploadRow; cleaned: number } | null {
  const out: Record<string, string | null> = {};
  let cleaned = 0;

  for (const [viHeader, dbCol] of Object.entries(
    DRIVER_UPLOAD_HEADER_MAP
  )) {
    if (!(viHeader in raw)) continue;

    const value = raw[viHeader] ?? "";
    let next: string | null;

    if (CODE_COLUMNS.has(dbCol)) {
      next = cleanCode(value) || null;
    } else if (dbCol === "name") {
      next = cleanName(value) || null;
    } else if (dbCol === "assigned_at") {
      next = parseVnDateTime(cleanText(value));
    } else {
      next = cleanText(value) || null;
    }

    if (
      dbCol !== "assigned_at" &&
      (next ?? "") !== value.trim()
    ) {
      cleaned++;
    }

    out[dbCol] = next;
  }

  if (!out.driver_code || !out.name) {
    return null;
  }

  // Mã tài xế / Mã SAP đã bị Excel làm hỏng: bỏ dòng, không ghi mã sai vào DB
  if (
    SCIENTIFIC_CODE.test(out.driver_code) ||
    (out.sap_id && SCIENTIFIC_CODE.test(out.sap_id))
  ) {
    return null;
  }

  return {
    row: out as DriverUploadRow,
    cleaned,
  };
}

export default function AdminDriversPage() {
  const [
    fileName,
    setFileName,
  ] = useState<string | null>(null);

  const [
    rows,
    setRows,
  ] = useState<DriverUploadRow[]>([]);

  const [
    invalidCount,
    setInvalidCount,
  ] = useState(0);

  const [
    duplicateDriverCount,
    setDuplicateDriverCount,
  ] = useState(0);

  const [
    uploading,
    setUploading,
  ] = useState(false);

  const [
    progress,
    setProgress,
  ] = useState(0);

  const [
    result,
    setResult,
  ] = useState<string | null>(null);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(null);

  // Số giá trị đã tự làm sạch, và các cột có trong file (chỉ các cột này được cập nhật)
  const [cleanedCount, setCleanedCount] = useState(0);
  // Số dòng có mã bị Excel đổi sang dạng 3.5E+17 (đã bỏ qua)
  const [excelBrokenCount, setExcelBrokenCount] = useState(0);

  // Mã SAP đã chuyển từ mã tài xế cũ (trong DB) sang mã tài xế trong file
  const [movedSaps, setMovedSaps] = useState<
    { sap: string; from: string; fromName: string; to: string }[]
  >([]);
  const [fileColumns, setFileColumns] = useState<string[]>([]);

  // ==========================================================
  // READ CSV
  // ==========================================================

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    setErrorMessage(null);
    setProgress(0);
    setDuplicateDriverCount(0);

    const reader =
      new FileReader();

    reader.onload = () => {
      const text =
        String(
          reader.result ?? ""
        );

      const rawRows =
        parseCsv(text);

      // File phải có cột Mã tài xế và Họ & tên
      const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
      const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
      if (missing.length > 0) {
        setRows([]);
        setFileColumns([]);
        setCleanedCount(0);
        setInvalidCount(0);
        setErrorMessage(
          `File thiếu cột bắt buộc: ${missing.join(", ")}.`
        );
        return;
      }
      setFileColumns(
        Object.keys(DRIVER_UPLOAD_HEADER_MAP).filter((h) => headers.includes(h))
      );

      const mappedWithInfo =
        rawRows.map(mapRow);

      setCleanedCount(
        mappedWithInfo.reduce((sum, m) => sum + (m?.cleaned ?? 0), 0)
      );

      setExcelBrokenCount(
        rawRows.filter(
          (r) =>
            SCIENTIFIC_CODE.test((r["Mã tài xế"] ?? "").replace(/\s+/g, "")) ||
            SCIENTIFIC_CODE.test((r["Mã SAP"] ?? "").replace(/\s+/g, ""))
        ).length
      );

      const mapped = mappedWithInfo.map((m) => m?.row ?? null);

      const valid =
        mapped.filter(
          (
            r
          ): r is DriverUploadRow =>
            r !== null
        );

      setInvalidCount(
        mapped.length -
          valid.length
      );

      /*
       * ========================================================
       * DEDUPE NGAY SA FILE
       *
       * Nếu cùng driver_code xuất hiện nhiều lần:
       * giữ dòng CUỐI CÙNG.
       *
       * Việc này rất quan trọng vì PostgreSQL:
       *
       * ON CONFLICT DO UPDATE
       *
       * không cho phép cùng một row DB
       * bị update 2 lần trong cùng INSERT.
       * ========================================================
       */

      const uniqueMap =
        new Map<
          string,
          DriverUploadRow
        >();

      let duplicateCount = 0;

      for (const row of valid) {
        const driverCode =
          row.driver_code
            .trim()
            .toUpperCase();

        if (
          uniqueMap.has(
            driverCode
          )
        ) {
          duplicateCount++;
        }

        uniqueMap.set(
          driverCode,
          {
            ...row,
            driver_code:
              row.driver_code.trim(),
          }
        );
      }

      const uniqueRows =
        Array.from(
          uniqueMap.values()
        );

      setDuplicateDriverCount(
        duplicateCount
      );

      setRows(
        uniqueRows
      );
    };

    reader.readAsText(
      file,
      "utf-8"
    );
  }

  // ==========================================================
  // UPLOAD
  // ==========================================================

  async function handleConfirmUpload() {
    if (
      rows.length === 0 ||
      uploading
    ) {
      return;
    }

    setUploading(true);
    setErrorMessage(null);
    setResult(null);
    setProgress(0);

    try {
      /*
       * ======================================================
       * SAFETY DEDUPE LẦN 2
       *
       * Đảm bảo rows không bao giờ có duplicate driver_code
       * ngay cả khi state bị thay đổi.
       * ======================================================
       */

      const uniqueMap =
        new Map<
          string,
          DriverUploadRow
        >();

      let duplicateCount =
        duplicateDriverCount;

      for (const row of rows) {
        const driverCode =
          row.driver_code
            .trim()
            .toUpperCase();

        if (
          uniqueMap.has(
            driverCode
          )
        ) {
          duplicateCount++;
        }

        uniqueMap.set(
          driverCode,
          {
            ...row,
            driver_code:
              row.driver_code.trim(),
          }
        );
      }

      const uniqueRows =
        Array.from(
          uniqueMap.values()
        );

      /*
       * ======================================================
       * CHUNK
       * ======================================================
       *
       * 300 rows / request.
       *
       * 130k drivers ≈ 434 requests.
       * ======================================================
       */

      // Một Mã SAP chỉ được thuộc về một mã tài xế trong cùng file
      const sapOwner = new Map<string, string>();
      for (const row of uniqueRows) {
        if (!row.sap_id) continue;
        const prev = sapOwner.get(row.sap_id);
        if (prev && prev !== row.driver_code) {
          throw new Error(
            `Trùng SAP ID "${row.sap_id}" trong file: ${prev} và ${row.driver_code}. Chưa ghi dòng nào, sửa file rồi tải lại.`
          );
        }
        sapOwner.set(row.sap_id, row.driver_code);
      }

      const moved: { sap: string; from: string; fromName: string; to: string }[] = [];
      setMovedSaps([]);

      /*
       * ======================================================
       * GHI QUA HÀM admin_import_drivers (0045)
       *
       * Hàm trên DB so sánh từng dòng với dữ liệu hiện có và CHỈ
       * ghi dòng thật sự thay đổi (trước đây upsert ghi lại mọi
       * dòng, làm cạn Disk IO và đứng hệ thống 11/11). Hàm cũng tự
       * chuyển Mã SAP đã đổi sang mã tài xế mới.
       * ======================================================
       */

      const CHUNK = 1000;

      // Các cột có trong file (mọi dòng có cùng bộ cột)
      const columns = Object.keys(uniqueRows[0] ?? {}).filter(
        (k) => k !== "driver_code" && k !== "name"
      );

      let uploaded = 0;
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;

      for (
        let i = 0;
        i < uniqueRows.length;
        i += CHUNK
      ) {
        const chunk = uniqueRows.slice(i, i + CHUNK);

        const { data, error } = await supabase.rpc(
          "admin_import_drivers",
          {
            p_rows: chunk,
            p_columns: columns,
          }
        );

        if (error) {
          throw new Error(
            `Lỗi ở dòng ${i + 1}-${Math.min(i + chunk.length, uniqueRows.length)}: ${error.message}` +
              (uploaded > 0
                ? ` (${uploaded.toLocaleString("vi-VN")} dòng trước đó đã nạp xong; nạp lại cả file là được, dòng đã nạp sẽ được bỏ qua).`
                : "")
          );
        }

        const r = (data ?? {}) as {
          inserted?: number;
          updated?: number;
          unchanged?: number;
          moved?: { sap: string; from: string; fromName: string; to: string }[];
        };

        inserted += r.inserted ?? 0;
        updated += r.updated ?? 0;
        unchanged += r.unchanged ?? 0;

        if (r.moved && r.moved.length > 0) {
          moved.push(...r.moved);
          setMovedSaps([...moved]);
        }

        uploaded += chunk.length;

        setProgress(
          Math.round((uploaded / uniqueRows.length) * 100)
        );
      }

      /*
       * ======================================================
       * SUCCESS
       * ======================================================
       */

      setUploading(false);
      setProgress(100);

      let message =
        `Đã xử lý ${uploaded.toLocaleString("vi-VN")} tài xế: ` +
        `thêm mới ${inserted.toLocaleString("vi-VN")}, ` +
        `cập nhật ${updated.toLocaleString("vi-VN")}, ` +
        `không đổi ${unchanged.toLocaleString("vi-VN")} (bỏ qua, không ghi lại).`;

      if (moved.length > 0) {
        message += ` Đã chuyển ${moved.length.toLocaleString("vi-VN")} Mã SAP sang mã tài xế mới (xem danh sách bên dưới).`;
      }

      if (
        duplicateCount > 0
      ) {
        message +=
          ` Đã tự loại ${duplicateCount.toLocaleString(
            "vi-VN"
          )} dòng trùng Mã tài xế.`;
      }

      setResult(
        message
      );

      setRows([]);
      setFileName(null);
    } catch (error) {
      setUploading(false);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật danh sách tài xế."
      );
    }
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="max-w-3xl space-y-6">
      {/* ======================================================
          HEADER
          ====================================================== */}

      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Danh sách tài xế
        </h1>

        <p className="mt-1 font-body text-sm text-ink/60">
          Upload file CSV danh sách tài xế
          mới nhất mỗi ngày trước ca làm.
          Hệ thống sẽ tự thêm tài xế mới
          và cập nhật thông tin tài xế đã có
          dựa theo Mã tài xế — không xoá
          dữ liệu cũ. Chỉ các cột có trong
          file được cập nhật; cột không có
          trong file giữ nguyên dữ liệu cũ.
        </p>
      </div>

      {/* ======================================================
          ERROR
          ====================================================== */}

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {/* ======================================================
          SUCCESS
          ====================================================== */}

      {result && (
        <p className="rounded-lg bg-brand-100 px-4 py-2 font-body text-sm text-brand-900">
          {result}
        </p>
      )}

      {movedSaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 font-body text-sm">
          <p className="font-semibold text-warn">
            {movedSaps.length.toLocaleString("vi-VN")} Mã SAP đã chuyển từ mã tài xế cũ sang mã tài xế trong file
          </p>
          <p className="mb-2 text-xs text-ink/60">
            Mã cũ được bỏ Mã SAP, vẫn giữ tên, Mã APP, biển số và lịch sử vé.
          </p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink/50">
                <tr>
                  <th className="py-1 pr-3">Mã SAP</th>
                  <th className="py-1 pr-3">Mã tài xế cũ</th>
                  <th className="py-1 pr-3">Tên trên mã cũ</th>
                  <th className="py-1">Mã tài xế mới</th>
                </tr>
              </thead>
              <tbody>
                {movedSaps.map((m) => (
                  <tr key={m.sap + m.from} className="border-t border-amber-200">
                    <td className="py-1 pr-3">{m.sap}</td>
                    <td className="py-1 pr-3">{m.from}</td>
                    <td className="py-1 pr-3">{m.fromName}</td>
                    <td className="py-1">{m.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======================================================
          PANEL
          ====================================================== */}

      <Panel title="Tải file lên">
        <p className="mb-3 font-body text-xs text-ink/50">
          Bắt buộc có cột Mã tài xế và
          Họ &amp; tên. Có thể có thêm (theo
          thứ tự bất kỳ): Mã SAP, Mã APP,
          Trạng thái, Trạng thái tài khoản,
          Lý do khóa, Dòng xe, Biển số,
          Trạng thái gán, Thời gian gán,
          Loại tài xế.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          disabled={uploading}
          onChange={(e) => {
            const file =
              e.target.files?.[0];

            if (file) {
              handleFile(file);
            }
          }}
          className="block font-body text-sm"
        />

        {/* ====================================================
            FILE INFO
            ==================================================== */}

        {fileName && (
          <div className="mt-3 space-y-1">
            <p className="font-body text-xs text-ink/50">
              Đã đọc file:{" "}
              <span className="font-semibold text-ink">
                {fileName}
              </span>
            </p>

            <p className="font-body text-xs text-ink/50">
              {rows.length.toLocaleString(
                "vi-VN"
              )}{" "}
              dòng hợp lệ
            </p>

            {fileColumns.length > 0 && (
              <p className="font-body text-xs text-ink/50">
                Sẽ cập nhật các cột:{" "}
                <span className="font-semibold text-ink">
                  {fileColumns.join(", ")}
                </span>
                . Các cột khác giữ nguyên.
              </p>
            )}

            {excelBrokenCount > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 font-body text-xs text-warn">
                Đã bỏ qua{" "}
                {excelBrokenCount.toLocaleString("vi-VN")}{" "}
                dòng có Mã tài xế hoặc Mã SAP bị Excel đổi sang dạng 3.5E+17 (đã mất số).
                Hãy xuất lại file trực tiếp từ hệ thống, không mở rồi lưu lại bằng Excel.
              </p>
            )}

            {cleanedCount > 0 && (
              <p className="font-body text-xs text-ink/50">
                Đã tự làm sạch{" "}
                {cleanedCount.toLocaleString("vi-VN")}{" "}
                giá trị (khoảng trắng thừa, dấu tiếng Việt, ký tự ẩn, tên viết thường).
              </p>
            )}

            {invalidCount >
              0 && (
              <p className="font-body text-xs text-warn">
                {invalidCount.toLocaleString(
                  "vi-VN"
                )}{" "}
                dòng bị bỏ qua
                (thiếu Mã tài xế
                hoặc Họ &amp; tên).
              </p>
            )}

            {duplicateDriverCount >
              0 && (
              <p className="font-body text-xs text-warn">
                Đã phát hiện{" "}
                {duplicateDriverCount.toLocaleString(
                  "vi-VN"
                )}{" "}
                dòng trùng Mã tài xế.
                Hệ thống sẽ giữ dòng
                cuối cùng.
              </p>
            )}
          </div>
        )}

        {/* ====================================================
            PROGRESS
            ==================================================== */}

        {uploading && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-body text-xs text-ink/60">
                Đang cập nhật dữ liệu...
              </p>

              <p className="font-body text-xs font-semibold text-brand-700">
                {progress}%
              </p>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-300"
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* ====================================================
            PREVIEW
            ==================================================== */}

        {rows.length > 0 && (
          <div className="mt-4">
            <div className="mb-3 max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-left font-body text-xs">
                <thead className="border-b border-line bg-paper/60 uppercase text-ink/50">
                  <tr>
                    <th className="px-3 py-2">
                      Mã tài xế
                    </th>

                    <th className="px-3 py-2">
                      Họ &amp; tên
                    </th>

                    <th className="px-3 py-2">
                      SAP ID
                    </th>

                    <th className="px-3 py-2">
                      Trạng thái TK
                    </th>

                    <th className="px-3 py-2">
                      Biển số
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows
                    .slice(0, 20)
                    .map((row) => (
                      <tr
                        key={
                          row.driver_code
                        }
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-3 py-1.5">
                          {
                            row.driver_code
                          }
                        </td>

                        <td className="px-3 py-1.5">
                          {row.name}
                        </td>

                        <td className="px-3 py-1.5">
                          {row.sap_id ??
                            "—"}
                        </td>

                        <td className="px-3 py-1.5">
                          {
                            row.account_status ??
                              "—"
                          }
                        </td>

                        <td className="px-3 py-1.5">
                          {
                            row.license_plate ??
                              "—"
                          }
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {rows.length >
                20 && (
                <p className="px-3 py-2 font-body text-xs text-ink/40">
                  ... và{" "}
                  {(
                    rows.length -
                    20
                  ).toLocaleString(
                    "vi-VN"
                  )}{" "}
                  dòng khác
                </p>
              )}
            </div>

            {/* ==================================================
                UPLOAD BUTTON
                ================================================== */}

            <PrimaryButton
              onClick={
                handleConfirmUpload
              }
              disabled={uploading}
            >
              {uploading
                ? `ĐANG CẬP NHẬT ${progress}%...`
                : `XÁC NHẬN CẬP NHẬT ${rows.length.toLocaleString(
                    "vi-VN"
                  )} TÀI XẾ`}
            </PrimaryButton>
          </div>
        )}
      </Panel>
    </div>
  );
}
