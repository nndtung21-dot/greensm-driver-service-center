"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

/*
 * TÌM VÉ — dán mã ticket (VD: T01202608251A001) để nhảy thẳng tới
 * trang chi tiết. Dùng chung cho Agent/Supervisor/Admin vì cả 3 role
 * đều được phép vào /agent/ticket/[id] (layout đã cho phép), và
 * v_case_detail đã tự lọc đúng theo VP/quyền qua RLS — không cần biết
 * người dùng đang ở portal nào.
 */
export function TicketSearchBox() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSearch() {
    const trimmed = code.trim();

    if (!trimmed) {
      setError("Nhập mã ticket trước đã.");
      return;
    }

    setBusy(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("v_case_detail")
      .select("case_id")
      .eq("ticket_code", trimmed)
      .maybeSingle();

    setBusy(false);

    if (queryError || !data) {
      setError("Không tìm thấy ticket với mã này.");
      return;
    }

    router.push(`/agent/ticket/${data.case_id}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSearch();
          }
        }}
        placeholder="Tìm vé theo mã ticket..."
        className="w-56 rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm focus:border-brand-700"
      />

      <button
        type="button"
        onClick={handleSearch}
        disabled={busy}
        className="rounded-lg border-2 border-line bg-white px-3 py-1.5 font-body text-sm font-semibold text-brand-900 transition-colors hover:border-brand-500 disabled:opacity-40"
      >
        Tìm
      </button>

      {error && (
        <span className="font-body text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
