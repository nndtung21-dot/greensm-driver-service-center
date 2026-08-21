"use client";

import {
  useCallback,
  useEffect,
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

/* ============================================================
   HELPERS
============================================================ */

function normalizeQueue(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
) {
  const queueNumber = normalizeQueue(queue.queue_number);

  return counters.some(
    (counter) =>
      normalizeQueue(counter.queue_number) === queueNumber &&
      Boolean(counter.called_at)
  );
}

/* ============================================================
   ANNOUNCEMENT TEXT
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
};

function queueNumberToWords(queueNumber: string) {
  return [...queueNumber.toUpperCase()]
    .map((char) => DIGIT_WORD[char] ?? char)
    .join(" ");
}

function counterNumberToWords(counterCode: string) {
  const clean = counterCode
    .trim()
    .toUpperCase()
    .replace(/^0+/, "");

  if (!clean) {
    return "không";
  }

  const smallNumbers: Record<string, string> = {
    "1": "một",
    "2": "hai",
    "3": "ba",
    "4": "bốn",
    "5": "năm",
    "6": "sáu",
    "7": "bảy",
    "8": "tám",
    "9": "chín",
    "10": "mười",
    "11": "mười một",
    "12": "mười hai",
    "13": "mười ba",
    "14": "mười bốn",
    "15": "mười lăm",
    "16": "mười sáu",
    "17": "mười bảy",
    "18": "mười tám",
    "19": "mười chín",
    "20": "hai mươi",
  };

  if (smallNumbers[clean]) {
    return smallNumbers[clean];
  }

  return [...clean]
    .map((char) => DIGIT_WORD[char] ?? char)
    .join(" ");
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterCode: string
) {
  const queueText = queueNumberToWords(queueNumber);
  const counterText = counterNumberToWords(counterCode);

  const cleanName = driverName
    .trim()
    .replace(/\s+/g, " ");

  return `Kính mời tài xế có số ${queueText}, ${cleanName}, đến quầy số ${counterText}.`;
}

/* ============================================================
   TTS
============================================================ */

function useGoogleTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioUrlRef = useRef<string | null>(null);

  const queueRef = useRef<
    Array<{
      id: string;
      text: string;
    }>
  >([]);

  const processingRef = useRef(false);

  const unlockedRef = useRef(false);

  const [unlocked, setUnlocked] = useState(false);

  const [audioError, setAudioError] = useState<string | null>(
    null
  );

  /* ==========================================================
     CREATE AUDIO
  ========================================================== */

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = document.createElement("audio");

      audio.preload = "auto";
      audio.volume = 1;
      audio.controls = false;

      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "");

      audioRef.current = audio;
    }

    return audioRef.current;
  }, []);

  /* ==========================================================
     RELEASE OLD OBJECT URL
  ========================================================== */

  const releaseAudioUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  /* ==========================================================
     GET GOOGLE TTS AUDIO
  ========================================================== */

  const fetchTTS = useCallback(async (text: string) => {
    const response = await fetch(
      `/api/tts?text=${encodeURIComponent(text)}`,
      {
        method: "GET",
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");

      throw new Error(
        `TTS HTTP ${response.status}${
          body ? `: ${body}` : ""
        }`
      );
    }

    const contentType =
      response.headers.get("content-type") ?? "";

    if (
      !contentType.includes("audio") &&
      !contentType.includes("mpeg")
    ) {
      throw new Error(
        `TTS trả về Content-Type không phải audio: ${contentType}`
      );
    }

    const blob = await response.blob();

    if (!blob.size) {
      throw new Error("TTS trả về audio rỗng");
    }

    return blob;
  }, []);

  /* ==========================================================
     PLAY BLOB
  ========================================================== */

  const playBlob = useCallback(
    async (blob: Blob) => {
      const audio = getAudio();

      releaseAudioUrl();

      const url = URL.createObjectURL(blob);

      audioUrlRef.current = url;

      audio.pause();

      try {
        audio.currentTime = 0;
      } catch {}

      audio.src = url;
      audio.load();

      await new Promise<void>((resolve, reject) => {
        let finished = false;

        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          audio.onabort = null;
        };

        const finish = () => {
          if (finished) return;

          finished = true;
          cleanup();
          resolve();
        };

        const fail = () => {
          if (finished) return;

          finished = true;
          cleanup();

          reject(
            new Error("HTMLAudioElement không phát được audio")
          );
        };

        audio.onended = finish;
        audio.onerror = fail;
        audio.onabort = fail;

        const promise = audio.play();

        promise.catch((error) => {
          console.error(
            "[TV AUDIO] audio.play() rejected:",
            error
          );

          fail();
        });
      });
    },
    [getAudio, releaseAudioUrl]
  );

  /* ==========================================================
     UNLOCK
  ========================================================== */

  const unlock = useCallback(async () => {
    console.log("[TV AUDIO] Unlock bắt đầu");

    setAudioError(null);

    try {
      const audio = getAudio();

      /*
       * Quan trọng:
       *
       * Không dùng silence.
       * Không dùng speechSynthesis.
       * Không dùng MP3 local.
       *
       * Dùng chính Google TTS để browser xác nhận
       * quyền phát audio.
       */

      const testText =
        "Âm thanh thông báo đã được bật.";

      const blob = await fetchTTS(testText);

      await playBlob(blob);

      /*
       * Audio đã thực sự play được trong user gesture.
       */
      unlockedRef.current = true;
      setUnlocked(true);

      console.log("[TV AUDIO] GOOGLE TTS UNLOCKED");

      /*
       * Xử lý các cuộc gọi đang chờ.
       */
      setTimeout(() => {
        void processQueue();
      }, 0);

      return true;
    } catch (error) {
      console.error(
        "[TV AUDIO] UNLOCK FAILED:",
        error
      );

      unlockedRef.current = false;
      setUnlocked(false);

      setAudioError(
        error instanceof Error
          ? error.message
          : "Không bật được âm thanh"
      );

      return false;
    }
  }, [fetchTTS, getAudio, playBlob]);

  /* ==========================================================
     PROCESS QUEUE
  ========================================================== */

  const processQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }

    if (!unlockedRef.current) {
      console.warn(
        "[TV AUDIO] Chưa unlock, chờ user bật âm thanh"
      );

      return;
    }

    if (queueRef.current.length === 0) {
      return;
    }

    processingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();

        if (!item) {
          continue;
        }

        console.log(
          "[TV AUDIO] Đang gọi:",
          item.text
        );

        try {
          /*
           * Mỗi lần gọi:
           * 1 request Google TTS
           * 1 audio element
           */
          const blob = await fetchTTS(item.text);

          await playBlob(blob);

          console.log(
            "[TV AUDIO] Phát thành công:",
            item.text
          );
        } catch (error) {
          console.error(
            "[TV AUDIO] Phát thất bại:",
            error
          );

          setAudioError(
            error instanceof Error
              ? error.message
              : "Không phát được âm thanh"
          );
        }

        /*
         * Nghỉ rất ngắn giữa 2 cuộc gọi.
         */
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 250);
        });
      }
    } finally {
      processingRef.current = false;
    }
  }, [fetchTTS, playBlob]);

  /* ==========================================================
     ENQUEUE
  ========================================================== */

  const enqueue = useCallback(
    (
      queueNumber: string,
      driverName: string,
      counterCode: string
    ) => {
      const text = buildAnnouncementText(
        queueNumber,
        driverName,
        counterCode
      );

      const id =
        `${counterCode}-${queueNumber}-${Date.now()}`;

      console.log(
        "[TV AUDIO] QUEUE:",
        {
          id,
          queueNumber,
          driverName,
          counterCode,
          text,
        }
      );

      /*
       * Gọi 2 lần như yêu cầu.
       *
       * Lần 1 ngay.
       * Lần 2 sau khi lần 1 kết thúc.
       */
      queueRef.current.push({
        id: `${id}-1`,
        text,
      });

      queueRef.current.push({
        id: `${id}-2`,
        text,
      });

      void processQueue();
    },
    [processQueue]
  );

  /* ==========================================================
     CLEANUP
  ========================================================== */

  useEffect(() => {
    return () => {
      const audio = audioRef.current;

      if (audio) {
        audio.pause();
        audio.src = "";
      }

      releaseAudioUrl();

      queueRef.current = [];
    };
  }, [releaseAudioUrl]);

  return {
    enqueue,
    unlock,
    unlocked,
    audioError,
  };
}

/* ============================================================
   CLOCK
============================================================ */

function useClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return now;
}

/* ============================================================
   TV DISPLAY
============================================================ */

export default function TvDisplayPage() {
  const params =
    useParams<{
      branchCode: string;
    }>();

  const branchCode = params.branchCode;

  const [counters, setCounters] =
    useState<CounterStatusRow[]>([]);

  const [agentQueue, setAgentQueue] =
    useState<AgentQueueRow[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  /*
   * counter_code + called_at
   *
   * Một cuộc gọi chỉ được announce một lần.
   */
  const announcedCalls =
    useRef<Set<string>>(new Set());

  const refreshTimer =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const refreshingRef =
    useRef(false);

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
    audioError,
  } = useGoogleTTS();

  const clock = useClock();

  /* ==========================================================
     LOAD COUNTERS
  ========================================================== */

  const loadCounters = useCallback(async () => {
    const {
      data,
      error,
    } = await supabase.rpc(
      "tv_counter_status",
      {
        p_branch_code: branchCode,
      }
    );

    if (error) {
      console.error(
        "[TV] tv_counter_status:",
        error
      );

      setErrorMessage(error.message);

      return [];
    }

    const result =
      ((data ?? []) as CounterStatusRow[])
        .slice()
        .sort(
          (a, b) =>
            a.display_order -
            b.display_order
        );

    setCounters(result);

    return result;
  }, [branchCode]);

  /* ==========================================================
     LOAD AGENT QUEUE
  ========================================================== */

  const loadAgentQueue =
    useCallback(async () => {
      const {
        data,
        error,
      } = await supabase.rpc(
        "tv_agent_queue_list",
        {
          p_branch_code: branchCode,
        }
      );

      if (error) {
        console.error(
          "[TV] tv_agent_queue_list:",
          error
        );

        return [];
      }

      const result =
        ((data ?? []) as AgentQueueRow[])
          .slice()
          .sort(
            (a, b) =>
              new Date(
                a.created_at
              ).getTime() -
              new Date(
                b.created_at
              ).getTime()
          );

      setAgentQueue(result);

      return result;
    }, [branchCode]);

  /* ==========================================================
     HANDLE CALLS
  ========================================================== */

  const handleCalls =
    useCallback(
      (
        counterList: CounterStatusRow[],
        queueList: AgentQueueRow[]
      ) => {
        const activeCalls =
          counterList.filter(
            (counter) =>
              Boolean(counter.queue_number) &&
              Boolean(counter.called_at)
          );

        for (const call of activeCalls) {
          if (
            !call.queue_number ||
            !call.called_at
          ) {
            continue;
          }

          const callKey =
            `${call.counter_code}:${call.called_at}`;

          /*
           * Đã xử lý.
           */
          if (
            announcedCalls.current.has(
              callKey
            )
          ) {
            continue;
          }

          const targetQueue =
            normalizeQueue(
              call.queue_number
            );

          /*
           * Tìm đúng ticket.
           */
          const driver =
            queueList.find(
              (item) =>
                normalizeQueue(
                  item.queue_number
                ) === targetQueue
            );

          /*
           * Chưa có tên tài xế thì đợi
           * refresh tiếp theo.
           */
          if (
            !driver?.driver_name?.trim()
          ) {
            console.warn(
              "[TV] Không tìm thấy tên tài xế:",
              call.queue_number
            );

            continue;
          }

          /*
           * Mark ngay trước khi enqueue.
           */
          announcedCalls.current.add(
            callKey
          );

          console.log(
            "[TV] NEW CALL",
            {
              queue: call.queue_number,
              name: driver.driver_name,
              counter: call.counter_code,
              calledAt: call.called_at,
            }
          );

          enqueueAudio(
            call.queue_number,
            driver.driver_name,
            call.counter_code
          );
        }

        /*
         * Giới hạn memory.
         */
        if (
          announcedCalls.current.size >
          500
        ) {
          const values =
            Array.from(
              announcedCalls.current
            );

          announcedCalls.current =
            new Set(
              values.slice(-200)
            );
        }
      },
      [enqueueAudio]
    );

  /* ==========================================================
     REFRESH
  ========================================================== */

  const refresh = useCallback(async () => {
    if (refreshingRef.current) {
      return;
    }

    refreshingRef.current = true;

    try {
      const [
        counterList,
        queueList,
      ] = await Promise.all([
        loadCounters(),
        loadAgentQueue(),
      ]);

      setLoading(false);
      setErrorMessage(null);

      handleCalls(
        counterList,
        queueList
      );
    } catch (error) {
      console.error(
        "[TV] Refresh failed:",
        error
      );
    } finally {
      refreshingRef.current = false;
    }
  }, [
    loadCounters,
    loadAgentQueue,
    handleCalls,
  ]);

  /* ==========================================================
     REALTIME
  ========================================================== */

  useEffect(() => {
    if (!branchCode) {
      return;
    }

    void refresh();

    const scheduleRefresh = () => {
      if (refreshTimer.current) {
        clearTimeout(
          refreshTimer.current
        );
      }

      /*
       * Chỉ delay 50ms để gom các event
       * cùng transaction.
       */
      refreshTimer.current =
        setTimeout(() => {
          void refresh();
        }, 50);
    };

    const channel =
      supabase
        .channel(
          `tv-display-${branchCode}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "queue_tickets",
          },
          () => {
            console.log(
              "[TV REALTIME] queue_tickets"
            );

            scheduleRefresh();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "service_cases",
          },
          () => {
            console.log(
              "[TV REALTIME] service_cases"
            );

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
            console.log(
              "[TV REALTIME] counters"
            );

            scheduleRefresh();
          }
        )
        .subscribe((status) => {
          console.log(
            "[TV REALTIME]",
            status
          );
        });

    /*
     * Watchdog 5 giây.
     */
    const watchdog =
      window.setInterval(() => {
        void refresh();
      }, 5000);

    return () => {
      if (refreshTimer.current) {
        clearTimeout(
          refreshTimer.current
        );
      }

      window.clearInterval(
        watchdog
      );

      void supabase.removeChannel(
        channel
      );
    };
  }, [
    branchCode,
    refresh,
  ]);

  /* ==========================================================
     WAITING BY AGENT
  ========================================================== */

  const waitingByAgent =
    new Map<
      string,
      AgentQueueRow[]
    >();

  for (const queue of agentQueue) {
    if (!queue.agent_id) {
      continue;
    }

    const current =
      waitingByAgent.get(
        queue.agent_id
      ) ?? [];

    current.push(queue);

    waitingByAgent.set(
      queue.agent_id,
      current
    );
  }

  /* ==========================================================
     UNASSIGNED
  ========================================================== */

  const unassigned =
    agentQueue.filter(
      (queue) =>
        !queue.agent_id
    );

  /* ==========================================================
     TOTAL WAITING
  ========================================================== */

  const totalWaiting =
    agentQueue.filter(
      (queue) =>
        !isCalledQueue(
          queue,
          counters
        )
    ).length;

  /* ==========================================================
     RENDER
  ========================================================== */

  return (
    <div className="flex min-h-screen w-screen flex-col overflow-hidden bg-paper">

      {/* ======================================================
          AUDIO UNLOCK
      ====================================================== */}

      {!unlocked && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio();
          }}
          className="w-full bg-warn px-4 py-3 text-center font-body font-semibold text-white hover:bg-warn/90"
          style={{
            fontSize: "1vw",
          }}
        >
          🔊 BẤM VÀO ĐÂY ĐỂ BẬT ÂM THANH
          GOOGLE
        </button>
      )}

      {audioError && (
        <div
          className="w-full bg-red-600 px-4 py-2 text-center font-body text-white"
          style={{
            fontSize: "0.8vw",
          }}
        >
          Audio lỗi: {audioError}
        </div>
      )}

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div
        className="flex items-center justify-between border-b border-line bg-white shadow-sm"
        style={{
          padding:
            "1.4vw 2.2vw",
        }}
      >
        <div>
          <p
            className="font-body font-semibold uppercase tracking-widest text-brand-500"
            style={{
              fontSize: "1vw",
            }}
          >
            Green SM
          </p>

          <p
            className="font-display font-bold text-brand-900"
            style={{
              fontSize: "2vw",
            }}
          >
            Driver Service Center
          </p>
        </div>

        <div
          className="flex items-center"
          style={{
            gap: "2.2vw",
          }}
        >
          {clock && (
            <div className="text-right">
              <p
                className="font-display font-bold tabular-nums text-brand-900"
                style={{
                  fontSize: "2.2vw",
                }}
              >
                {clock.toLocaleTimeString(
                  "vi-VN",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }
                )}
              </p>

              <p
                className="font-body capitalize text-ink/50"
                style={{
                  fontSize: "0.9vw",
                }}
              >
                {clock.toLocaleDateString(
                  "vi-VN",
                  {
                    weekday: "long",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  }
                )}
              </p>
            </div>
          )}

          <div
            className="rounded-xl bg-brand-100 text-center"
            style={{
              padding:
                "0.8vw 1.6vw",
            }}
          >
            <p
              className="font-body uppercase tracking-wide text-brand-700"
              style={{
                fontSize: "0.85vw",
              }}
            >
              Đang chờ
            </p>

            <p
              className="font-display font-bold text-brand-900"
              style={{
                fontSize: "2.2vw",
              }}
            >
              {totalWaiting}
            </p>
          </div>
        </div>
      </div>

      {/* ======================================================
          ERROR
      ====================================================== */}

      {errorMessage && (
        <div className="mx-[2.2vw] mt-[1vw] rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          Không tải được dữ liệu:{" "}
          {errorMessage}
        </div>
      )}

      {/* ======================================================
          CONTENT
      ====================================================== */}

      <div
        className="flex-1"
        style={{
          padding:
            "1.6vw 2.2vw",
        }}
      >
        {loading ? (
          <div
            className="flex items-center justify-center text-ink/40"
            style={{
              minHeight: "20vw",
              fontSize: "1.2vw",
            }}
          >
            Đang tải thông tin quầy...
          </div>
        ) : (
          <>
            {/* ==================================================
                COUNTERS
            ================================================== */}

            <div
              className="grid"
              style={{
                gridTemplateColumns:
                  `repeat(${Math.max(
                    counters.length,
                    1
                  )}, minmax(0, 1fr))`,
                gap: "1.2vw",
              }}
            >
              {counters.map(
                (counter) => {
                  const busy =
                    Boolean(
                      counter.queue_number &&
                      counter.called_at
                    );

                  const myAgentQueue =
                    counter.agent_id
                      ? (
                          waitingByAgent.get(
                            counter.agent_id
                          ) ?? []
                        )
                      : [];

                  const currentQueue =
                    normalizeQueue(
                      counter.queue_number
                    );

                  const waitingForCounter =
                    myAgentQueue.filter(
                      (queue) =>
                        normalizeQueue(
                          queue.queue_number
                        ) !==
                        currentQueue
                    );

                  return (
                    <div
                      key={
                        counter.counter_code
                      }
                      className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
                    >
                      {/* COUNTER HEADER */}

                      <div
                        className="bg-brand-700"
                        style={{
                          padding:
                            "0.7vw 1vw",
                        }}
                      >
                        <p
                          className="truncate font-body font-semibold uppercase tracking-wide text-white"
                          style={{
                            fontSize:
                              "0.95vw",
                          }}
                        >
                          {
                            counter.counter_name
                          }
                        </p>

                        <p
                          className="font-body text-white/70"
                          style={{
                            fontSize:
                              "0.7vw",
                          }}
                        >
                          {
                            counter.counter_code
                          }
                        </p>
                      </div>

                      {/* CURRENT CALL */}

                      <div
                        className={`text-center ${
                          busy
                            ? "bg-brand-100"
                            : "bg-paper"
                        }`}
                        style={{
                          padding:
                            "1.6vw 1vw",
                        }}
                      >
                        <p
                          className={`font-display font-extrabold ${
                            busy
                              ? "text-brand-900"
                              : "text-ink/25"
                          }`}
                          style={{
                            fontSize:
                              "4.2vw",
                            lineHeight: 1.1,
                          }}
                        >
                          {busy
                            ? counter.queue_number
                            : "—"}
                        </p>

                        {busy ? (
                          <p
                            className="mt-2 font-body font-semibold text-brand-700"
                            style={{
                              fontSize:
                                "0.9vw",
                            }}
                          >
                            ĐANG GỌI
                          </p>
                        ) : (
                          <p
                            className="mt-1 font-body uppercase tracking-wide text-ink/40"
                            style={{
                              fontSize:
                                "0.8vw",
                            }}
                          >
                            {counter.counter_status ===
                            "AVAILABLE"
                              ? "Sẵn sàng"
                              : counter.counter_status ===
                                "OFFLINE"
                              ? "Offline"
                              : counter.counter_status ===
                                "CLOSED"
                              ? "Đã đóng"
                              : "Sẵn sàng"}
                          </p>
                        )}
                      </div>

                      {/* WAITING */}

                      <div
                        className="flex-1 border-t border-line"
                        style={{
                          padding:
                            "0.9vw 1vw",
                        }}
                      >
                        <p
                          className="mb-2 font-body font-semibold uppercase tracking-wide text-ink/40"
                          style={{
                            fontSize:
                              "0.8vw",
                          }}
                        >
                          Đang chờ (
                          {
                            waitingForCounter.length
                          }
                          )
                        </p>

                        {waitingForCounter.length >
                        0 ? (
                          <div className="space-y-1.5">
                            {waitingForCounter.map(
                              (queue) => (
                                <div
                                  key={
                                    queue.ticket_code
                                  }
                                  className="flex items-baseline justify-between border-b border-line/60 pb-1 last:border-0"
                                >
                                  <span
                                    className="font-display font-bold text-brand-900"
                                    style={{
                                      fontSize:
                                        "1.2vw",
                                    }}
                                  >
                                    {
                                      queue.queue_number
                                    }
                                  </span>

                                  <span
                                    className="truncate font-body text-ink/70"
                                    style={{
                                      fontSize:
                                        "0.95vw",
                                      maxWidth:
                                        "60%",
                                    }}
                                  >
                                    {
                                      queue.driver_name
                                    }
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <p
                            className="font-body text-ink/30"
                            style={{
                              fontSize:
                                "0.9vw",
                            }}
                          >
                            Không có ai chờ.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }
              )}

              {counters.length ===
                0 && (
                <div
                  className="col-span-full flex items-center justify-center rounded-2xl border border-dashed border-line bg-white"
                  style={{
                    minHeight:
                      "15vw",
                  }}
                >
                  <div className="text-center">
                    <p
                      className="font-display font-bold text-ink/40"
                      style={{
                        fontSize:
                          "1.6vw",
                      }}
                    >
                      Chưa có quầy
                    </p>

                    <p
                      className="mt-1 font-body text-ink/30"
                      style={{
                        fontSize:
                          "0.9vw",
                      }}
                    >
                      Branch: {branchCode}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ==================================================
                UNASSIGNED
            ================================================== */}

            {unassigned.length >
              0 && (
              <div
                className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
                style={{
                  marginTop:
                    "1.2vw",
                }}
              >
                <div
                  className="bg-accent-500"
                  style={{
                    padding:
                      "0.7vw 1vw",
                  }}
                >
                  <p
                    className="font-body font-semibold uppercase tracking-wide text-white"
                    style={{
                      fontSize:
                        "0.95vw",
                    }}
                  >
                    Chưa phân bổ Agent (
                    {
                      unassigned.length
                    }
                    )
                  </p>
                </div>

                <div
                  className="flex flex-wrap"
                  style={{
                    padding: "1vw",
                    gap:
                      "0.4vw 2vw",
                  }}
                >
                  {unassigned.map(
                    (queue) => (
                      <div
                        key={
                          queue.ticket_code
                        }
                        className="flex items-baseline gap-2"
                      >
                        <span
                          className="font-display font-bold text-brand-900"
                          style={{
                            fontSize:
                              "1.2vw",
                          }}
                        >
                          {
                            queue.queue_number
                          }
                        </span>

                        <span
                          className="font-body text-ink/70"
                          style={{
                            fontSize:
                              "0.95vw",
                          }}
                        >
                          {
                            queue.driver_name
                          }
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
