"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type CounterStatusRow = {
  counter_code: string;
  counter_name: string;
  counter_status: "OPEN" | "CLOSED" | "AVAILABLE" | "BUSY" | "OFFLINE";
  agent_id: string | null;
  agent_name: string | null;
  queue_number: string | null;
  called_at: string | null;
};

type AgentQueueRow = {
  agent_id: string | null;
  ticket_code: string;
  queue_number: string;
  driver_name: string;
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

const DIGIT_WORD: Record<string, string> = {
  "0": "không", "1": "một", "2": "hai", "3": "ba", "4": "bốn",
  "5": "năm", "6": "sáu", "7": "bảy", "8": "tám", "9": "chín", A: "a",
};

function buildAnnouncementText(queueNumber: string, counterCode: string): string {
  const qWords = [...queueNumber.toUpperCase()].map((ch) => DIGIT_WORD[ch] ?? ch).join(" ");
  const cWords = [...counterCode].map((ch) => DIGIT_WORD[ch] ?? ch).join(" ");
  return `Kính mời tài xế có số ${qWords} đến quầy số ${cWords}`;
}

// Hàng đợi thông báo: mỗi lượt gọi số ưu tiên thử giọng Google (tự nhiên hơn)
// trước, nếu lỗi/bị chặn thì tự chuyển sang giọng thu sẵn (espeak). Xử lý
// tuần tự nên nhiều số gọi dồn dập vẫn không chồng tiếng nhau.
function useAnnouncer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const playingRef = useRef(false);

  const playLocalClips = useCallback((clipNames: string[]) => {
    return new Promise<void>((resolve) => {
      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      let i = 0;
      const playNext = () => {
        if (i >= clipNames.length) {
          resolve();
          return;
        }
        audio.src = `${CLIP_BASE}${clipNames[i]}.mp3`;
        i += 1;
        audio.onended = playNext;
        audio.play().catch(() => resolve());
      };
      playNext();
    });
  }, []);

  const playRemote = useCallback((url: string) => {
    return new Promise<void>((resolve, reject) => {
      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      audio.src = url;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback error"));
      audio.play().catch(reject);
    });
  }, []);

  const processQueue = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (job) {
        try {
          await job();
        } catch {
          /* bỏ qua, chuyển sang lượt tiếp theo */
        }
      }
    }
    playingRef.current = false;
  }, []);

  const enqueue = useCallback(
    (queueNumber: string, counterCode: string) => {
      queueRef.current.push(async () => {
        try {
          const text = buildAnnouncementText(queueNumber, counterCode);
          const res = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
          if (!res.ok) throw new Error("tts route failed");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          try {
            await playRemote(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch {
          await playLocalClips(buildAnnouncementClips(queueNumber, counterCode));
        }
      });
      processQueue();
    },
    [playRemote, playLocalClips, processQueue]
  );

  return enqueue;
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const [counters, setCounters] = useState<CounterStatusRow[]>([]);
  const [agentQueue, setAgentQueue] = useState<AgentQueueRow[]>([]);
  const lastAnnouncedAt = useRef<string | null>(null);
  const enqueueAudio = useAnnouncer();
  const clock = useClock();

  const load = useCallback(async () => {
    const [{ data: counterData }, { data: queueData }] = await Promise.all([
      supabase.rpc("tv_counters_status", { p_branch_code: params.branchCode }),
      supabase.rpc("tv_agent_queue_list", { p_branch_code: params.branchCode }),
    ]);
    const counterList = (counterData as CounterStatusRow[]) ?? [];
    setCounters(counterList);
    setAgentQueue((queueData as AgentQueueRow[]) ?? []);

    const newlyCalled = counterList
      .filter((c) => c.queue_number && c.called_at)
      .filter((c) => !lastAnnouncedAt.current || c.called_at! > lastAnnouncedAt.current!)
      .sort((a, b) => (a.called_at! < b.called_at! ? -1 : 1));

    for (const c of newlyCalled) {
      enqueueAudio(c.queue_number!, c.counter_code);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "service_cases" }, load)
      .subscribe();
    const interval = setInterval(load, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [params.branchCode, load]);

  const unassigned = agentQueue.filter((q) => !q.agent_id);
  const totalWaiting = agentQueue.length;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Thanh trên: kiểu bảng điện tử ngân hàng — nền trắng, viền dưới, logo bên trái */}
      <div className="flex items-center justify-between border-b border-line bg-white px-10 py-5 shadow-sm">
        <div>
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-brand-500">
            Green SM
          </p>
          <p className="font-display text-2xl font-bold text-brand-900">
            Driver Service Center
          </p>
        </div>
        <div className="flex items-center gap-8">
          {clock && (
            <div className="text-right">
              <p className="font-display text-3xl font-bold tabular-nums text-brand-900">
                {clock.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
              <p className="font-body text-sm capitalize text-ink/50">
                {clock.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            </div>
          )}
          <div className="rounded-xl bg-brand-100 px-5 py-3 text-center">
            <p className="font-body text-xs uppercase tracking-wide text-brand-700">Đang chờ</p>
            <p className="font-display text-3xl font-bold text-brand-900">{totalWaiting}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-10 py-8">
        {/* Theo từng quầy: đang phục vụ số mấy + hàng chờ riêng của quầy đó */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {counters.map((c) => {
            const busy = c.counter_status === "BUSY" && c.queue_number;
            const myWaiting = c.agent_id
              ? agentQueue.filter((q) => q.agent_id === c.agent_id)
              : [];
            return (
              <div
                key={c.counter_code}
                className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
              >
                <div className="bg-brand-700 px-5 py-2.5">
                  <p className="font-body text-sm font-semibold uppercase tracking-wide text-white">
                    {c.counter_name}
                    {c.agent_name ? ` · ${c.agent_name}` : ""}
                  </p>
                </div>
                <div className={`px-5 py-7 text-center ${busy ? "bg-brand-100" : "bg-paper"}`}>
                  <p className={`font-display text-6xl font-extrabold ${busy ? "text-brand-900" : "text-ink/25"}`}>
                    {busy ? c.queue_number : "—"}
                  </p>
                  {!busy && (
                    <p className="mt-1 font-body text-xs uppercase tracking-wide text-ink/40">
                      {c.counter_status === "AVAILABLE"
                        ? "Sẵn sàng"
                        : c.counter_status === "OFFLINE"
                        ? "Offline"
                        : "Đã đóng"}
                    </p>
                  )}
                </div>

                <div className="flex-1 border-t border-line px-5 py-4">
                  <p className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-ink/40">
                    Đang chờ ({myWaiting.length})
                  </p>
                  <div className="space-y-1.5">
                    {myWaiting.map((q) => (
                      <div
                        key={q.ticket_code}
                        className="flex items-baseline justify-between border-b border-line/60 pb-1 last:border-0"
                      >
                        <span className="font-display text-lg font-bold text-brand-900">
                          {q.queue_number}
                        </span>
                        <span className="font-body text-sm text-ink/70">{q.driver_name}</span>
                      </div>
                    ))}
                    {c.agent_id && myWaiting.length === 0 && (
                      <p className="font-body text-sm text-ink/30">Không có ai chờ.</p>
                    )}
                    {!c.agent_id && (
                      <p className="font-body text-sm text-ink/30">Quầy chưa gán Agent.</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {counters.length === 0 && (
            <p className="col-span-full font-body text-ink/40">Chưa có quầy nào được cấu hình.</p>
          )}
        </div>

        {unassigned.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="bg-warn/90 px-5 py-2.5">
              <p className="font-body text-sm font-semibold uppercase tracking-wide text-white">
                Chưa phân bổ Agent ({unassigned.length})
              </p>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-2 px-5 py-4">
              {unassigned.map((q) => (
                <div key={q.ticket_code} className="flex items-baseline gap-2">
                  <span className="font-display text-lg font-bold text-brand-900">
                    {q.queue_number}
                  </span>
                  <span className="font-body text-sm text-ink/70">{q.driver_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
