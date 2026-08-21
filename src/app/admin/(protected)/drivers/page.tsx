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

function mapRow(
  raw: Record<string, string>
): DriverUploadRow | null {
  const mapped: Record<string, string> = {};

  for (const [
    viHeader,
    dbCol,
  ] of Object.entries(
    DRIVER_UPLOAD_HEADER_MAP
  )) {
    mapped[dbCol] =
      raw[viHeader] ?? "";
  }

  if (
    !mapped.driver_code ||
    !mapped.name
  ) {
    return null;
  }

  return {
    driver_code:
      mapped.driver_code.trim(),

    sap_id:
      mapped.sap_id?.trim() || null,

    app_code:
      mapped.app_code?.trim() || null,

    name:
      mapped.name.trim(),

    work_status:
      mapped.work_status?.trim() || null,

    account_status:
      mapped.account_status?.trim() || null,

    lock_reason:
      mapped.lock_reason?.trim() || null,

    vehicle_model:
      mapped.vehicle_model?.trim() || null,

    license_plate:
      mapped.license_plate?.trim() || null,

    assignment_status:
      mapped.assignment_status?.trim() || null,

    assigned_at:
      parseVnDateTime(
        mapped.assigned_at ?? ""
      ),

    driver_type:
      mapped.driver_type?.trim() || null,
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

      const mapped =
        rawRows.map(mapRow);

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

      const CHUNK = 300;

      const totalChunks =
        Math.ceil(
          uniqueRows.length /
            CHUNK
        );

      let uploaded = 0;

      for (
        let i = 0;
        i <
        uniqueRows.length;
        i += CHUNK
      ) {
        const chunk =
          uniqueRows.slice(
            i,
            i + CHUNK
          );

        /*
         * ====================================================
         * CHECK DUPLICATE SAP ID
         *
         * DB hiện tại có:
         *
         * drivers_driver_code_key
         * drivers_sap_id_key
         *
         * Vì vậy nếu 2 driver khác nhau dùng cùng SAP ID,
         * PostgreSQL sẽ reject.
         *
         * Check ngay trong chunk trước.
         * ====================================================
         */

        const sapMap =
          new Map<
            string,
            string
          >();

        for (const row of chunk) {
          if (!row.sap_id) {
            continue;
          }

          const sap =
            row.sap_id
              .trim()
              .toUpperCase();

          const existing =
            sapMap.get(sap);

          if (
            existing &&
            existing !==
              row.driver_code
          ) {
            throw new Error(
              `Trùng SAP ID "${row.sap_id}" trong file: ` +
                `${existing} và ${row.driver_code}.`
            );
          }

          sapMap.set(
            sap,
            row.driver_code
          );
        }

        /*
         * ====================================================
         * UPSERT
         * ====================================================
         */

        const {
          error,
        } = await supabase
          .from("drivers")
          .upsert(
            chunk,
            {
              onConflict:
                "driver_code",
            }
          );

        if (error) {
          throw new Error(
            `Lỗi ở dòng ${
              i + 1
            }-${
              Math.min(
                i +
                  chunk.length,
                uniqueRows.length
              )
            }: ${error.message}`
          );
        }

        uploaded +=
          chunk.length;

        setProgress(
          Math.round(
            (uploaded /
              uniqueRows.length) *
              100
          )
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
        `Đã cập nhật ${uploaded.toLocaleString(
          "vi-VN"
        )} tài xế thành công.`;

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
          dữ liệu cũ.
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

      {/* ======================================================
          PANEL
          ====================================================== */}

      <Panel title="Tải file lên">
        <p className="mb-3 font-body text-xs text-ink/50">
          File CSV cần có đúng các cột
          (theo thứ tự bất kỳ):
          Mã tài xế, Mã SAP, Mã APP,
          Họ &amp; tên, Trạng thái,
          Trạng thái tài khoản, Lý do khóa,
          Dòng xe, Biển số, Trạng thái gán,
          Thời gian gán, Loại tài xế.
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
