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

function stripLeadingZeros(s: string): string {
  const stripped = s.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : "0";
}

function buildAnnouncementClips(queueNumber: string, counterCode: string): string[] {
  const clips: string[] = ["intro"];
  for (const ch of queueNumber.toUpperCase()) {
    if (DIGIT_CLIP[ch]) clips.push(DIGIT_CLIP[ch]);
  }
  clips.push("den_quay_so");
  // Đọc số quầy tự nhiên (bỏ số 0 đứng đầu): quầy "01" -> chỉ đọc "một",
  // không đọc "không một" — tránh nghe nhầm sang số khác.
  const counterDigits = stripLeadingZeros(counterCode);
  for (const ch of counterDigits) {
    if (DIGIT_CLIP[ch]) clips.push(DIGIT_CLIP[ch]);
  }
  return clips;
}

const DIGIT_WORD: Record<string, string> = {
  "0": "không", "1": "một", "2": "hai", "3": "ba", "4": "bốn",
  "5": "năm", "6": "sáu", "7": "bảy", "8": "tám", "9": "chín", A: "a",
};

// Số quầy thực tế nhỏ (1-20) nên đọc tự nhiên như người Việt nói bình thường,
// KHÔNG đánh vần từng chữ số — đây là nguyên nhân gây cảm giác "đọc lệch
// quầy" (số 0 đứng đầu + đánh vần từng số dễ gây hiểu nhầm khi nghe nhanh).
const SMALL_NUMBER_WORDS = [
  "không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín",
  "mười", "mười một", "mười hai", "mười ba", "mười bốn", "mười lăm",
  "mười sáu", "mười bảy", "mười tám", "mười chín", "hai mươi",
];

function counterNumberToWords(counterCode: string): string {
  const stripped = counterCode.replace(/^0+/, "");
  const n = parseInt(stripped, 10);
  if (!isNaN(n) && n >= 0 && n < SMALL_NUMBER_WORDS.length) {
    return SMALL_NUMBER_WORDS[n];
  }
  return [...counterCode].map((ch) => DIGIT_WORD[ch] ?? ch).join(" ");
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterCode: string
): string {
  const qWords = [...queueNumber.toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
  const cWords = counterNumberToWords(counterCode);

  return `Kính mời tài xế có số ${qWords}, ${driverName}, đến quầy số ${cWords}`;
}

// Hàng đợi thông báo: mỗi lượt gọi số ưu tiên thử giọng Google (tự nhiên hơn)
// trước, nếu lỗi/bị chặn thì tự chuyển sang giọng thu sẵn (espeak). Xử lý
// tuần tự nên nhiều số gọi dồn dập vẫn không chồng tiếng nhau.
function useAnnouncer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<(() => Promise<void>)[]>([]);
  const playingRef = useRef(false);
  const [unlocked, setUnlocked] = useState(false);

  // Trình duyệt (Chrome/Edge...) chặn phát audio bằng JS cho tới khi có ít
  // nhất 1 cú bấm/chạm của người dùng trên trang — đây là chính sách bảo mật
  // của trình duyệt, không phải lỗi code. Với màn hình TV chạy không người
  // trông coi, cần 1 lần bấm "mở khoá" — sau đó phát được bình thường suốt
  // phiên mở trang (tới khi tải lại trang).
  const unlock = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = `${CLIP_BASE}intro.mp3`;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        setUnlocked(true);
      })
      .catch(() => {
        /* vẫn đang bị chặn — nút "Bật âm thanh" sẽ tiếp tục hiện để thử lại */
      });
  }, []);

  const playLocalClips = useCallback((clipNames: string[]) => {
    return new Promise<void>((resolve, reject) => {
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
        audio.play().catch(reject);
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
        } catch (err) {
          // Nếu vẫn bị chặn autoplay (chưa bấm "Bật âm thanh"), báo ra
          // console để dễ chẩn đoán thay vì âm thầm im lặng hoàn toàn.
          console.warn("TV Display: không phát được âm thanh thông báo.", err);
        }
      }
    }
    playingRef.current = false;
  }, []);

  const enqueue = useCallback(
    (
      queueNumber: string,
      driverName: string,
      counterCode: string
    ) => {
      queueRef.current.push(async () => {
        const text = buildAnnouncementText(
          queueNumber,
          driverName,
          counterCode
        );

        // Đọc lần 1
        try {
          const res = await fetch(
            `/api/tts?text=${encodeURIComponent(text)}`
          );

          if (!res.ok) throw new Error("tts route failed");

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);

          try {
            await playRemote(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch {
          // Fallback cũ nếu Google TTS lỗi
          await playLocalClips(
            buildAnnouncementClips(queueNumber, counterCode)
          );
        }

        // Nghỉ một chút trước khi gọi lại
        await new Promise((resolve) => setTimeout(resolve, 700));

        // Đọc lần 2
        try {
          const res = await fetch(
            `/api/tts?text=${encodeURIComponent(text)}`
          );

          if (!res.ok) throw new Error("tts route failed");

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);

          try {
            await playRemote(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch {
          await playLocalClips(
            buildAnnouncementClips(queueNumber, counterCode)
          );
        }
      });

      processQueue();
    },
    [playRemote, playLocalClips, processQueue]
  );

  return { enqueue, unlock, unlocked };
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
  const { enqueue: enqueueAudio, unlock: unlockAudio, unlocked } = useAnnouncer();
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
      const driver = (queueData as AgentQueueRow[] | null)?.find(
        (q) => q.queue_number === c.queue_number
      );

      const driverName = driver?.driver_name?.trim() || "tài xế";

      enqueueAudio(
        c.queue_number!,
        driverName,
        c.counter_code
      );
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
    <div className="flex min-h-screen w-screen flex-col overflow-hidden bg-paper">
      {!unlocked && (
        <button
          onClick={unlockAudio}
          className="w-full bg-warn px-4 py-2 text-center font-body font-semibold text-white hover:bg-warn/90"
          style={{ fontSize: "1vw" }}
        >
          🔊 Bấm vào đây 1 lần để bật âm thanh thông báo cho màn hình này (chỉ cần làm 1 lần mỗi khi mở trang)
        </button>
      )}
      {/* Thanh trên: kiểu bảng điện tử ngân hàng — nền trắng, viền dưới, logo bên trái */}
      <div className="flex items-center justify-between border-b border-line bg-white shadow-sm" style={{ padding: "1.4vw 2.2vw" }}>
        <div>
          <p className="font-body font-semibold uppercase tracking-widest text-brand-500" style={{ fontSize: "1vw" }}>
            Green SM
          </p>
          <p className="font-display font-bold text-brand-900" style={{ fontSize: "2vw" }}>
            Driver Service Center
          </p>
        </div>
        <div className="flex items-center" style={{ gap: "2.2vw" }}>
          {clock && (
            <div className="text-right">
              <p className="font-display font-bold tabular-nums text-brand-900" style={{ fontSize: "2.2vw" }}>
                {clock.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
              <p className="font-body capitalize text-ink/50" style={{ fontSize: "0.9vw" }}>
                {clock.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            </div>
          )}
          <div className="rounded-xl bg-brand-100 text-center" style={{ padding: "0.8vw 1.6vw" }}>
            <p className="font-body uppercase tracking-wide text-brand-700" style={{ fontSize: "0.85vw" }}>Đang chờ</p>
            <p className="font-display font-bold text-brand-900" style={{ fontSize: "2.2vw" }}>{totalWaiting}</p>
          </div>
        </div>
      </div>

      <div className="flex-1" style={{ padding: "1.6vw 2.2vw" }}>
        {/* Theo từng quầy: LUÔN 1 hàng ngang, không xuống dòng theo breakpoint —
            phù hợp màn hình cố định lớn (TV 75 inch) */}
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${Math.max(counters.length, 1)}, 1fr)`, gap: "1.2vw" }}
        >
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
                <div className="bg-brand-700" style={{ padding: "0.7vw 1vw" }}>
                  <p
                    className="truncate font-body font-semibold uppercase tracking-wide text-white"
                    style={{ fontSize: "0.95vw" }}
                  >
                    {c.counter_name}
                  </p>
                </div>
                <div
                  className={`text-center ${busy ? "bg-brand-100" : "bg-paper"}`}
                  style={{ padding: "1.6vw 1vw" }}
                >
                  <p
                    className={`font-display font-extrabold ${busy ? "text-brand-900" : "text-ink/25"}`}
                    style={{ fontSize: "4.2vw", lineHeight: 1.1 }}
                  >
                    {busy ? c.queue_number : "—"}
                  </p>
                  {!busy && (
                    <p
                      className="mt-1 font-body uppercase tracking-wide text-ink/40"
                      style={{ fontSize: "0.8vw" }}
                    >
                      {c.counter_status === "AVAILABLE"
                        ? "Sẵn sàng"
                        : c.counter_status === "OFFLINE"
                        ? "Offline"
                        : "Đã đóng"}
                    </p>
                  )}
                </div>

                <div className="flex-1 border-t border-line" style={{ padding: "0.9vw 1vw" }}>
                  <p
                    className="mb-2 font-body font-semibold uppercase tracking-wide text-ink/40"
                    style={{ fontSize: "0.8vw" }}
                  >
                    Đang chờ ({myWaiting.length})
                  </p>
                  <div className="space-y-1.5">
                    {myWaiting.map((q) => (
                      <div
                        key={q.ticket_code}
                        className="flex items-baseline justify-between border-b border-line/60 pb-1 last:border-0"
                      >
                        <span className="font-display font-bold text-brand-900" style={{ fontSize: "1.2vw" }}>
                          {q.queue_number}
                        </span>
                        <span
                          className="truncate font-body text-ink/70"
                          style={{ fontSize: "0.95vw", maxWidth: "60%" }}
                        >
                          {q.driver_name}
                        </span>
                      </div>
                    ))}
                    {c.agent_id && myWaiting.length === 0 && (
                      <p className="font-body text-ink/30" style={{ fontSize: "0.9vw" }}>Không có ai chờ.</p>
                    )}
                    {!c.agent_id && (
                      <p className="font-body text-ink/30" style={{ fontSize: "0.9vw" }}>Quầy chưa gán Agent.</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {counters.length === 0 && (
            <p className="font-body text-ink/40" style={{ fontSize: "1vw" }}>Chưa có quầy nào được cấu hình.</p>
          )}
        </div>

        {unassigned.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm" style={{ marginTop: "1.2vw" }}>
            <div className="bg-accent-500" style={{ padding: "0.7vw 1vw" }}>
              <p className="font-body font-semibold uppercase tracking-wide text-white" style={{ fontSize: "0.95vw" }}>
                Chưa phân bổ Agent ({unassigned.length})
              </p>
            </div>
            <div className="flex flex-wrap" style={{ padding: "1vw", gap: "0.4vw 2vw" }}>
              {unassigned.map((q) => (
                <div key={q.ticket_code} className="flex items-baseline gap-2">
                  <span className="font-display font-bold text-brand-900" style={{ fontSize: "1.2vw" }}>
                    {q.queue_number}
                  </span>
                  <span className="font-body text-ink/70" style={{ fontSize: "0.95vw" }}>{q.driver_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
