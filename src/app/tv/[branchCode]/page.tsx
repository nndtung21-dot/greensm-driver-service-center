"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { NowServingRow } from "@/lib/types";

function getVietnameseVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase() === "vi-vn") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("vi")) ??
    null
  );
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  const doSpeak = () => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "vi-VN";
    utter.rate = 0.95;
    const viVoice = getVietnameseVoice();
    if (viVoice) utter.voice = viVoice;
    window.speechSynthesis.cancel(); // tránh chồng câu nếu số mới gọi dồn dập
    window.speechSynthesis.speak(utter);
  };

  // Một số trình duyệt (đặc biệt Chrome) tải danh sách giọng đọc bất đồng bộ —
  // lần gọi đầu getVoices() có thể trả về mảng rỗng.
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => doSpeak();
  } else {
    doSpeak();
  }
}

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const [rows, setRows] = useState<NowServingRow[]>([]);
  const [waiting, setWaiting] = useState<number>(0);
  const lastAnnounced = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: serving }, { data: waitCount }] = await Promise.all([
      supabase.rpc("tv_now_serving", { p_branch_code: params.branchCode }),
      supabase.rpc("tv_waiting_count", { p_branch_code: params.branchCode }),
    ]);
    const list = (serving as NowServingRow[]) ?? [];
    setRows(list);
    setWaiting((waitCount as number) ?? 0);

    const top = list[0];
    if (top && top.queue_number !== lastAnnounced.current) {
      lastAnnounced.current = top.queue_number;
      const counterText = top.counter_code ? `quầy số ${top.counter_code}` : "quầy phục vụ";
      speak(`Kính mời tài xế có số ${top.queue_number.split("").join(" ")} đến ${counterText}.`);
    }
  }, [params.branchCode]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`tv-${params.branchCode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, load)
      .subscribe();
    // fallback poll in case a realtime event is missed
    const interval = setInterval(load, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [params.branchCode, load]);

  const [current, ...recent] = rows;

  return (
    <div className="flex min-h-screen flex-col bg-brand-900 px-12 py-10 text-white">
      <div className="mb-8 flex items-center justify-between">
        <p className="font-display text-2xl font-bold tracking-wide">
          GREEN SM DRIVER SERVICE CENTER
        </p>
        <p className="font-body text-xl text-white/70">
          Đang chờ: <span className="font-bold text-white">{waiting}</span>
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center">
        {current ? (
          <div className="text-center">
            <p className="mb-4 font-body text-3xl uppercase tracking-widest text-white/60">
              Đang phục vụ
            </p>
            <p className="font-display text-[14rem] font-extrabold leading-none">
              {current.queue_number}
            </p>
            <p className="mt-6 font-display text-6xl font-bold text-brand-100">
              → QUẦY {current.counter_code ?? "—"}
            </p>
          </div>
        ) : (
          <p className="font-display text-5xl text-white/50">Chưa có số nào được gọi</p>
        )}
      </div>

      {recent.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 font-body text-lg uppercase tracking-wide text-white/50">
            Vừa gọi gần đây
          </p>
          <div className="flex gap-4">
            {recent.map((r) => (
              <div
                key={r.queue_number + r.called_at}
                className="rounded-2xl bg-white/10 px-6 py-4 text-center"
              >
                <p className="font-display text-4xl font-bold">{r.queue_number}</p>
                <p className="font-body text-sm text-white/60">Quầy {r.counter_code ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
