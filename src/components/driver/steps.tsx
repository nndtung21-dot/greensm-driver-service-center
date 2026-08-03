"use client";

import { FormEvent, useState } from "react";
import { KioskButton, StepCard } from "./ui";
import {
  Branch,
  DriverLookupResult,
  ServiceCategory,
  ServiceSubcategory,
} from "@/lib/types";

// ---------------------------------------------------------------------
// 1. Welcome (Section 5)
// ---------------------------------------------------------------------
export function WelcomeStep({ onStart }: { onStart: () => void }) {
  return (
    <StepCard
      eyebrow="Green SM Driver Service Center"
      title="Xin chào Quý Tài xế"
      subtitle="Vui lòng check-in để được hỗ trợ nhanh nhất."
    >
      <KioskButton onClick={onStart}>BẮT ĐẦU CHECK-IN</KioskButton>
    </StepCard>
  );
}

// ---------------------------------------------------------------------
// 2. Identify (Section 6)
// ---------------------------------------------------------------------
export function IdentifyStep({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (identifier: string) => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.trim().length > 0) onSubmit(value.trim());
  }

  return (
    <StepCard
      eyebrow="Bước 1"
      title="Xác thực tài xế"
      subtitle="Nhập SAP ID hoặc số điện thoại đã đăng ký."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <input
          autoFocus
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="SAP ID hoặc số điện thoại"
          className="w-full rounded-card border-2 border-line px-6 py-6 text-2xl font-body focus:border-brand-700"
        />
        <KioskButton type="submit" disabled={loading}>
          {loading ? "Đang tìm..." : "TIẾP TỤC"}
        </KioskButton>
      </form>
    </StepCard>
  );
}

export function DriverFoundStep({
  driver,
  onConfirm,
  onRetry,
}: {
  driver: DriverLookupResult;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  return (
    <StepCard eyebrow="Xác nhận thông tin" title={driver.name}>
      <div className="mb-8 space-y-2 font-body text-lg text-ink/80">
        {driver.sap_id && <p>SAP ID: {driver.sap_id}</p>}
        {driver.contract_type && <p>Loại hợp đồng: {driver.contract_type}</p>}
      </div>
      <div className="space-y-4">
        <KioskButton onClick={onConfirm}>ĐÚNG, TIẾP TỤC</KioskButton>
        <KioskButton variant="secondary" onClick={onRetry}>
          Không phải tôi — nhập lại
        </KioskButton>
      </div>
    </StepCard>
  );
}

// ---------------------------------------------------------------------
// Not found (Section 6)
// ---------------------------------------------------------------------
export function NotFoundStep({ onRetry }: { onRetry: () => void }) {
  return (
    <StepCard title="Không tìm thấy thông tin tài xế">
      <p className="mb-8 font-body text-lg text-ink/80">
        Vui lòng liên hệ nhân viên Green SM để được hỗ trợ.
      </p>
      <KioskButton onClick={onRetry}>THỬ LẠI</KioskButton>
    </StepCard>
  );
}

// ---------------------------------------------------------------------
// Branch selection — only shown if the kiosk isn't pre-bound (Section 7)
// ---------------------------------------------------------------------
export function BranchStep({
  branches,
  onSelect,
}: {
  branches: Branch[];
  onSelect: (b: Branch) => void;
}) {
  return (
    <StepCard eyebrow="Bước 2" title="Chọn văn phòng">
      <div className="space-y-4">
        {branches.map((b) => (
          <KioskButton
            key={b.id}
            variant="secondary"
            onClick={() => onSelect(b)}
          >
            {b.branch_name}
          </KioskButton>
        ))}
      </div>
    </StepCard>
  );
}

// ---------------------------------------------------------------------
// Category / Subcategory (Section 8-9) — loaded from DB, never hardcoded
// ---------------------------------------------------------------------
export function CategoryStep({
  categories,
  onSelect,
}: {
  categories: ServiceCategory[];
  onSelect: (c: ServiceCategory) => void;
}) {
  return (
    <StepCard eyebrow="Bước 3" title="Bạn cần hỗ trợ về vấn đề gì?">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {categories.map((c) => (
          <KioskButton
            key={c.id}
            variant="secondary"
            onClick={() => onSelect(c)}
          >
            {c.name}
          </KioskButton>
        ))}
      </div>
    </StepCard>
  );
}

export function SubcategoryStep({
  categoryName,
  subcategories,
  onSelect,
  onBack,
}: {
  categoryName: string;
  subcategories: ServiceSubcategory[];
  onSelect: (s: ServiceSubcategory) => void;
  onBack: () => void;
}) {
  return (
    <StepCard eyebrow={`Bước 4 · ${categoryName}`} title="Chọn nhu cầu cụ thể">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {subcategories.map((s) => (
          <KioskButton
            key={s.id}
            variant="secondary"
            onClick={() => onSelect(s)}
          >
            {s.name}
          </KioskButton>
        ))}
      </div>
      <button
        onClick={onBack}
        className="mt-6 font-body text-base text-brand-700 underline underline-offset-4"
      >
        ← Quay lại chọn nhóm khác
      </button>
    </StepCard>
  );
}

// ---------------------------------------------------------------------
// Description (Section 10)
// ---------------------------------------------------------------------
export function DescriptionStep({
  onSubmit,
}: {
  onSubmit: (description: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <StepCard
      eyebrow="Bước 5"
      title="Mô tả ngắn vấn đề của bạn"
      subtitle="Không bắt buộc, nhưng giúp nhân viên hỗ trợ nhanh hơn."
    >
      <div className="space-y-6">
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder="Ví dụ: Tôi chưa nhận được tiền đối soát."
          className="w-full rounded-card border-2 border-line px-6 py-4 text-xl font-body focus:border-brand-700"
        />
        <KioskButton onClick={() => onSubmit(value.trim())}>
          XÁC NHẬN CHECK-IN
        </KioskButton>
      </div>
    </StepCard>
  );
}

// ---------------------------------------------------------------------
// Success (Section 11) — the one signature moment: the ticket reveal
// ---------------------------------------------------------------------
export function SuccessStep({
  queueNumber,
  categoryName,
  ticketCode,
  onDone,
}: {
  queueNumber: string;
  categoryName: string;
  ticketCode: string;
  onDone: () => void;
}) {
  return (
    <StepCard eyebrow="Check-in thành công" title="Số của bạn">
      <div className="my-4 rounded-card bg-brand-100 py-10 text-center">
        <span className="font-display text-8xl font-extrabold tracking-wide text-brand-900">
          {queueNumber}
        </span>
      </div>
      <p className="mb-2 text-center font-body text-lg text-ink/80">
        Bộ phận: {categoryName}
        <br />
        Vui lòng chờ được gọi.
      </p>
      <p className="mb-8 text-center font-body text-xs text-ink/40">
        Mã ticket: {ticketCode} (dùng để đánh giá dịch vụ sau khi hoàn tất)
      </p>
      <KioskButton onClick={onDone}>HOÀN TẤT</KioskButton>
    </StepCard>
  );
}

export function ErrorStep({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <StepCard title="Có lỗi xảy ra">
      <p className="mb-8 font-body text-lg text-danger">{message}</p>
      <KioskButton onClick={onRetry}>THỬ LẠI</KioskButton>
    </StepCard>
  );
}
