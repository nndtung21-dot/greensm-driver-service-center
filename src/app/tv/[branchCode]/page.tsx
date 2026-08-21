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
      audio.playbackRate = 0.95; // Giọng đọc rõ ràng hơn

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

      // Nếu không có giọng Tiếng Việt trong HĐH, ngắt để nhảy sang MP3 Fallback
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
      utterance.pitch = 1.1; // Chỉnh giọng cao thanh thoát hơn

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

  // Tổng hợp phát âm thanh: Ưu tiên WebSpeech -> Fallback MP3 Google
  const speakText = useCallback(
    async (text: string) => {
      try {
        await playWebSpeech(text);
      } catch (err) {
        console.warn("[AUDIO ENGINE] WebSpeech thất bại, chuyển sang Google TTS MP3:", err);
        try {
          await playGoogleTtsMp3(text);
        } catch (mp3Err) {
          console.error("[AUDIO ENGINE] Google MP3 thất bại:", mp3Err);
        }
      }
    },
    [playWebSpeech, playGoogleTtsMp3]
  );

  // Kích hoạt Audio trên Smart TV (Giải quyết Autoplay Policy)
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
      // Khởi tạo audio giả lập
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

        // Đọc lặp lại 2 lần
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
   MAIN TV COMPONENT (DÙNG CHO TV 65 INCH)
   ============================================================ */

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const branchCode = params.branchCode;

  const [counters, setCounters] = useState<CounterStatusRow[]>([]);
  const [agentQueue, setAgentQueue] = useState<AgentQueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  const announcedCalls = useRef<Set<string>>(new Set());
  const refreshTimer = useRef<number | null>(null);

  const { enqueue: enqueueAudio, unlock: unlockAudio, unlocked } = useTvSpeech();

  // Load Quầy
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

  // Load Hàng chờ - Đọc trực tiếp từ DB không qua RPC bị lọc
  const loadAgentQueue = useCallback(async () => {
    const { data } = await supabase
      .from("agent_queues")
      .select("*")
      .order("created_at", { ascending: true });

    const result = (data ?? []) as AgentQueueRow[];
    setAgentQueue(result);
    return result;
  }, []);

  // Xử lý đọc gọi số
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

    // Realtime cập nhật tức thì khi Check-in hoặc Gọi số
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

  /* Lọc hàng chờ đảm bảo vé VỪA CHECK IN XONG sẽ hiện ngay */
  const waitingQueue = useMemo(() => {
    const callingNumbers = new Set(
      counters.map((c) => normalizeQueue(c.queue_number)).filter(Boolean)
    );

    return agentQueue.filter((q) => {
      const qNum = normalizeQueue(q.queue_number);
      if (!qNum) return false;
      // Ẩn các số đang được xướng tên trên màn hình chính của quầy
      if (callingNumbers.has(qNum)) return false;
      // Không hiển thị vé đã hoàn thành/hủy
      if (q.status && ["DONE", "CANCELLED", "COMPLETED"].includes(q.status.toUpperCase())) {
        return false;
      }
      return true;
    });
  }, [agentQueue, counters]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-4xl font-bold text-white">
        ĐANG KHỞI ĐỘNG MÀN HÌNH MỚI...
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-white font-sans overflow-hidden select-none p-4 gap-4">
      {/* Header tối ưu hiển thị TV */}
      <header className="flex h-[10vh] items-center justify-between bg-slate-900/90 rounded-2xl px-8 border border-slate-800">
        <h1 className="text-4xl font-black tracking-wider text-amber-400 uppercase">
          HỆ THỐNG GỌI SỐ TỰ ĐỘNG
        </h1>

        <div className="flex items-center gap-6">
          {!unlocked && (
            <button
              onClick={() => void unlockAudio()}
              className="px-6 py-3 bg-amber-500 text-slate-950 font-black text-2xl rounded-xl animate-bounce shadow-lg shadow-amber-500/50"
            >
              🔊 NHẤP ĐỂ BẬT ÂM THANH
            </button>
          )}
          {unlocked && (
            <span className="text-emerald-400 font-bold text-xl flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-emerald-500 animate-ping"></span>
              ÂM THANH GIỌNG NỮ SẴN SÀNG
            </span>
          )}
        </div>
      </header>

      {/* Thân màn hình TV 65 Inch chia Cột */}
      <main className="flex-1 grid grid-cols-12 gap-6 h-[86vh] overflow-hidden">
        {/* CỘT TRÁI (7 CỘT): CÁC QUẦY ĐANG GỌI SỐ */}
        <section className="col-span-7 grid grid-cols-2 gap-4 h-full auto-rows-fr">
          {counters.map((counter) => {
            const isCalling = Boolean(counter.called_at && counter.queue_number);
            const driverName = cleanDriverName(counter.agent_name);

            return (
              <div
                key={counter.counter_code}
                className={`flex flex-col justify-between p-6 rounded-3xl border-4 transition-all ${
                  isCalling
                    ? "bg-slate-900 border-amber-400 shadow-[0_0_50px_rgba(251,191,36,0.3)]"
                    : "bg-slate-900/60 border-slate-800"
                }`}
              >
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-3xl font-extrabold text-slate-300">
                    {counter.counter_name}
                  </span>
                  <span
                    className={`text-lg px-4 py-1 rounded-xl font-bold ${
                      counter.counter_status === "OPEN" || counter.counter_status === "AVAILABLE"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {counter.counter_status}
                  </span>
                </div>

                {/* SỐ SỐ PHỤC VỤ (CỰC ĐẠI TRÊN TV) */}
                <div className="text-center my-auto">
                  <span
                    className={`block text-[6.5rem] leading-none font-black font-mono tracking-tight ${
                      isCalling ? "text-amber-400 animate-pulse" : "text-slate-100"
                    }`}
                  >
                    {counter.queue_number || "---"}
                  </span>
                </div>

                <div className="border-t border-slate-800 pt-3 text-2xl font-bold text-slate-400 truncate">
                  Tài xế: <span className="text-white">{driverName || "---"}</span>
                </div>
              </div>
            );
          })}
        </section>

        {/* CỘT PHẢI (5 CỘT): HÀNG CHỜ VỪA CHECK-IN */}
        <section className="col-span-5 bg-slate-900/80 border-2 border-slate-800 rounded-3xl p-6 flex flex-col h-full overflow-hidden">
          <div className="flex justify-between items-center border-b-2 border-slate-800 pb-4 mb-4">
            <h2 className="text-3xl font-black text-amber-400 tracking-wide">
              DANH SÁCH CHỜ
            </h2>
            <span className="bg-amber-500/20 text-amber-300 font-extrabold px-4 py-1.5 rounded-full text-2xl border border-amber-500/30">
              {waitingQueue.length}
            </span>
          </div>

          <div className="flex-1 overflow-hidden grid grid-cols-1 gap-3">
            {waitingQueue.length === 0 ? (
              <div className="flex items-center justify-center h-full text-3xl font-bold text-slate-600 italic">
                Chưa có tài xế check-in
              </div>
            ) : (
              waitingQueue.slice(0, 7).map((item) => {
                const driver = cleanDriverName(item.driver_name);
                return (
                  <div
                    key={item.ticket_code || item.queue_number}
                    className="flex items-center justify-between bg-slate-950 border-2 border-slate-800 p-4 rounded-2xl"
                  >
                    <span className="text-5xl font-black font-mono text-emerald-400">
                      {item.queue_number}
                    </span>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-100 truncate max-w-[250px]">
                        {driver || "Tài xế"}
                      </p>
                      <p className="text-lg text-slate-400 font-mono">
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
