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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (!Number.isFinite(n) || n < 0) return "";
  n = Math.floor(n);

  if (n < 20) return SMALL_NUMBER_WORDS[n] ?? "";

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
    if (remainder < 10) return `${result} lẻ ${DIGIT_WORD[String(remainder)]}`;
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
   QUEUE NUMBER & CLEAN DRIVER NAME
   ============================================================ */

function queueNumberToWords(queueNumber: string): string {
  return [...queueNumber.trim().toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

/**
 * Lọc bỏ email nếu dữ liệu dính email (VD: "nam.nguyen@gmail.com" -> "nam nguyen")
 */
function cleanDriverName(driverName: string | null | undefined): string {
  if (!driverName) return "";

  let name = driverName.trim();

  // Nếu chứa email, cắt bỏ phần đuôi từ dấu @ trở đi
  if (name.includes("@")) {
    name = name.split("@")[0] ?? "";
  }

  // Thay thế các ký tự đặc biệt hay có trong email bằng khoảng trắng
  name = name.replace(/[._-]/g, " ").replace(/\s+/g, " ");

  return name.trim();
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterName: string
): string {
  const queueWords = queueNumberToWords(queueNumber);
  const counterWords = counterNumberToWords(counterName);
  const cleanName = cleanDriverName(driverName);

  // Nếu lọc xong vẫn còn tên người thì đọc kèm tên, ngược lại chỉ đọc Số và Quầy
  if (cleanName) {
    return (
      `Kính mời tài xế số ${queueWords}, ` +
      `${cleanName}, ` +
      `vui lòng đến quầy số ${counterWords}.`
    );
  }

  return `Kính mời tài xế số ${queueWords}, vui lòng đến quầy số ${counterWords}.`;
}

/* ============================================================
   TV SPEECH ENGINE (FIXED QUEUE EXECUTION)
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

  /* SPEAK ONE TEXT - KHÔNG CANCEL ĐỂ TRÁNH HỦY QUEUE */
  const speak = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          reject(new Error("Không hỗ trợ Speech Synthesis"));
          return;
        }

        const synthesis = window.speechSynthesis;
        const voice = getVietnameseVoice();

        if (!voice) {
          reject(new Error("Không tìm thấy giọng tiếng Việt (vi-VN)"));
          return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "vi-VN";
        utterance.voice = voice;
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;
          utterance.onend = null;
          utterance.onerror = null;
          resolve();
        };

        const fail = (event: SpeechSynthesisErrorEvent) => {
          if (finished) return;
          finished = true;
          utterance.onend = null;
          utterance.onerror = null;
          reject(new Error(`Speech Error: ${event.error}`));
        };

        utterance.onend = finish;
        utterance.onerror = fail;
        utterance.addEventListener("cancel", finish);

        synthesis.speak(utterance);
      });
    },
    [getVietnameseVoice]
  );

  /* UNLOCK AUDIO HANDLER */
  const unlock = useCallback(async () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        throw new Error("Trình duyệt không hỗ trợ đọc âm thanh");
      }

      const synthesis = window.speechSynthesis;
      synthesis.cancel(); // Xóa lệnh phát cũ duy nhất tại thời điểm unlock

      const voice = getVietnameseVoice();
      if (!voice) {
        unlockedRef.current = false;
        setUnlocked(false);
        setAudioStatus("Thiết bị chưa cài giọng Tiếng Việt");
        return false;
      }

      // Test đọc 1 câu ngắn để unlock trình duyệt
      const testUtterance = new SpeechSynthesisUtterance("Đã bật âm thanh thành công");
      testUtterance.lang = "vi-VN";
      testUtterance.voice = voice;
      synthesis.speak(testUtterance);

      unlockedRef.current = true;
      setUnlocked(true);
      setAudioStatus(`Sẵn sàng — ${voice.name}`);
      return true;
    } catch (error) {
      unlockedRef.current = false;
      setUnlocked(false);
      setAudioStatus("Lỗi bật âm thanh");
      return false;
    }
  }, [getVietnameseVoice]);

  /* PROCESS QUEUE CONTINUOUSLY */
  const processQueue = useCallback(async () => {
    if (speakingRef.current || !unlockedRef.current || queueRef.current.length === 0) {
      return;
    }

    speakingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift();
        if (!job) continue;

        // Đọc lặp lại 2 lần cho mỗi lượt gọi
        for (let repeat = 1; repeat <= 2; repeat++) {
          if (!unlockedRef.current) break;

          try {
            await speak(job.text);
          } catch (error) {
            console.error(`[TV AUDIO] Đọc thất bại lần ${repeat}:`, error);
          }

          if (repeat === 1) {
            await delay(900); // Khoảng nghỉ giữa 2 lần đọc cùng 1 lượt
          }
        }

        await delay(700); // Khoảng nghỉ giữa các lượt gọi tiếp theo
      }
    } finally {
      speakingRef.current = false;

      // Kiểm tra xem có yêu cầu mới vừa nạp vào khi đang đọc hay không
      if (unlockedRef.current && queueRef.current.length > 0) {
        void processQueue();
      }
    }
  }, [speak]);

  /* ENQUEUE NEW CALL */
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
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synthesis = window.speechSynthesis;

    const handleVoicesChanged = () => {
      const voices = synthesis.getVoices();
      const viVoice = voices.find((v) =>
        v.lang.toLowerCase().startsWith("vi-")
      );

      if (!unlockedRef.current) {
        if (viVoice) {
          setAudioStatus(`Đã có giọng đọc: ${viVoice.name}`);
        } else {
          setAudioStatus("Chưa có giọng Tiếng Việt");
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
   CLOCK & MAIN PAGE COMPONENT
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

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
    audioStatus,
  } = useTvSpeech();

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

        // Lấy driver_name hoặc agent_name từ quầy làm dự phòng
        const rawDriverName = driver?.driver_name || call.agent_name || "";
        const counterName =
          call.counter_name?.trim() || call.counter_code?.trim() || "quầy";

        announcedCalls.current.add(callKey);
        enqueueAudio(call.queue_number, rawDriverName, counterName);
      }

      // Giới hạn kích thước Set để tránh tràn bộ nhớ
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
     REALTIME SUBSCRIPTION
     ========================================================== */

  useEffect(() => {
    if (!branchCode) return;

    void refresh();

    const channel = supabase
      .channel(`tv-display-${branchCode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_queues" },
        () => scheduleRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "counters" },
        () => scheduleRefresh()
      )
      .subscribe();

    // Fallback Polling 10 giây một lần đề phòng đứt kết nối WebSocket
    const pollInterval = window.setInterval(() => {
      scheduleRefresh();
    }, 10000);

    return () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
      window.clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [branchCode, refresh, scheduleRefresh]);

  const waitingQueue = useMemo(() => {
    return agentQueue.filter((q) => !isCalledQueue(q, counters));
  }, [agentQueue, counters]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-2xl font-bold text-white">
        Đang kết nối hệ thống quầy...
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-white font-sans overflow-hidden">
      {/* Top Header */}
      <header className="flex items-center justify-between bg-slate-900 px-8 py-4 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold tracking-wide">
            HỆ THỐNG GỌI SỐ TỰ ĐỘNG
          </h1>
          <span className="text-sm px-3 py-1 bg-slate-800 rounded-full text-slate-300 border border-slate-700">
            Chi nhánh: {branchCode}
          </span>
        </div>

        <div className="flex items-center gap-6">
          {/* Nút bật/mở khóa âm thanh */}
          <button
            onClick={() => void unlockAudio()}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              unlocked
                ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500 hover:bg-amber-600 text-slate-950 animate-pulse"
            }`}
          >
            🔊 {audioStatus}
          </button>

          {/* Clock */}
          {clock && (
            <div className="text-2xl font-mono font-semibold tracking-wider text-slate-200">
              {clock.toLocaleTimeString("vi-VN")}
            </div>
          )}
        </div>
      </header>

      {/* Main Grid: Counters Status & Queue Sidebar */}
      <main className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Active Counters Grid */}
        <section className="col-span-8 grid grid-cols-2 gap-4 auto-rows-min overflow-y-auto pr-1">
          {counters.map((counter) => {
            const isCalling = Boolean(counter.called_at && counter.queue_number);
            const displayDriverName = cleanDriverName(
              counter.agent_name ?? ""
            );

            return (
              <div
                key={counter.counter_code}
                className={`flex flex-col justify-between p-6 rounded-2xl border transition-all ${
                  isCalling
                    ? "bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10"
                    : "bg-slate-900/80 border-slate-800"
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <span className="text-xl font-bold text-slate-300">
                    {counter.counter_name}
                  </span>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                      counter.counter_status === "OPEN" || counter.counter_status === "AVAILABLE"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {counter.counter_status}
                  </span>
                </div>

                <div className="my-6 text-center">
                  <p className="text-sm text-slate-400 mb-1">Số lượt phục vụ</p>
                  <p
                    className={`text-6xl font-extrabold tracking-tight font-mono ${
                      isCalling ? "text-amber-400 animate-pulse" : "text-white"
                    }`}
                  >
                    {counter.queue_number || "---"}
                  </p>
                </div>

                <div className="flex items-center justify-between text-sm text-slate-400 pt-3 border-t border-slate-800/80">
                  <span>
                    Tài xế:{" "}
                    <strong className="text-slate-200">
                      {displayDriverName || "---"}
                    </strong>
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Right Sidebar: Waiting Queue */}
        <section className="col-span-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col overflow-hidden">
          <h2 className="text-xl font-bold text-slate-200 mb-4 border-b border-slate-800 pb-3 flex items-center justify-between">
            <span>DANH SÁCH CHỜ</span>
            <span className="text-sm font-normal text-slate-400">
              Tổng: {waitingQueue.length}
            </span>
          </h2>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {waitingQueue.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-center py-12">
                Không có tài xế trong hàng chờ
              </div>
            ) : (
              waitingQueue.map((item) => {
                const cleanName = cleanDriverName(item.driver_name);

                return (
                  <div
                    key={item.ticket_code}
                    className="flex items-center justify-between bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl"
                  >
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      {item.queue_number}
                    </span>
                    <div className="text-right">
                      <p className="font-semibold text-slate-200">
                        {cleanName || "Tài xế"}
                      </p>
                      <p className="text-xs text-slate-400">
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

      {/* Error Bar */}
      {errorMessage && (
        <div className="bg-red-900/80 border-t border-red-700 text-red-200 px-6 py-2 text-sm flex items-center justify-between">
          <span>⚠️ Lỗi kết nối: {errorMessage}</span>
          <button
            onClick={() => void refresh()}
            className="underline hover:text-white"
          >
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
