"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
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
      subtitle="Nhập SAP ID hoặc Biển số xe đã đăng ký."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <input
          autoFocus
          type="text"
          autoCapitalize="characters"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="SAP ID hoặc Biển số xe"
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
        {driver.driver_type && <p>Loại tài xế: {driver.driver_type}</p>}
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
export function NeedsStep({
  categories,
  fetchSubcategories,
  onContinue,
}: {
  categories: ServiceCategory[];
  fetchSubcategories: (categoryId: string) => Promise<ServiceSubcategory[]>;
  onContinue: (category: ServiceCategory, subcategory: ServiceSubcategory | null) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [subcategoryId, setSubcategoryId] = useState("");
  const [loadingSub, setLoadingSub] = useState(false);

  useEffect(() => {
    if (!categoryId) {
      setSubcategories([]);
      setSubcategoryId("");
      return;
    }
    let active = true;
    setLoadingSub(true);
    fetchSubcategories(categoryId).then((subs) => {
      if (!active) return;
      setSubcategories(subs);
      setSubcategoryId("");
      setLoadingSub(false);
    });
    return () => {
      active = false;
    };
  }, [categoryId, fetchSubcategories]);

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const selectedSubcategory = subcategories.find((s) => s.id === subcategoryId) ?? null;
  const canContinue = !!selectedCategory && (subcategories.length === 0 || !!selectedSubcategory);

  return (
    <StepCard eyebrow="Bước 3" title="Bạn cần hỗ trợ về vấn đề gì?">
      <div className="space-y-5">
        <div>
          <label className="mb-2 block font-body text-base text-ink/70">Chủ đề</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-card border-2 border-line bg-white px-6 py-5 text-xl font-body focus:border-brand-700"
          >
            <option value="">— Chọn chủ đề —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 block font-body text-base text-ink/70">Nhu cầu cụ thể</label>
          <select
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={!categoryId || loadingSub}
            className="w-full rounded-card border-2 border-line bg-white px-6 py-5 text-xl font-body focus:border-brand-700 disabled:opacity-50"
          >
            <option value="">
              {!categoryId
                ? "— Chọn chủ đề trước —"
                : loadingSub
                ? "Đang tải..."
                : subcategories.length === 0
                ? "— Không có mục con —"
                : "— Chọn nhu cầu cụ thể —"}
            </option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <KioskButton
          disabled={!canContinue}
          onClick={() => selectedCategory && onContinue(selectedCategory, selectedSubcategory)}
        >
          TIẾP TỤC
        </KioskButton>
      </div>
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
const TICKET_STATUS_LABELS: Record<string, string> = {
  WAITING: "Đang chờ được gọi",
  CALLED: "Đang được mời đến quầy",
  PROCESSING: "Đang được xử lý",
  PENDING: "Tạm hoãn — đang chờ thêm thông tin",
  TRANSFERRED: "Đang được chuyển xử lý",
  RESOLVED: "Đã xử lý xong",
  CLOSED: "Đã hoàn tất",
  CANCELLED: "Đã huỷ",
  NO_SHOW: "Đã đánh dấu vắng mặt",
};

export function SuccessStep({
  queueNumber,
  categoryName,
  ticketCode,
  onReset,
}: {
  queueNumber: string;
  categoryName: string;
  ticketCode: string;
  onReset: () => void;
}) {
  const [status, setStatus] = useState<string>("WAITING");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      const { data } = await supabase
        .rpc("lookup_ticket_for_feedback", { p_ticket_code: ticketCode })
        .maybeSingle();
      if (!active || !data) return;
      setStatus(data.status);
      setCaseId(data.case_id);
      setAlreadyRated(data.already_rated);
    }
    poll();
    const interval = setInterval(poll, 6000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [ticketCode]);

  async function handleSubmitFeedback() {
    if (rating === 0 || !caseId) return;
    setSubmitting(true);
    setFeedbackError(null);
    const { error } = await supabase.rpc("submit_feedback", {
      p_case_id: caseId,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      setFeedbackError(error.message);
      return;
    }
    setSubmitted(true);
  }

  const isDone = status === "RESOLVED" || status === "CLOSED";
  const showFeedbackForm = isDone && !alreadyRated && !submitted;

  return (
    <StepCard eyebrow="Check-in thành công" title="Số của bạn">
      <div className="my-4 rounded-card bg-brand-100 py-10 text-center">
        <span className="font-display text-8xl font-extrabold tracking-wide text-brand-900">
          {queueNumber}
        </span>
      </div>
      <p className="mb-2 text-center font-body text-lg text-ink/80">
        Bộ phận: {categoryName}
      </p>
      <p className="mb-6 text-center font-body text-base font-semibold text-brand-700">
        {TICKET_STATUS_LABELS[status] ?? status}
      </p>

      {!isDone && (
        <p className="text-center font-body text-xs text-ink/40">
          Màn hình này sẽ tự cập nhật — bạn có thể yên tâm đợi ở đây, không cần thao tác gì thêm.
        </p>
      )}

      {isDone && alreadyRated && !submitted && (
        <p className="text-center font-body text-ink/60">Cảm ơn bạn đã đánh giá dịch vụ!</p>
      )}

      {showFeedbackForm && (
        <div className="mt-2 border-t border-line pt-6">
          <p className="mb-4 text-center font-body text-lg font-semibold text-ink">
            Bạn đánh giá chất lượng phục vụ hôm nay như thế nào?
          </p>
          <div className="mb-4 flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className={`text-4xl transition-transform hover:scale-110 ${
                  star <= rating ? "text-warn" : "text-line"
                }`}
                aria-label={`${star} sao`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Nhận xét thêm (không bắt buộc)"
            className="mb-4 w-full rounded-lg border-2 border-line px-4 py-3 font-body text-base focus:border-brand-700"
          />
          {feedbackError && (
            <p className="mb-3 text-center font-body text-sm text-danger">{feedbackError}</p>
          )}
          <KioskButton onClick={handleSubmitFeedback} disabled={submitting || rating === 0}>
            {submitting ? "Đang gửi..." : "GỬI ĐÁNH GIÁ"}
          </KioskButton>
        </div>
      )}

      {submitted && (
        <p className="mt-2 text-center font-body text-lg font-semibold text-brand-900">
          Cảm ơn bạn đã đánh giá!
        </p>
      )}

      <button
        onClick={onReset}
        className="mt-8 block w-full text-center font-body text-sm text-ink/40 underline underline-offset-4"
      >
        Check-in cho tài xế khác
      </button>
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
