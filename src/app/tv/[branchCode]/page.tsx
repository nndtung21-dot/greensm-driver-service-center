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
   AUDIO ENGINE (SPEECH + GOOGLE MP3 FALLBACK CHO SMART TV)
   ============================================================ */

function useTvSpeech() {
  const queueRef = useRef<SpeechJob[]>([]);
  const speakingRef = useRef(false);
  const unlockedRef = useRef(false);
  const audioObjRef = useRef<HTMLAudioElement | null>(null);

  const [unlocked, setUnlocked] = useState(false);

  // Phát file MP3 giọng Nữ Google qua Proxy/API Online
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

  // Web Speech API
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
   MAIN TV COMPONENT (FULL FIX WIDTH & SCALE CHO TV & LAPTOP)
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

  const loadAgentQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from("agent_queues")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[TV ERROR]: Lỗi fetch agent_queues:", error.message);
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
    ============================================================
    FIX CHUẨN LOGIC HÀNG CHỜ
    ============================================================
  */
  const waitingQueue = useMemo(() => {
    // Tập hợp những số ĐANG ĐƯỢC GỌI ở các quầy
    const callingNumbers = new Set(
      counters
        .map((c) => normalizeQueue(c.queue_number))
        .filter((num) => Boolean(num) && num !== "---")
    );

    return agentQueue.filter((q) => {
      const qNum = normalizeQueue(q.queue_number);
      if (!qNum) return false;

      // 1. Bỏ qua nếu số này đang nằm trên bảng gọi số của quầy
      if (callingNumbers.has(qNum)) return false;

      // 2. Chỉ bỏ qua nếu phiếu đã HOÀN THÀNH hoặc HỦY
      const status = (q.status ?? "").trim().toUpperCase();
      if (["DONE", "CANCELLED", "COMPLETED", "FINISHED"].includes(status)) {
        return false;
      }

      // Còn lại (WAITING, PENDING, CALLING, CHECKED_IN, NULL,...) giữ lại hiển thị ở Hàng Chờ
      return true;
    });
  }, [agentQueue, counters]);

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-slate-950 text-white font-black text-[3vw]">
        ĐANG KHỞI ĐỘNG HỆ THỐNG TV...
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-slate-950 text-white font-sans overflow-hidden select-none p-[1.5vh] flex flex-col justify-between gap-[1.5vh]">
      {/* HEADER: Chiều cao cố định 10% màn hình */}
      <header className="w-full h-[10vh] bg-slate-900 border-2 border-slate-800 rounded-2xl px-[2vw] flex items-center justify-between shrink-0">
        <h1 className="text-[2.2vw] font-black text-amber-400 tracking-wider uppercase">
          HỆ THỐNG GỌI SỐ TỰ ĐỘNG
        </h1>

        <div className="flex items-center gap-[1.5vw]">
          {!unlocked ? (
            <button
              onClick={() => void unlockAudio()}
              className="px-[1.5vw] py-[1vh] bg-amber-500 text-slate-950 font-black text-[1.4vw] rounded-xl animate-bounce shadow-lg shadow-amber-500/50"
            >
              🔊 NHẤP ĐỂ BẬT ÂM THANH TV
            </button>
          ) : (
            <span className="text-emerald-400 font-bold text-[1.3vw] flex items-center gap-[0.5vw]">
              <span className="h-[1vw] w-[1vw] rounded-full bg-emerald-500 animate-ping"></span>
              ÂM THANH SẴN SÀNG
            </span>
          )}
        </div>
      </header>

      {/* BODY: Chiều cao cố định 87% màn hình */}
      <main className="w-full h-[87vh] flex gap-[1.5vw] overflow-hidden shrink-0">
        {/* CỘT TRÁI (QUẦY PHỤC VỤ): Chiều rộng cố định 62% */}
        <section className="w-[62%] h-full grid grid-cols-2 gap-[1.2vw] auto-rows-fr">
          {counters.map((counter) => {
            const isCalling = Boolean(counter.called_at && counter.queue_number);
            const driverName = cleanDriverName(counter.agent_name);

            return (
              <div
                key={counter.counter_code}
                className={`w-full h-full flex flex-col justify-between p-[1.5vw] rounded-3xl border-[0.3vw] transition-all overflow-hidden ${
                  isCalling
                    ? "bg-slate-900 border-amber-400 shadow-[0_0_50px_rgba(251,191,36,0.3)]"
                    : "bg-slate-900/70 border-slate-800"
                }`}
              >
                {/* Tên quầy */}
                <div className="w-full flex justify-between items-center border-b-2 border-slate-800 pb-[0.8vh]">
                  <span className="text-[1.8vw] font-extrabold text-slate-200 truncate">
                    {counter.counter_name}
                  </span>
                  <span
                    className={`text-[1vw] font-bold px-[0.8vw] py-[0.3vh] rounded-lg border ${
                      counter.counter_status === "OPEN" || counter.counter_status === "AVAILABLE"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                        : "bg-slate-800 text-slate-400 border-transparent"
                    }`}
                  >
                    {counter.counter_status}
                  </span>
                </div>

                {/* Số lượt hiển thị CỰC ĐẠI */}
                <div className="w-full flex-1 flex items-center justify-center">
                  <span
                    className={`text-[6.5vw] font-black font-mono leading-none tracking-tight ${
                      isCalling ? "text-amber-400 animate-pulse" : "text-white"
                    }`}
                  >
                    {counter.queue_number || "---"}
                  </span>
                </div>

                {/* Tên tài xế */}
                <div className="w-full border-t-2 border-slate-800 pt-[0.8vh] text-[1.4vw] font-bold text-slate-400 truncate">
                  Tài xế: <span className="text-white">{driverName || "---"}</span>
                </div>
              </div>
            );
          })}
        </section>

        {/* CỘT PHẢI (DANH SÁCH CHỜ): Chiều rộng cố định 38% */}
        <section className="w-[38%] h-full bg-slate-900/80 border-2 border-slate-800 rounded-3xl p-[1.5vw] flex flex-col overflow-hidden">
          <div className="w-full flex justify-between items-center border-b-2 border-slate-800 pb-[1vh] mb-[1.5vh] shrink-0">
            <h2 className="text-[2vw] font-black text-amber-400 uppercase tracking-wide">
              DANH SÁCH CHỜ
            </h2>
            <span className="bg-amber-500/20 text-amber-300 font-extrabold text-[1.5vw] px-[1vw] py-[0.2vh] rounded-full border border-amber-500/30">
              {waitingQueue.length}
            </span>
          </div>

          {/* FIX LỖI ẨN HÀNG CHỜ: Sử dụng Flex col gap thay cho height % cứng */}
          <div className="w-full flex-1 flex flex-col gap-[1vh] overflow-y-auto pr-[0.5vw]">
            {waitingQueue.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-[1.8vw] font-bold text-slate-600 italic">
                Chưa có tài xế check-in
              </div>
            ) : (
              waitingQueue.map((item) => {
                const driver = cleanDriverName(item.driver_name);
                return (
                  <div
                    key={item.ticket_code || item.queue_number || Math.random()}
                    className="w-full py-[1.2vh] px-[1.2vw] bg-slate-950 border-2 border-slate-800/80 rounded-2xl flex items-center justify-between shrink-0"
                  >
                    <span className="text-[3vw] font-black font-mono text-emerald-400 leading-none">
                      {item.queue_number}
                    </span>
                    <div className="text-right truncate max-w-[60%]">
                      <p className="text-[1.3vw] font-bold text-slate-100 truncate leading-tight">
                        {driver || "Tài xế"}
                      </p>
                      <p className="text-[1vw] font-mono text-slate-400 leading-tight">
                        {item.created_at
                          ? new Date(item.created_at).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "--:--"}
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
