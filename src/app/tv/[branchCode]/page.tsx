"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

/* ============================================================
   TYPES
   ============================================================ */

type CounterStatusRow = {
  counter_code: string;
  counter_name: string;
  counter_status:
    | "OPEN"
    | "CLOSED"
    | "AVAILABLE"
    | "BUSY"
    | "OFFLINE"
    | string;
  agent_id: string | null;
  agent_name: string | null;
  queue_number: string | null;
  called_at: string | null;
  display_order: number;
};

type AgentQueueRow = {
  agent_id: string | null;
  ticket_code: string;
  queue_number: string;
  driver_name: string;
  created_at: string;
};

type SpeechJob = {
  id: string;
  text: string;
};

/* ============================================================
   HELPERS
   ============================================================ */

function normalizeQueue(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
): boolean {
  const queueNumber = normalizeQueue(queue.queue_number);

  if (!queueNumber) {
    return false;
  }

  return counters.some(
    (counter) =>
      normalizeQueue(counter.queue_number) === queueNumber &&
      Boolean(counter.called_at)
  );
}

/* ============================================================
   VIETNAMESE NUMBER / CHARACTER WORDS
   ============================================================ */

const DIGIT_WORD: Record<string, string> = {
  "0": "không",
  "1": "một",
  "2": "hai",
  "3": "ba",
  "4": "bốn",
  "5": "năm",
  "6": "sáu",
  "7": "bảy",
  "8": "tám",
  "9": "chín",

  A: "a",
  B: "bê",
  C: "xê",
  D: "đê",
  E: "e",
  F: "ép",
  G: "gờ",
  H: "hát",
  I: "i",
  J: "gi",
  K: "ca",
  L: "e lờ",
  M: "em",
  N: "en",
  O: "ô",
  P: "pê",
  Q: "quy",
  R: "e rờ",
  S: "ét",
  T: "tê",
  U: "u",
  V: "vê",
  W: "vê kép",
  X: "ích",
  Y: "i dài",
  Z: "dét",
};

const SMALL_NUMBER_WORDS: string[] = [
  "không",
  "một",
  "hai",
  "ba",
  "bốn",
  "năm",
  "sáu",
  "bảy",
  "tám",
  "chín",
  "mười",
  "mười một",
  "mười hai",
  "mười ba",
  "mười bốn",
  "mười lăm",
  "mười sáu",
  "mười bảy",
  "mười tám",
  "mười chín",
];

/* ============================================================
   VIETNAMESE NUMBER TO WORD
   ============================================================ */

function numberToVietnameseWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "";
  }

  n = Math.floor(n);

  if (n < 20) {
    return SMALL_NUMBER_WORDS[n] ?? "";
  }

  if (n < 100) {
    const tens = Math.floor(n / 10);
    const units = n % 10;

    const result = `${DIGIT_WORD[String(tens)]} mươi`;

    if (units === 0) return result;
    if (units === 1) return `${result} mốt`;
    if (units === 4) return `${result} tư`;
    if (units === 5) return `${result} lăm`;

    return `${result} ${DIGIT_WORD[String(units)]}`;
  }

  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const remainder = n % 100;
    const result = `${DIGIT_WORD[String(hundreds)]} trăm`;

    if (remainder === 0) return result;
    if (remainder < 10) {
      return `${result} lẻ ${DIGIT_WORD[String(remainder)]}`;
    }

    return `${result} ${numberToVietnameseWords(remainder)}`;
  }

  return String(n)
    .split("")
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

/* ============================================================
   COUNTER NUMBER
   ============================================================ */

function extractCounterNumber(counterName: string): string {
  const value = counterName.trim();
  const match = value.match(/(?:quầy\s*(?:số\s*)?)(\d+)/i);

  if (match?.[1]) return match[1];
  if (/^\d+$/.test(value)) return value;

  const fallback = value.match(/(\d+)\s*$/);
  if (fallback?.[1]) return fallback[1];

  return value;
}

function counterNumberToWords(counterName: string): string {
  const number = extractCounterNumber(counterName);
  const numeric = Number(number);

  if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1000) {
    return numberToVietnameseWords(numeric);
  }

  return [...number]
    .map((ch) => DIGIT_WORD[ch.toUpperCase()] ?? ch)
    .join(" ");
}

/* ============================================================
   QUEUE NUMBER
   ============================================================ */

function queueNumberToWords(queueNumber: string): string {
  return [...queueNumber.trim().toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

/* ============================================================
   DRIVER NAME
   ============================================================ */

function cleanDriverName(driverName: string): string {
  return driverName.trim().replace(/\s+/g, " ");
}

/* ============================================================
   ANNOUNCEMENT TEXT
   ============================================================ */

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterName: string
): string {
  const queueWords = queueNumberToWords(queueNumber);
  const counterWords = counterNumberToWords(counterName);
  const cleanName = cleanDriverName(driverName);

  return (
    `Kính mời tài xế số ${queueWords}, ` +
    `${cleanName}, ` +
    `vui lòng đến quầy số ${counterWords}.`
  );
}

/* ============================================================
   TV SPEECH ENGINE
   ============================================================ */

function useTvSpeech() {
  const queueRef = useRef<SpeechJob[]>([]);
  const speakingRef = useRef(false);
  const unlockedRef = useRef(false);

  const [unlocked, setUnlocked] = useState(false);
  const [audioStatus, setAudioStatus] = useState("Chưa bật âm thanh");

  const getVietnameseVoice = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return null;
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const exact = voices.find(
      (v) => v.lang.trim().toLowerCase() === "vi-vn"
    );
    if (exact) return exact;

    return (
      voices.find((v) => v.lang.trim().toLowerCase().startsWith("vi-")) ?? null
    );
  }, []);

  const getVietnameseVoices = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return [];
    }

    return window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.trim().toLowerCase().startsWith("vi-"));
  }, []);

  const speak = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          reject(new Error("Speech synthesis not supported"));
          return;
        }

        const synthesis = window.speechSynthesis;
        const voice = getVietnameseVoice();

        if (!voice) {
          reject(new Error("Không tìm thấy giọng tiếng Việt"));
          return;
        }

        synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "vi-VN";
        utterance.voice = voice;
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        let finished = false;

        const cleanup = () => {
          utterance.onend = null;
          utterance.onerror = null;
          utterance.removeEventListener("cancel", finish);
        };

        const finish = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve();
        };

        const fail = (event: SpeechSynthesisErrorEvent) => {
          if (finished) return;
          finished = true;
          cleanup();
          reject(new Error(`Speech synthesis failed: ${event.error}`));
        };

        utterance.onend = finish;
        utterance.onerror = fail;
        utterance.addEventListener("cancel", finish);

        synthesis.speak(utterance);
      });
    },
    [getVietnameseVoice]
  );

  const unlock = useCallback(async () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        throw new Error("Speech synthesis not supported");
      }

      const synthesis = window.speechSynthesis;
      synthesis.cancel();

      const vietnameseVoice = getVietnameseVoice();

      if (!vietnameseVoice) {
        unlockedRef.current = false;
        setUnlocked(false);
        setAudioStatus("TV chưa có giọng tiếng Việt");
        return false;
      }

      const test = new SpeechSynthesisUtterance(
        "Âm thanh thông báo đã được bật"
      );
      test.lang = "vi-VN";
      test.voice = vietnameseVoice;
      test.rate = 0.9;

      await new Promise<void>((resolve, reject) => {
        let finished = false;

        const cleanup = () => {
          test.onend = null;
          test.onerror = null;
          test.removeEventListener("cancel", finish);
        };

        const finish = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve();
        };

        const fail = (e: SpeechSynthesisErrorEvent) => {
          if (finished) return;
          finished = true;
          cleanup();
          reject(new Error(`Fail: ${e.error}`));
        };

        test.onend = finish;
        test.onerror = fail;
        test.addEventListener("cancel", finish);

        synthesis.speak(test);
      });

      unlockedRef.current = true;
      setUnlocked(true);
      setAudioStatus(`Sẵn sàng gọi số — ${vietnameseVoice.name}`);
      return true;
    } catch (error) {
      unlockedRef.current = false;
      setUnlocked(false);
      setAudioStatus(
        error instanceof Error ? error.message : "Không bật được âm thanh"
      );
      return false;
    }
  }, [getVietnameseVoice]);

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

          try {
            await speak(job.text);
          } catch (error) {
            console.error(`[TV AUDIO] REPEAT ${repeat}/2 FAILED:`, error);
          }

          if (repeat === 1) {
            await new Promise((r) => window.setTimeout(r, 900));
          }
        }

        await new Promise((r) => window.setTimeout(r, 700));
      }
    } finally {
      speakingRef.current = false;

      if (unlockedRef.current && queueRef.current.length > 0) {
        window.setTimeout(() => {
          void processQueue();
        }, 100);
      }
    }
  }, [speak]);

  const enqueue = useCallback(
    (queueNumber: string, driverName: string, counterName: string) => {
      const text = buildAnnouncementText(
        queueNumber,
        driverName,
        counterName
      );
      const id = `${counterName}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      queueRef.current.push({ id, text });

      if (unlockedRef.current) {
        void processQueue();
      }
    },
    [processQueue]
  );

  useEffect(() => {
    if (unlocked) {
      void processQueue();
    }
  }, [unlocked, processQueue]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const synthesis = window.speechSynthesis;
    const handleVoicesChanged = () => {
      const vietnamese = synthesis
        .getVoices()
        .filter((v) => v.lang.toLowerCase().startsWith("vi-"));

      if (!unlockedRef.current) {
        if (vietnamese.length > 0) {
          setAudioStatus(`Đã tìm thấy giọng Việt: ${vietnamese[0].name}`);
        } else {
          setAudioStatus("TV chưa có giọng tiếng Việt");
        }
      }
    };

    synthesis.addEventListener("voiceschanged", handleVoicesChanged);
    handleVoicesChanged();

    return () => {
      synthesis.removeEventListener("voiceschanged", handleVoicesChanged);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      queueRef.current = [];
      speakingRef.current = false;
      unlockedRef.current = false;
    };
  }, []);

  return { enqueue, unlock, unlocked, audioStatus };
}

/* ============================================================
   CLOCK
   ============================================================ */

function useClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}

/* ============================================================
   TV DISPLAY MAIN COMPONENT
   ============================================================ */

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const branchCode = params.branchCode;

  const [counters, setCounters] = useState<CounterStatusRow[]>([]);
  const [agentQueue, setAgentQueue] = useState<AgentQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const announcedCalls = useRef<Set<string>>(new Set());
  const refreshTimer = useRef<number | null>(null);
  const loadingRef = useRef(false);

  const { enqueue: enqueueAudio, unlock: unlockAudio, unlocked, audioStatus } =
    useTvSpeech();
  const clock = useClock();

  const loadCounters = useCallback(async () => {
    const { data, error } = await supabase.rpc("tv_counter_status", {
      p_branch_code: branchCode,
    });

    if (error) {
      setErrorMessage(error.message);
      return [];
    }

    const result = ((data ?? []) as CounterStatusRow[])
      .slice()
      .sort((a, b) => a.display_order - b.display_order);

    setCounters(result);
    return result;
  }, [branchCode]);

  const loadAgentQueue = useCallback(async () => {
    const { data, error } = await supabase.rpc("tv_agent_queue_list", {
      p_branch_code: branchCode,
    });

    if (error) return [];

    const result = ((data ?? []) as AgentQueueRow[])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

    setAgentQueue(result);
    return result;
  }, [branchCode]);

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

        if (!driver) continue;

        const driverName = driver.driver_name?.trim();
        if (!driverName) continue;

        const counterName =
          call.counter_name?.trim() || call.counter_code?.trim() || "quầy";

        announcedCalls.current.add(callKey);
        enqueueAudio(call.queue_number, driverName, counterName);
      }

      if (announcedCalls.current.size > 500) {
        const values = Array.from(announcedCalls.current);
        announcedCalls.current = new Set(values.slice(-200));
      }
    },
    [enqueueAudio]
  );

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const [counterList, queueList] = await Promise.all([
        loadCounters(),
        loadAgentQueue(),
      ]);

      setLoading(false);
      setErrorMessage(null);
      handleCalls(counterList, queueList);
    } catch (error) {
      console.error("[TV] REFRESH ERROR:", error);
    } finally {
      loadingRef.current = false;
    }
  }, [loadCounters, loadAgentQueue, handleCalls]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }

    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 80);
  }, [refresh]);

  /* ==========================================================
     REALTIME SUBSCRIPTION & INITIAL LOAD
     ========================================================== */

  useEffect(() => {
    if (!branchCode) return;

    void refresh();

    const channel = supabase
      .channel(`tv-display-${branchCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queues",
        },
        () => {
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "counters",
        },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    const fallbackInterval = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(fallbackInterval);
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
    };
  }, [branchCode, refresh, scheduleRefresh]);

  /* ==========================================================
     RENDER
     ========================================================== */

  const waitingQueue = useMemo(() => {
    return agentQueue.filter((q) => !isCalledQueue(q, counters));
  }, [agentQueue, counters]);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-white select-none overflow-hidden font-sans">
      {/* Header */}
      <header className="flex h-20 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-8">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-wide text-amber-400">
            HỆ THỐNG GỌI SỐ - CHI NHÁNH {branchCode?.toUpperCase()}
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={() => void unlockAudio()}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              unlocked
                ? "bg-emerald-600/30 text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
            }`}
          >
            <span>{audioStatus}</span>
          </button>

          <div className="text-right font-mono text-2xl font-semibold tracking-wider text-slate-200">
            {clock ? clock.toLocaleTimeString("vi-VN") : "--:--:--"}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="grid flex-1 grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left 8 Cols: Counter Status */}
        <section className="col-span-8 flex flex-col gap-4 overflow-y-auto pr-2">
          <h2 className="text-xl font-semibold text-slate-400 border-b border-slate-800 pb-2">
            TRẠNG THÁI QUẦY PHỤC VỤ
          </h2>

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-xl text-slate-500">
              Đang tải thông tin quầy...
            </div>
          ) : errorMessage ? (
            <div className="flex flex-1 items-center justify-center text-xl text-rose-500">
              Lỗi: {errorMessage}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {counters.map((counter) => {
                const isServing = Boolean(
                  counter.queue_number && counter.called_at
                );

                return (
                  <div
                    key={counter.counter_code}
                    className={`flex flex-col justify-between rounded-xl border p-5 transition-all ${
                      isServing
                        ? "border-amber-500/50 bg-amber-500/10 shadow-lg shadow-amber-500/5 animate-pulse"
                        : "border-slate-800 bg-slate-900/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-slate-200">
                        {counter.counter_name}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          counter.counter_status === "AVAILABLE" ||
                          counter.counter_status === "OPEN"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : counter.counter_status === "BUSY"
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {counter.counter_status}
                      </span>
                    </div>

                    <div className="my-4 text-center">
                      <div className="text-sm uppercase tracking-wider text-slate-400">
                        Số vé đang gọi
                      </div>
                      <div className="text-5xl font-extrabold tracking-tight text-amber-400 mt-1">
                        {counter.queue_number ?? "---"}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm text-slate-400 border-t border-slate-800/80 pt-3">
                      <span>Nhân viên: {counter.agent_name ?? "Chưa rõ"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right 4 Cols: Queue List */}
        <section className="col-span-4 flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-xl font-semibold text-slate-400 border-b border-slate-800 pb-3 mb-3">
            HÀNG ĐỢI CHO CỜI ({waitingQueue.length})
          </h2>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {waitingQueue.length === 0 ? (
              <div className="flex h-full items-center justify-center text-slate-500">
                Không có tài xế chờ
              </div>
            ) : (
              waitingQueue.map((item) => (
                <div
                  key={item.ticket_code}
                  className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/80 p-3"
                >
                  <div>
                    <div className="text-lg font-bold text-slate-100">
                      {item.queue_number}
                    </div>
                    <div className="text-sm text-slate-400">
                      {item.driver_name}
                    </div>
                  </div>
                  <div className="font-mono text-xs text-slate-500">
                    {new Date(item.created_at).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
