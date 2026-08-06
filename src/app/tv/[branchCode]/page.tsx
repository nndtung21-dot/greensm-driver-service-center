"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { NowServingRow } from "@/lib/types";

// Thu sẵn từng từ bằng espeak-ng (giọng tiếng Việt Miền Nam) — phát ghép lại
// khi có số mới, không phụ thuộc giọng đọc cài sẵn trên máy/trình duyệt.
const CLIP_BASE = "/audio/tv/";
const DIGIT_CLIP: Record<string, string> = {
  "0": "so_0",
  "1": "so_1",
  "2": "so_2",
  "3": "so_3",
  "4": "so_4",
  "5": "so_5",
  "6": "so_6",
  "7": "so_7",
  "8": "so_8",
  "9": "so_9",
  A: "chu_a",
};

function buildAnnouncementClips(queueNumber: string, counterCode: string | null): string[] {
  const clips: string[] = ["intro"];
  for (const ch of queueNumber.toUpperCase()) {
    if (DIGIT_CLIP[ch]) clips.push(DIGIT_CLIP[ch]);
  }
  if (counterCode) {
    clips.push("den_quay_so");
    for (const ch of counterCode) {
      if (DIGIT_CLIP[ch]) clips.push(DIGIT_CLIP[ch]);
    }
  } else {
    clips.push("quay_phuc_vu");
  }
  return clips;
}

function playSequence(clipNames: string[]) {
  if (typeof window === "undefined" || clipNames.length === 0) return;
  let i = 0;
  const audio = new Audio();
  const playNext = () => {
    if (i >= clipNames.length) return;
    audio.src = `${CLIP_BASE}${clipNames[i]}.mp3`;
    i += 1;
    audio.play().catch(() => {
      /* trình duyệt chặn autoplay tới khi có tương tác đầu tiên trên trang */
    });
  };
  audio.addEventListener("ended", playNext);
  playNext();
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
      playSequence(buildAnnouncementClips(top.queue_number, top.counter_code));
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
