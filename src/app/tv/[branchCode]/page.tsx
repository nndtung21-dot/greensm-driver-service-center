"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

/* ============================================================
   TYPES
   ============================================================ */

type CounterStatusRow = {
  counter_code: string;
  counter_name: string;
  counter_status: "OPEN" | "CLOSED" | "AVAILABLE" | "BUSY" | "OFFLINE" | string;
  agent_id: string | null;
  agent_name: string | null;
  queue_number: string | null;
  called_at: string | null;
  display_order: number;
};

type AgentQueueRow = {
  agent_id: string | null;
  counter_code?: string | null;
  counter_name?: string | null;
  ticket_code: string;
  queue_number: string;
  driver_name: string;
  created_at: string;
  status?: string | null;
};

type SpeechJob = {
  id: string;
  text: string;
};

/* ============================================================
   HELPERS
   ============================================================ */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeQueue(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function cleanDriverName(driverName: string | null | undefined): string {
  if (!driverName) return "";
  let name = driverName.trim();
  if (name.includes("@")) {
    name = name.split("@")[0] ?? "";
  }
  return name.replace(/[._-]/g, " ").replace(/\s+/g, " ").trim();
}

/* ============================================================
   AUDIO ENGINE (HYBRID SPEECH + GOOGLE MP3 FALLBACK)
   ============================================================ */

function useTvSpeech() {
  const queueRef = useRef<SpeechJob[]>([]);
  const speakingRef = useRef(false);
  const unlockedRef = useRef(false);
  const audioObjRef = useRef<HTMLAudioElement | null>(null);

  const [unlocked, setUnlocked] = useState(false);

  const playGoogleTtsMp3 = useCallback((text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const encodedText = encodeURIComponent(text);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=vi&client=tw-ob`;

      if (!audioObjRef.current) {
        audioObjRef.current = new Audio();
      }

      const audio = audioObjRef.current;
      audio.src = url;
      audio.playbackRate = 0.95;

      const onEnded = () => {
        cleanup();
        resolve();
      };

      const onError = (e: Event) => {
        cleanup();
        reject(e);
      };

      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }, []);

  const playWebSpeech = useCallback((text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        reject(new Error("WebSpeech API không khả dụng"));
        return;
      }

      const synthesis = window.speechSynthesis;
      synthesis.cancel();

      const voices = synthesis.getVoices();
      const viVoices = voices.filter((v) =>
        v.lang.toLowerCase().replace("_", "-").startsWith("vi")
      );

      if (!viVoices.length) {
        reject(new Error("Không tìm thấy Giọng Tiếng Việt hệ thống"));
        return;
      }

      const femaleVoice =
        viVoices.find((v) => {
          const name = v.name.toLowerCase();
          return (
            name.includes("female") ||
            name.includes("nữ") ||
            name.includes("hoaimy") ||
            name.includes("linh") ||
            name.includes("google")
          );
        }) || viVoices[0];

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "vi-VN";
      if (femaleVoice) utterance.voice = femaleVoice;
      utterance.rate = 0.9;
      utterance.pitch = 1.1;

      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        utterance.onend = null;
        utterance.onerror = null;
        resolve();
      };

      const fail = (err: SpeechSynthesisErrorEvent) => {
        if (finished) return;
        finished = true;
        utterance.onend = null;
        utterance.onerror = null;
        reject(new Error(`WebSpeech error: ${err.error}`));
      };

      utterance.onend = finish;
      utterance.onerror = fail;

      synthesis.speak(utterance);
    });
  }, []);

  const speakText = useCallback(
    async (text: string) => {
      try {
        await playWebSpeech(text);
      } catch {
        try {
          await playGoogleTtsMp3(text);
        } catch (mp3Err) {
          console.error("[AUDIO ENGINE] Thất bại:", mp3Err);
        }
      }
    },
    [playWebSpeech, playGoogleTtsMp3]
  );

  const unlock = useCallback(async () => {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const testUtterance = new SpeechSynthesisUtterance("");
        window.speechSynthesis.speak(testUtterance);
      }

      if (!audioObjRef.current) {
        audioObjRef.current = new Audio();
      }
      audioObjRef.current.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      await audioObjRef.current.play();

      unlockedRef.current = true;
      setUnlocked(true);
      return true;
    } catch {
      unlockedRef.current = true;
      setUnlocked(true);
      return false;
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (speakingRef.current || !unlockedRef.current || queueRef.current.length === 0) {
      return;
    }

    speakingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift();
        if (!job) continue;

        for (let repeat = 1; repeat <= 2; repeat++) {
          if (!unlockedRef.current) break;
          await speakText(job.text);
          if (repeat === 1) await delay(800);
        }

        await delay(600);
      }
    } finally {
      speakingRef.current = false;
      if (unlockedRef.current && queueRef.current.length > 0) {
        void processQueue();
      }
    }
  }, [speakText]);

  const enqueue = useCallback(
    (queueNumber: string, driverName: string, counterName: string) => {
      const cleanName = cleanDriverName(driverName);
      const counterClean = counterName.replace(/quầy/i, "").trim();

      const text = cleanName
        ? `Mời tài xế số ${queueNumber}, ${cleanName}, đến quầy ${counterClean}`
        : `Mời tài xế số ${queueNumber}, đến quầy ${counterClean}`;

      const id = `${counterName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      queueRef.current.push({ id, text });

      if (unlockedRef.current) {
        void processQueue();
      }
    },
    [processQueue]
  );

  useEffect(() => {
    if (unlocked) void processQueue();
  }, [unlocked, processQueue]);

  return { enqueue, unlock, unlocked };
}

/* ============================================================
   MAIN TV COMPONENT (FIX FULL RESPONSIVE LAPTOP + TV 65 INCH)
   ============================================================ */

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const branchCode = params.branchCode;

  const [counters, setCounters] = useState<CounterStatusRow[]>([]);
  const [agentQueue, setAgentQueue] = useState<AgentQueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  const announcedCalls = useRef<Set<string>>(new Set());

  const { enqueue: enqueueAudio, unlock: unlockAudio, unlocked } = useTvSpeech();

  const loadCounters = useCallback(async () => {
    const { data } = await supabase.rpc("tv_counter_status", {
      p_branch_code: branchCode,
    });
    const result = ((data ?? []) as CounterStatusRow[])
      .slice()
      .sort((a, b) => a.display_order - b.display_order);
    setCounters(result);
    return result;
  }, [branchCode]);

  // Nâng cấp: Lấy toàn bộ danh sách check-in trong ngày
  const loadAgentQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from("agent_queues")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[SUPABASE ERROR] Lỗi tải agent_queues:", error.message);
      return [];
    }

    const result = (data ?? []) as AgentQueueRow[];
    setAgentQueue(result);
    return result;
  }, []);

  const handleCalls = useCallback(
    (counterList: CounterStatusRow[], queueList: AgentQueueRow[]) => {
      const activeCalls = counterList.filter(
        (c) => Boolean(c.queue_number) && Boolean(c.called_at)
      );

      for (const call of activeCalls) {
        if (!call.queue_number || !call.called_at) continue;

        const callKey = `${call.counter_code}:${call.called_at}`;
        if (announcedCalls.current.has(callKey)) continue;

        const targetQueue = normalizeQueue(call.queue_number);
        const driver = queueList.find(
          (q) => normalizeQueue(q.queue_number) === targetQueue
        );

        const rawDriverName = driver?.driver_name || call.agent_name || "";
        const counterName = call.counter_name?.trim() || call.counter_code;

        announcedCalls.current.add(callKey);
        enqueueAudio(call.queue_number, rawDriverName, counterName);
      }
    },
    [enqueueAudio]
  );

  const refresh = useCallback(async () => {
    try {
      const [counterList, queueList] = await Promise.all([
        loadCounters(),
        loadAgentQueue(),
      ]);
      setLoading(false);
      handleCalls(counterList, queueList);
    } catch (err) {
      console.error("[TV ERROR]:", err);
    }
  }, [loadCounters, loadAgentQueue, handleCalls]);

  useEffect(() => {
    void refresh();

    const channel = supabase
      .channel(`tv-realtime-${branchCode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_queues" },
        () => void refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "counters" },
        () => void refresh()
      )
      .subscribe();

    const interval = setInterval(() => void refresh(), 2000);

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [branchCode, refresh]);

  /* 
    Sửa chuẩn Logic Lọc Hàng Chờ:
    Chỉ ẩn số nếu số đó đang hiển thị Gọi trực tiếp ở màn hình chính của Quầy,
    hoặc đã DONE / CANCELLED.
  */
  const waitingQueue = useMemo(() => {
    const activeCallingNumbers = new Set(
      counters
        .map((c) => normalizeQueue(c.queue_number))
        .filter((num) => Boolean(num) && num !== "---")
    );

    return agentQueue.filter((q) => {
      const qNum = normalizeQueue(q.queue_number);
      if (!qNum) return false;

      // Nếu số đang được hiển thị ở màn hình lớn của quầy -> Ẩn khỏi hàng chờ
      if (activeCallingNumbers.has(qNum)) return false;

      // Ẩn các trạng thái hoàn tất/hủy
      const st = (q.status ?? "").trim().toUpperCase();
      if (["DONE", "CANCELLED", "COMPLETED", "FINISHED"].includes(st)) {
        return false;
      }

      return true;
    });
  }, [agentQueue, counters]);

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-slate-950 text-white font-black text-2xl">
        ĐANG KHỞI ĐỘNG HỆ THỐNG MÀN HÌNH...
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-slate-950 text-white font-sans overflow-hidden select-none p-3 lg:p-4 flex flex-col gap-3 lg:gap-4">
      {/* HEADER RESPONISVE */}
      <header className="w-full h-[8vh] min-h-[50px] bg-slate-900 border border-slate-800 rounded-xl px-4 lg:px-8 flex items-center justify-between shrink-0">
        <h1 className="text-xl lg:text-3xl font-black text-amber-400 tracking-wider uppercase">
          HỆ THỐNG GỌI SỐ TỰ ĐỘNG
        </h1>

        <div className="flex items-center gap-4">
          {!unlocked ? (
            <button
              onClick={() => void unlockAudio()}
              className="px-4 py-2 bg-amber-500 text-slate-950 font-black text-sm lg:text-lg rounded-lg animate-bounce shadow-lg shadow-amber-500/50 cursor-pointer"
            >
              🔊 BẬT ÂM THANH TV
            </button>
          ) : (
            <span className="text-emerald-400 font-bold text-xs lg:text-base flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500 animate-ping"></span>
              ÂM THANH SẴN SÀNG
            </span>
          )}
        </div>
      </header>

      {/* BODY DISPLAY: Flex Layout co giãn tự động theo kích thước màn hình */}
      <main className="w-full flex-1 flex flex-col lg:flex-row gap-3 lg:gap-4 overflow-hidden">
        {/* CỘT TRÁI (QUẦY PHỤC VỤ): Chiếm 60% trên Laptop/TV */}
        <section className="w-full lg:w-[60%] h-full grid grid-cols-2 gap-3 lg:gap-4 auto-rows-fr">
          {counters.map((counter) => {
            const isCalling = Boolean(counter.called_at && counter.queue_number);
            const driverName = cleanDriverName(counter.agent_name);

            return (
              <div
                key={counter.counter_code}
                className={`w-full h-full flex flex-col justify-between p-3 lg:p-5 rounded-2xl border-2 transition-all overflow-hidden ${
                  isCalling
                    ? "bg-slate-900 border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.3)]"
                    : "bg-slate-900/70 border-slate-800"
                }`}
              >
                {/* Tên quầy */}
                <div className="w-full flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-lg lg:text-2xl font-extrabold text-slate-200 truncate">
                    {counter.counter_name}
                  </span>
                  <span
                    className={`text-xs lg:text-sm font-bold px-2 py-0.5 rounded border ${
                      counter.counter_status === "OPEN" || counter.counter_status === "AVAILABLE"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                        : "bg-slate-800 text-slate-400 border-transparent"
                    }`}
                  >
                    {counter.counter_status}
                  </span>
                </div>

                {/* Số lượt hiển thị */}
                <div className="w-full flex-1 flex items-center justify-center my-1">
                  <span
                    className={`text-5xl lg:text-8xl font-black font-mono leading-none tracking-tight ${
                      isCalling ? "text-amber-400 animate-pulse" : "text-white"
                    }`}
                  >
                    {counter.queue_number || "---"}
                  </span>
                </div>

                {/* Tên tài xế */}
                <div className="w-full border-t border-slate-800 pt-2 text-sm lg:text-xl font-bold text-slate-400 truncate">
                  Tài xế: <span className="text-white">{driverName || "---"}</span>
                </div>
              </div>
            );
          })}
        </section>

        {/* CỘT PHẢI (DANH SÁCH CHỜ): Chiếm 40% trên Laptop/TV */}
        <section className="w-full lg:w-[40%] h-full bg-slate-900/80 border border-slate-800 rounded-2xl p-3 lg:p-5 flex flex-col overflow-hidden">
          <div className="w-full flex justify-between items-center border-b border-slate-800 pb-3 mb-3 shrink-0">
            <h2 className="text-lg lg:text-2xl font-black text-amber-400 uppercase tracking-wide">
              DANH SÁCH CHỜ
            </h2>
            <span className="bg-amber-500/20 text-amber-300 font-extrabold text-sm lg:text-xl px-3 py-1 rounded-full border border-amber-500/30">
              {waitingQueue.length}
            </span>
          </div>

          {/* Render mượt danh sách chờ có cuộn tự động nếu danh sách dài */}
          <div className="w-full flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {waitingQueue.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-base lg:text-xl font-bold text-slate-600 italic">
                Chưa có tài xế check-in
              </div>
            ) : (
              waitingQueue.map((item) => {
                const driver = cleanDriverName(item.driver_name);
                return (
                  <div
                    key={item.ticket_code || item.queue_number}
                    className="w-full bg-slate-950 border border-slate-800/90 p-3 lg:p-4 rounded-xl flex items-center justify-between"
                  >
                    <span className="text-2xl lg:text-4xl font-black font-mono text-emerald-400 leading-none">
                      {item.queue_number}
                    </span>
                    <div className="text-right truncate max-w-[65%]">
                      <p className="text-sm lg:text-lg font-bold text-slate-100 truncate">
                        {driver || "Tài xế"}
                      </p>
                      <p className="text-xs lg:text-sm font-mono text-slate-400">
                        {new Date(item.created_at).toLocaleTimeString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
