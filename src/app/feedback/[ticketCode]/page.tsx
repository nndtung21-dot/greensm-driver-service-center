"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { FeedbackLookup } from "@/lib/types";

const CRITERIA = [
  { key: "time", label: "Thời gian hỗ trợ" },
  { key: "attitude", label: "Thái độ nhân viên hỗ trợ" },
  {
    key: "resolution",
    label: "Vấn đề Đối tác đã được ghi nhận hỗ trợ đầy đủ",
  },
] as const;

type CriterionKey = (typeof CRITERIA)[number]["key"];
type Ratings = Record<CriterionKey, number>;

export default function FeedbackPage() {
  const params = useParams<{ ticketCode: string }>();
  const [lookup, setLookup] = useState<FeedbackLookup | null | "not_found">(null);
  const [ratings, setRatings] = useState<Ratings>({
    time: 0,
    attitude: 0,
    resolution: 0,
  });
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .rpc("lookup_ticket_for_feedback", { p_ticket_code: params.ticketCode })
      .maybeSingle()
      .then(({ data }) => {
        setLookup((data as FeedbackLookup) ?? "not_found");
      });
  }, [params.ticketCode]);

  function setRating(key: CriterionKey, value: number) {
    setRatings((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  }

  async function handleSubmit() {
    const missing = CRITERIA.some((c) => ratings[c.key] === 0);
    if (missing) {
      setError("Vui lòng chọn đủ số sao cho cả 3 mục.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("submit_feedback_detailed", {
      p_case_id: (lookup as FeedbackLookup).case_id,
      p_rating_time: ratings.time,
      p_rating_attitude: ratings.attitude,
      p_rating_resolution: ratings.resolution,
      p_comment: comment.trim() || null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSubmitted(true);
  }

  if (lookup === null) {
    return <Shell><p className="font-body text-ink/50">Đang tải...</p></Shell>;
  }
  if (lookup === "not_found") {
    return (
      <Shell>
        <p className="font-body text-danger">Không tìm thấy ticket này.</p>
      </Shell>
    );
  }
  if (!["RESOLVED", "CLOSED"].includes(lookup.status)) {
    return (
      <Shell>
        <p className="font-body text-ink/70">
          Ticket của bạn chưa hoàn tất, chưa thể đánh giá lúc này.
        </p>
      </Shell>
    );
  }
  if (lookup.already_rated || submitted) {
    return (
      <Shell>
        <p className="font-display text-2xl font-bold text-brand-900">Cảm ơn bạn!</p>
        <p className="mt-2 font-body text-ink/70">Đánh giá của bạn đã được ghi nhận.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="mb-1 font-body text-sm text-ink/50">{lookup.queue_number}</p>
      <h1 className="mb-4 font-display text-2xl font-bold text-brand-900">
        Bạn đánh giá chất lượng phục vụ hôm nay như thế nào?
      </h1>

      <p className="mb-7 rounded-lg bg-brand-100 px-3.5 py-3 text-left font-body text-xs leading-relaxed text-brand-900">
        Để cải thiện chất lượng dịch vụ, kính nhờ quý đối tác thực hiện đánh
        giá khách quan nhất về các hạng mục hỗ trợ (kết quả sẽ được bảo mật,
        vui lòng không chia sẻ cho nhân viên hỗ trợ).
      </p>

      <div className="space-y-6 text-left">
        {CRITERIA.map((criterion) => (
          <div key={criterion.key}>
            <p className="mb-2 font-body text-sm font-semibold text-ink">
              {criterion.label}
            </p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() =>
                    setRating(criterion.key, star)
                  }
                  className={`text-4xl transition-transform hover:scale-110 ${
                    star <= ratings[criterion.key]
                      ? "text-warn"
                      : "text-line"
                  }`}
                  aria-label={`${star} sao — ${criterion.label}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Nhận xét thêm (không bắt buộc)"
        className="mb-4 mt-7 w-full rounded-lg border-2 border-line px-4 py-3 font-body text-base focus:border-brand-700"
      />
      {error && <p className="mb-4 font-body text-sm text-danger">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={busy}
        className="w-full rounded-card bg-brand-700 py-4 font-display text-xl font-semibold text-white hover:bg-brand-900 disabled:opacity-50"
      >
        {busy ? "Đang gửi..." : "GỬI ĐÁNH GIÁ"}
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-10 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}
