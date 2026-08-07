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
  const [agentQueue, setAgentQueue] = useState<AgentQueueRow[]>([]);
  const lastAnnouncedAt = useRef<string | null>(null);
  const enqueueAudio = useAudioQueue();

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
    <div className="flex min-h-screen flex-col bg-brand-900 px-10 py-8 text-white">
      <div className="mb-6 flex items-center justify-between">
        <p className="font-display text-2xl font-bold tracking-wide">
          GREEN SM DRIVER SERVICE CENTER
        </p>
        <p className="font-body text-xl text-white/70">
          Đang chờ: <span className="font-bold text-white">{totalWaiting}</span>
        </p>
      </div>

      {/* Theo từng quầy: đang phục vụ số mấy + hàng chờ riêng của quầy đó */}
      <div className="grid flex-1 grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {counters.map((c) => {
          const busy = c.counter_status === "BUSY" && c.queue_number;
          const myWaiting = c.agent_id
            ? agentQueue.filter((q) => q.agent_id === c.agent_id)
            : [];
          return (
            <div key={c.counter_code} className="flex flex-col rounded-2xl bg-white/5 p-5">
              <div
                className={`mb-4 rounded-xl px-4 py-5 text-center ${
                  busy ? "bg-brand-100 text-brand-900" : "bg-white/10 text-white/50"
                }`}
              >
                <p className="font-body text-sm uppercase tracking-wide">
                  {c.counter_name}
                  {c.agent_name ? ` · ${c.agent_name}` : ""}
                </p>
                <p className="mt-1 font-display text-5xl font-extrabold">
                  {busy ? c.queue_number : "—"}
                </p>
                {!busy && (
                  <p className="mt-1 font-body text-xs">
                    {c.counter_status === "AVAILABLE"
                      ? "Sẵn sàng"
                      : c.counter_status === "OFFLINE"
                      ? "Offline"
                      : "Đã đóng"}
                  </p>
                )}
              </div>

              <p className="mb-2 font-body text-xs uppercase tracking-wide text-white/50">
                Đang chờ ({myWaiting.length})
              </p>
              <div className="flex-1 space-y-1 overflow-y-auto">
                {myWaiting.map((q) => (
                  <p key={q.ticket_code} className="font-body text-sm">
                    <span className="font-semibold">{q.queue_number}</span>
                    <span className="text-white/60"> — {q.driver_name}</span>
                  </p>
                ))}
                {c.agent_id && myWaiting.length === 0 && (
                  <p className="font-body text-xs text-white/30">Không có ai chờ.</p>
                )}
                {!c.agent_id && (
                  <p className="font-body text-xs text-white/30">Quầy chưa gán Agent.</p>
                )}
              </div>
            </div>
          );
        })}
        {counters.length === 0 && (
          <p className="col-span-full font-body text-white/50">Chưa có quầy nào được cấu hình.</p>
        )}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-5 rounded-2xl bg-white/5 p-5">
          <p className="mb-2 font-body text-xs uppercase tracking-wide text-white/50">
            Chưa phân bổ Agent ({unassigned.length})
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {unassigned.map((q) => (
              <p key={q.ticket_code} className="font-body text-sm">
                <span className="font-semibold">{q.queue_number}</span>
                <span className="text-white/60"> — {q.driver_name}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
