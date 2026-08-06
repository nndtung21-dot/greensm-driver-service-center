"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type CounterStatusRow = {
  counter_code: string;
  counter_name: string;
  counter_status: "OPEN" | "CLOSED" | "AVAILABLE" | "BUSY" | "OFFLINE";
  queue_number: string | null;
  called_at: string | null;
};

type QueueListRow = {
  queue_number: string;
  status: "WAITING" | "PROCESSING";
  created_at: string;
};

// ---------------------------------------------------------------------
// Âm thanh: ghép các đoạn tiếng Việt thu sẵn (không phụ thuộc giọng máy)
// ---------------------------------------------------------------------
const CLIP_BASE = "/audio/tv/";
const DIGIT_CLIP: Record<string, string> = {
  "0": "so_0", "1": "so_1", "2": "so_2", "3": "so_3", "4": "so_4",
  "5": "so_5", "6": "so_6", "7": "so_7", "8": "so_8", "9": "so_9",
  A: "chu_a",
};

function buildAnnouncementClips(queueNumber: string, counterCode: string): string[] {
  const clips: string[] = ["intro"];
  for (const ch of queueNumber.toUpperCase()) {
    if (DIGIT_CLIP[ch]) clips.push(DIGIT_CLIP[ch]);
  }
  clips.push("den_quay_so");
  for (const ch of counterCode) {
    if (DIGIT_CLIP[ch]) clips.push(DIGIT_CLIP[ch]);
  }
  return clips;
}

// Hàng đợi phát audio toàn cục — nhiều lượt gọi số dồn dập vẫn phát tuần tự,
// không chồng tiếng lên nhau.
function useAudioQueue() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  const playNextClip = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = `${CLIP_BASE}${next}.mp3`;
    audioRef.current.onended = playNextClip;
    audioRef.current.play().catch(() => {
      playingRef.current = false;
    });
  }, []);

  const enqueue = useCallback(
    (clipNames: string[]) => {
      queueRef.current.push(...clipNames);
      if (!playingRef.current) playNextClip();
    },
    [playNextClip]
  );

  return enqueue;
}

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const [counters, setCounters] = useState<CounterStatusRow[]>([]);
  const [queueList, setQueueList] = useState<QueueListRow[]>([]);
  const lastAnnouncedAt = useRef<string | null>(null);
  const enqueueAudio = useAudioQueue();

  const load = useCallback(async () => {
    const [{ data: counterData }, { data: queueData }] = await Promise.all([
      supabase.rpc("tv_counters_status", { p_branch_code: params.branchCode }),
      supabase.rpc("tv_queue_list", { p_branch_code: params.branchCode }),
    ]);
    const counterList = (counterData as CounterStatusRow[]) ?? [];
    setCounters(counterList);
    setQueueList((queueData as QueueListRow[]) ?? []);

    // Thông báo mọi quầy vừa gọi số mới kể từ lần load trước, theo đúng thứ tự thời gian
    const newlyCalled = counterList
      .filter((c) => c.queue_number && c.called_at)
      .filter((c) => !lastAnnouncedAt.current || c.called_at! > lastAnnouncedAt.current!)
      .sort((a, b) => (a.called_at! < b.called_at! ? -1 : 1));

    for (const c of newlyCalled) {
      enqueueAudio(buildAnnouncementClips(c.queue_number!, c.counter_code));
    }
    if (newlyCalled.length > 0) {
      lastAnnouncedAt.current = newlyCalled[newlyCalled.length - 1].called_at;
    }
  }, [params.branchCode, enqueueAudio]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`tv-${params.branchCode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "counters" }, load)
      .subscribe();
    const interval = setInterval(load, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [params.branchCode, load]);

  const waitingCount = queueList.filter((q) => q.status === "WAITING").length;
  const waitingList = queueList.filter((q) => q.status === "WAITING");
  const processingList = queueList.filter((q) => q.status === "PROCESSING");

  return (
    <div className="flex min-h-screen flex-col bg-brand-900 px-10 py-8 text-white">
      <div className="mb-6 flex items-center justify-between">
        <p className="font-display text-2xl font-bold tracking-wide">
          GREEN SM DRIVER SERVICE CENTER
        </p>
        <p className="font-body text-xl text-white/70">
          Đang chờ: <span className="font-bold text-white">{waitingCount}</span>
        </p>
      </div>

      {/* Theo từng quầy */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {counters.map((c) => {
          const busy = c.counter_status === "BUSY" && c.queue_number;
          return (
            <div
              key={c.counter_code}
              className={`rounded-2xl px-6 py-6 text-center ${
                busy ? "bg-brand-100 text-brand-900" : "bg-white/10 text-white/50"
              }`}
            >
              <p className="font-body text-lg uppercase tracking-wide">{c.counter_name}</p>
              <p className="mt-2 font-display text-6xl font-extrabold">
                {busy ? c.queue_number : "—"}
              </p>
              {!busy && (
                <p className="mt-1 font-body text-sm">
                  {c.counter_status === "AVAILABLE" ? "Sẵn sàng" : c.counter_status === "OFFLINE" ? "Offline" : "Đã đóng"}
                </p>
              )}
            </div>
          );
        })}
        {counters.length === 0 && (
          <p className="col-span-full font-body text-white/50">Chưa có quầy nào được cấu hình.</p>
        )}
      </div>

      {/* Danh sách chờ / đang xử lý */}
      <div className="grid flex-1 grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-2xl bg-white/5 p-6">
          <p className="mb-4 font-body text-lg uppercase tracking-wide text-white/60">
            Đang chờ ({waitingList.length})
          </p>
          <div className="flex flex-wrap gap-3">
            {waitingList.map((q) => (
              <span
                key={q.queue_number}
                className="rounded-xl bg-white/10 px-5 py-3 font-display text-3xl font-bold"
              >
                {q.queue_number}
              </span>
            ))}
            {waitingList.length === 0 && (
              <p className="font-body text-white/40">Không có ai đang chờ.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white/5 p-6">
          <p className="mb-4 font-body text-lg uppercase tracking-wide text-white/60">
            Đang xử lý ({processingList.length})
          </p>
          <div className="flex flex-wrap gap-3">
            {processingList.map((q) => (
              <span
                key={q.queue_number}
                className="rounded-xl bg-brand-100 px-5 py-3 font-display text-3xl font-bold text-brand-900"
              >
                {q.queue_number}
              </span>
            ))}
            {processingList.length === 0 && (
              <p className="font-body text-white/40">Chưa có ticket nào đang xử lý.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
