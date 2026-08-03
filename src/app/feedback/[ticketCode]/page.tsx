"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { FeedbackLookup } from "@/lib/types";

export default function FeedbackPage() {
  const params = useParams<{ ticketCode: string }>();
  const [lookup, setLookup] = useState<FeedbackLookup | null | "not_found">(null);
  const [rating, setRating] = useState(0);
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

  async function handleSubmit() {
    if (rating === 0) {
      setError("Vui lòng chọn số sao.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("submit_feedback", {
      p_case_id: (lookup as FeedbackLookup).case_id,
      p_rating: rating,
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
      <h1 className="mb-6 font-display text-2xl font-bold text-brand-900">
        Bạn đánh giá chất lượng phục vụ hôm nay như thế nào?
      </h1>
      <div className="mb-6 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => setRating(star)}
            className={`text-5xl transition-transform hover:scale-110 ${
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
        rows={3}
        placeholder="Nhận xét thêm (không bắt buộc)"
        className="mb-4 w-full rounded-lg border-2 border-line px-4 py-3 font-body text-base focus:border-brand-700"
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
