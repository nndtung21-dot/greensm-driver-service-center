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

  if (!queueNumber) return false;

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
  "0": "không", "1": "một", "2": "hai", "3": "ba", "4": "bốn",
  "5": "năm", "6": "sáu", "7": "bảy", "8": "tám", "9": "chín",
  A: "a", B: "bê", C: "xê", D: "đê", E: "e", F: "ép", G: "gờ",
  H: "hát", I: "i", J: "gi", K: "ca", L: "e lờ", M: "em", N: "en",
  O: "ô", P: "pê", Q: "quy", R: "e rờ", S: "ét", T: "tê", U: "u",
  V: "vê", W: "vê kép", X: "ích", Y: "i dài", Z: "dét",
};

const SMALL_NUMBER_WORDS: string[] = [
  "không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín",
  "mười", "mười một", "mười hai", "mười ba", "mười bốn", "mười lăm",
  "mười sáu", "mười bảy", "mười tám", "mười chín",
];

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

  return String(n).split("").map((ch) => DIGIT_WORD[ch] ?? ch).join(" ");
}

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
  return [...number].map((ch) => DIGIT_WORD[ch.toUpperCase()] ?? ch).join(" ");
}

function queueNumberToWords(queueNumber: string): string {
  return [...queueNumber.trim().toUpperCase()].map((ch) => DIGIT_WORD[ch] ?? ch).join(" ");
}

function buildAnnouncementText(queueNumber: string, driverName: string, counterName: string): string {
  return (
    `Kính mời tài xế số ${queueNumberToWords(queueNumber)}, ` +
    `${driverName.trim().replace(/\s+/g, " ")}, ` +
    `vui lòng đến quầy số ${counterNumberToWords(counterName)}.`
  );
}

/* ============================================================
   TV SPEECH ENGINE (OPTIMIZED)
   ============================================================ */

function useTvSpeech() {
  const queueRef = useRef<SpeechJob[]>([]);
  const speakingRef = useRef(false);
  const unlockedRef = useRef(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [unlocked, setUnlocked] = useState(false);
  const [audioStatus, setAudioStatus] = useState("Chưa bật âm thanh");

  // Load voices bất đồng bộ
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const updateVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const getVietnameseVoice = useCallback(() => {
    if (!voices.length) return null;
    return (
      voices.find((v) => v.lang.trim().toLowerCase() === "vi-vn") ??
      voices.find((v) => v.lang.trim().toLowerCase().startsWith("vi-")) ??
      null
    );
  }, [voices]);

  const speak = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          resolve();
          return;
        }

        const synthesis = window.speechSynthesis;
        const voice = getVietnameseVoice();
        if (!voice) {
          resolve();
          return;
        }

        synthesis.cancel(); // Clears pending queue

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "vi-VN";
        utterance.voice = voice;
        utterance.rate = 0.9;

        let finished = false;

        // Safety timeout phòng trường hợp Web Speech API bị treo trên TV
        const timeoutId = setTimeout(() => {
          if (!finished) {
            finished = true;
            synthesis.cancel();
            resolve();
          }
        }, 12000);

        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          utterance.onend = null;
          utterance.onerror = null;
          resolve();
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        synthesis.speak(utterance);
      });
    },
    [getVietnameseVoice]
  );

  const unlock = useCallback(async () => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
      const synthesis = window.speechSynthesis;
      synthesis.cancel();
      
      const voice = getVietnameseVoice();
      if (!voice) {
        setUnlocked(false);
        setAudioStatus("TV chưa có giọng tiếng Việt");
        return false;
      }

      const test = new SpeechSynthesisUtterance("Âm thanh thông báo đã bật");
      test.lang = "vi-VN";
      test.voice = voice;
      
      await new Promise<void>((resolve) => {
        test.onend = () => resolve();
        test.onerror = () => resolve();
        synthesis.speak(test);
      });

      unlockedRef.current = true;
      setUnlocked(true);
      setAudioStatus(`Sẵn sàng — ${voice.name}`);
      return true;
    } catch {
      unlockedRef.current = false;
      setUnlocked(false);
      setAudioStatus("Không bật được âm thanh");
      return false;
    }
  }, [getVietnameseVoice]);

  const processQueue = useCallback(async () => {
    if (speakingRef.current || !unlockedRef.current || queueRef.current.length === 0) return;
    speakingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift();
        if (!job) continue;
        for (let r = 1; r <= 2; r++) {
          if (!unlockedRef.current) break;
          try {
            await speak(job.text);
          } catch (e) {
            console.error(e);
          }
          if (r === 1) await new Promise((res) => window.setTimeout(res, 900));
        }
        await new Promise((res) => window.setTimeout(res, 700));
      }
    } finally {
      speakingRef.current = false;
      if (unlockedRef.current && queueRef.current.length > 0) {
        window.setTimeout(() => void processQueue(), 100);
      }
    }
  }, [speak]);

  const enqueue = useCallback(
    (queueNumber: string, driverName: string, counterName: string) => {
      const text = buildAnnouncementText(queueNumber, driverName, counterName);
      queueRef.current.push({ id: `${counterName}-${Date.now()}`, text });
      if (unlockedRef.current) void processQueue();
    },
    [processQueue]
  );

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
   MAIN TV COMPONENT
   ============================================================ */

export default function TvDisplayPage() {
  const params = useParams<{ branchCode: string }>();
  const branchCode = params.branchCode;

  const [counters, setCounters] = useState<CounterStatusRow[]>([]);
  const [agentQueue, setAgentQueue] = useState<AgentQueueRow[]>([]);

  // Giới hạn lịch sử gọi để tránh Memory Leak khi chạy TV liên tục
  const announcedCalls = useRef<Set<string>>(new Set());
  const { enqueue: enqueueAudio, unlock: unlockAudio, unlocked, audioStatus } = useTvSpeech();
  const clock = useClock();

  const loadData = useCallback(async () => {
    if (!branchCode) return;

    const [cRes, qRes] = await Promise.all([
      supabase.rpc("tv_counter_status", { p_branch_code: branchCode }),
      supabase.rpc("tv_agent_queue_list", { p_branch_code: branchCode }),
    ]);

    const counterList = ((cRes.data ?? []) as CounterStatusRow[]).sort((a, b) => a.display_order - b.display_order);
    const queueList = ((qRes.data ?? []) as AgentQueueRow[]).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    setCounters(counterList);
    setAgentQueue(queueList);

    // Audio Call logic
    const activeCalls = counterList.filter((c) => Boolean(c.queue_number) && Boolean(c.called_at));
    for (const call of activeCalls) {
      if (!call.queue_number || !call.called_at) continue;
      const callKey = `${call.counter_code}:${call.called_at}`;
      
      if (announcedCalls.current.has(callKey)) continue;

      const driver = queueList.find((q) => normalizeQueue(q.queue_number) === normalizeQueue(call.queue_number));
      if (!driver?.driver_name) continue;

      // Giữ Set dưới 200 phần tử để tránh leak memory
      if (announcedCalls.current.size > 200) {
        const firstKey = announcedCalls.current.values().next().value;
        if (firstKey) announcedCalls.current.delete(firstKey);
      }

      announcedCalls.current.add(callKey);
      enqueueAudio(call.queue_number, driver.driver_name, call.counter_name || call.counter_code);
    }
  }, [branchCode, enqueueAudio]);

  useEffect(() => {
    if (!branchCode) return;
    void loadData();
    const interval = window.setInterval(() => void loadData(), 3000);
    return () => window.clearInterval(interval);
  }, [branchCode, loadData]);

  // Lọc lấy danh sách đang chờ (chưa được gọi)
  const waitingQueue = useMemo(() => {
    return agentQueue.filter((q) => !isCalledQueue(q, counters));
  }, [agentQueue, counters]);

  // Gom nhóm hàng chờ theo Agent/Counter
  const queueByCounter = useMemo(() => {
    const map = new Map<string, AgentQueueRow[]>();
    counters.forEach((c) => {
      if (c.agent_id) map.set(c.agent_id, []);
    });

    waitingQueue.forEach((q) => {
      if (q.agent_id && map.has(q.agent_id)) {
        map.get(q.agent_id)?.push(q);
      }
    });

    return map;
  }, [counters, waitingQueue]);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-white select-none overflow-hidden font-sans">
      <header className="flex h-20 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-8">
        <h1 className="text-2xl font-bold text-amber-400">
          HỆ THỐNG GỌI SỐ - CHI NHÁNH {branchCode?.toUpperCase()}
        </h1>
        <div className="flex items-center gap-6">
          <button
            onClick={() => void unlockAudio()}
            className={`rounded-lg px-4 py-2 font-medium transition-colors ${
              unlocked
                ? "bg-emerald-600/30 text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
            }`}
          >
            {audioStatus}
          </button>
          <div className="font-mono text-2xl font-semibold text-slate-200">
            {clock ? clock.toLocaleTimeString("vi-VN") : "--:--:--"}
          </div>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* TRẠNG THÁI QUẦY */}
        <section className="col-span-7 flex flex-col gap-4 overflow-y-auto pr-2">
          <h2 className="text-xl font-semibold text-slate-400 border-b border-slate-800 pb-2">
            TRẠNG THÁI QUẦY PHỤC VỤ
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {counters.map((counter) => {
              const isServing = Boolean(counter.queue_number && counter.called_at);
              return (
                <div
                  key={counter.counter_code}
                  className={`flex flex-col justify-between rounded-xl border p-5 ${
                    isServing
                      ? "border-amber-500/50 bg-amber-500/10 shadow-lg shadow-amber-500/5 animate-pulse"
                      : "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold text-slate-200">{counter.counter_name}</span>
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                      {counter.counter_status}
                    </span>
                  </div>
                  <div className="my-4 text-center">
                    <div className="text-xs uppercase text-slate-400">Đang gọi</div>
                    <div className="text-5xl font-extrabold text-amber-400 mt-1">
                      {counter.queue_number ?? "---"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* HÀNG ĐỢI THEO TỪNG QUẦY */}
        <section className="col-span-5 flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-xl font-semibold text-slate-400 border-b border-slate-800 pb-3 mb-3">
            HÀNG ĐỢI THEO QUẦY
          </h2>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {counters.map((counter) => {
              const list = (counter.agent_id ? queueByCounter.get(counter.agent_id) : []) ?? [];
              return (
                <div key={counter.counter_code} className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
                  <div className="flex justify-between items-center border-b border-slate-800/80 pb-2 mb-2">
                    <span className="font-bold text-amber-400">{counter.counter_name}</span>
                    <span className="text-xs text-slate-400">Đang chờ: {list.length}</span>
                  </div>

                  {list.length === 0 ? (
                    <div className="text-xs text-slate-600 italic py-1">Không có hàng chờ</div>
                  ) : (
                    <div className="space-y-1.5">
                      {list.map((item) => (
                        <div key={item.ticket_code} className="flex justify-between items-center bg-slate-950/60 p-2 rounded border border-slate-800/50 text-sm">
                          <div>
                            <span className="font-bold text-slate-200 mr-2">{item.queue_number}</span>
                            <span className="text-slate-400 text-xs">{item.driver_name}</span>
                          </div>
                          <span className="text-xs text-slate-500 font-mono">
                            {new Date(item.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
