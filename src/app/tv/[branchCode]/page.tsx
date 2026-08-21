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

function normalizeQueue(
  value: string | null | undefined
) {
  return value?.trim().toUpperCase() ?? "";
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
) {
  const queueNumber = normalizeQueue(
    queue.queue_number
  );

  if (!queueNumber) {
    return false;
  }

  return counters.some(
    (counter) =>
      normalizeQueue(counter.queue_number) ===
        queueNumber &&
      Boolean(counter.called_at)
  );
}

/* ============================================================
   GOOGLE TTS
============================================================ */

async function fetchGoogleTTS(
  text: string
): Promise<string> {
  const response = await fetch(
    `/api/tts?text=${encodeURIComponent(text)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `TTS API failed: ${response.status}`
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "";

  if (!contentType.includes("audio")) {
    throw new Error(
      `TTS response is not audio: ${contentType}`
    );
  }

  const blob = await response.blob();

  if (!blob.size) {
    throw new Error("TTS audio rỗng");
  }

  return URL.createObjectURL(blob);
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

const SMALL_NUMBER_WORDS = [
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
  "hai mươi",
];

function counterNumberToWords(
  counterCode: string
) {
  const stripped =
    counterCode.replace(/^0+/, "") || "0";

  const n = Number.parseInt(
    stripped,
    10
  );

  if (
    !Number.isNaN(n) &&
    n >= 0 &&
    n < SMALL_NUMBER_WORDS.length
  ) {
    return SMALL_NUMBER_WORDS[n];
  }

  return [...counterCode]
    .map(
      (char) =>
        DIGIT_WORD[char.toUpperCase()] ??
        char
    )
    .join(" ");
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterCode: string
) {
  const queueWords = [
    ...queueNumber.toUpperCase(),
  ]
    .map(
      (char) =>
        DIGIT_WORD[char] ?? char
    )
    .join(" ");

  const counterWords =
    counterNumberToWords(
      counterCode
    );

  /*
   * Quan trọng:
   *
   * Không thêm dấu câu kỳ quặc hoặc ký tự
   * khiến Google TTS đọc sai tên.
   */

  return `Kính mời tài xế có số ${queueWords}, ${driverName}, đến quầy số ${counterWords}`;
}

/* ============================================================
   AUDIO ANNOUNCER
============================================================ */

function useAnnouncer() {
  /*
   * CHỈ MỘT AUDIO ELEMENT DUY NHẤT.
   */
  const audioRef =
    useRef<HTMLAudioElement | null>(
      null
    );

  /*
   * Giữ Blob URL hiện tại để không revoke
   * quá sớm.
   */
  const objectUrlRef =
    useRef<string | null>(null);

  /*
   * Không cho 2 announcement chạy cùng lúc.
   */
  const playingRef =
    useRef(false);

  /*
   * Queue announcement.
   */
  const queueRef =
    useRef<
      Array<{
        queueNumber: string;
        driverName: string;
        counterCode: string;
      }>
    >([]);

  /*
   * Unlock state thực tế.
   *
   * Không dùng state trong processQueue
   * để tránh closure cũ.
   */
  const unlockedRef =
    useRef(false);

  const [unlocked, setUnlocked] =
    useState(false);

  /* ==========================================================
     GET AUDIO
  ========================================================== */

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio =
        document.createElement("audio");

      audio.preload = "auto";
      audio.volume = 1;
      audio.muted = false;

      audio.setAttribute(
        "playsinline",
        "true"
      );

      audio.setAttribute(
        "webkit-playsinline",
        "true"
      );

      audioRef.current = audio;
    }

    return audioRef.current;
  }, []);

  /* ==========================================================
     CLEAN OLD BLOB
  ========================================================== */

  const cleanupObjectUrl =
    useCallback(() => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(
          objectUrlRef.current
        );

        objectUrlRef.current = null;
      }
    }, []);

  /* ==========================================================
     UNLOCK AUDIO
  ========================================================== */

  const unlock = useCallback(
    async () => {
      const audio = getAudio();

      try {
        console.log(
          "[TV AUDIO] Unlocking..."
        );

        /*
         * Tuyệt đối không muted.
         */
        audio.muted = false;
        audio.volume = 1;

        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        /*
         * Dùng một file audio thật.
         *
         * Không dùng speechSynthesis.
         */
        audio.src =
          "/audio/tv/intro.mp3";

        audio.load();

        await audio.play();

        /*
         * Nếu play thành công,
         * browser đã cho phép media element này
         * phát sau user gesture.
         */
        unlockedRef.current = true;

        setUnlocked(true);

        console.log(
          "[TV AUDIO] UNLOCK SUCCESS"
        );

        /*
         * Pause ngay sau khi xác nhận browser
         * đã cho phép play.
         */
        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        /*
         * Process những announcement đang chờ.
         */
        setTimeout(() => {
          void processQueue();
        }, 0);

        return true;
      } catch (error) {
        console.error(
          "[TV AUDIO] UNLOCK FAILED",
          error
        );

        unlockedRef.current = false;

        setUnlocked(false);

        return false;
      }
    },
    [getAudio]
  );

  /* ==========================================================
     PLAY GOOGLE TTS
  ========================================================== */

  const playGoogleTTS =
    useCallback(
      async (
        text: string
      ) => {
        const audio = getAudio();

        /*
         * Xóa URL cũ.
         */
        cleanupObjectUrl();

        /*
         * Lấy Google TTS.
         */
        const objectUrl =
          await fetchGoogleTTS(text);

        objectUrlRef.current =
          objectUrl;

        console.log(
          "[TV AUDIO] Google TTS received",
          {
            size:
              objectUrl.length,
          }
        );

        /*
         * Reset audio element.
         */
        audio.pause();

        audio.muted = false;
        audio.volume = 1;

        try {
          audio.currentTime = 0;
        } catch {}

        /*
         * Gán Blob URL.
         */
        audio.src = objectUrl;

        /*
         * Quan trọng:
         * load() trước play().
         */
        audio.load();

        /*
         * Chờ browser load audio.
         */
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let done = false;

            const cleanup =
              () => {
                audio.oncanplay = null;
                audio.oncanplaythrough =
                  null;
                audio.onerror = null;
              };

            const success = () => {
              if (done) return;

              done = true;
              cleanup();
              resolve();
            };

            const fail = () => {
              if (done) return;

              done = true;
              cleanup();

              reject(
                new Error(
                  "Audio element không load được Google TTS"
                )
              );
            };

            audio.oncanplay =
              success;

            audio.oncanplaythrough =
              success;

            audio.onerror =
              fail;

            /*
             * Trường hợp audio đã load
             * trước khi handler được gắn.
             */
            if (
              audio.readyState >= 3
            ) {
              success();
            }
          }
        );

        /*
         * Kiểm tra lại unlock.
         */
        if (!unlockedRef.current) {
          throw new Error(
            "Audio chưa được unlock"
          );
        }

        /*
         * Phát.
         */
        console.log(
          "[TV AUDIO] PLAY GOOGLE TTS"
        );

        await audio.play();

        /*
         * Chờ phát xong.
         */
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let finished = false;

            const cleanup =
              () => {
                audio.onended = null;
                audio.onerror = null;
              };

            const done = () => {
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
                new Error(
                  "Google TTS playback failed"
                )
              );
            };

            audio.onended = done;
            audio.onerror = fail;

            /*
             * Nếu audio đã ended trước khi
             * handler được set.
             */
            if (
              audio.ended
            ) {
              done();
            }
          }
        );

        /*
         * Chỉ revoke sau khi phát xong.
         */
        cleanupObjectUrl();

        console.log(
          "[TV AUDIO] PLAYBACK COMPLETE"
        );
      },
      [
        getAudio,
        cleanupObjectUrl,
      ]
    );

  /* ==========================================================
     PLAY WITH RETRY
  ========================================================== */

  const playAnnouncement =
    useCallback(
      async (
        queueNumber: string,
        driverName: string,
        counterCode: string
      ) => {
        const text =
          buildAnnouncementText(
            queueNumber,
            driverName,
            counterCode
          );

        console.log(
          "[TV AUDIO] ANNOUNCEMENT",
          {
            queueNumber,
            driverName,
            counterCode,
            text,
          }
        );

        /*
         * Lần 1.
         */
        try {
          await playGoogleTTS(
            text
          );

          return;
        } catch (error) {
          console.error(
            "[TV AUDIO] PLAY FAILED #1",
            error
          );
        }

        /*
         * Chờ một chút rồi retry.
         */
        await new Promise<void>(
          (resolve) =>
            setTimeout(
              resolve,
              300
            )
        );

        /*
         * Lần 2.
         */
        try {
          await playGoogleTTS(
            text
          );

          return;
        } catch (error) {
          console.error(
            "[TV AUDIO] PLAY FAILED #2",
            error
          );
        }

        console.error(
          "[TV AUDIO] FINAL AUDIO FAILURE",
          {
            queueNumber,
            driverName,
            counterCode,
            text,
          }
        );
      },
      [playGoogleTTS]
    );

  /* ==========================================================
     PROCESS QUEUE
  ========================================================== */

  const processQueue =
    useCallback(async () => {
      if (playingRef.current) {
        return;
      }

      if (!unlockedRef.current) {
        console.warn(
          "[TV AUDIO] Waiting for unlock"
        );

        return;
      }

      if (
        queueRef.current.length === 0
      ) {
        return;
      }

      playingRef.current = true;

      try {
        while (
          queueRef.current.length >
          0
        ) {
          const job =
            queueRef.current.shift();

          if (!job) {
            continue;
          }

          await playAnnouncement(
            job.queueNumber,
            job.driverName,
            job.counterCode
          );

          /*
           * Khoảng nghỉ nhỏ giữa 2 lượt.
           */
          await new Promise<void>(
            (resolve) =>
              setTimeout(
                resolve,
                200
              )
          );
        }
      } finally {
        playingRef.current = false;

        /*
         * Nếu có job phát sinh đúng lúc
         * finally chạy.
         */
        if (
          unlockedRef.current &&
          queueRef.current.length >
            0
        ) {
          setTimeout(() => {
            void processQueue();
          }, 0);
        }
      }
    }, [playAnnouncement]);

  /* ==========================================================
     ENQUEUE
  ========================================================== */

  const enqueue =
    useCallback(
      (
        queueNumber: string,
        driverName: string,
        counterCode: string
      ) => {
        if (
          !queueNumber ||
          !driverName ||
          !counterCode
        ) {
          console.warn(
            "[TV AUDIO] Invalid announcement data",
            {
              queueNumber,
              driverName,
              counterCode,
            }
          );

          return;
        }

        queueRef.current.push({
          queueNumber:
            queueNumber.trim(),
          driverName:
            driverName.trim(),
          counterCode:
            counterCode.trim(),
        });

        console.log(
          "[TV AUDIO] ENQUEUED",
          {
            queueNumber,
            driverName,
            counterCode,
            queueLength:
              queueRef.current
                .length,
            unlocked:
              unlockedRef.current,
          }
        );

        if (unlockedRef.current) {
          void processQueue();
        }
      },
      [processQueue]
    );

  /* ==========================================================
     CLEANUP
  ========================================================== */

  useEffect(() => {
    return () => {
      try {
        audioRef.current?.pause();
      } catch {}

      cleanupObjectUrl();

      queueRef.current = [];
    };
  }, [cleanupObjectUrl]);

  /* ==========================================================
     RETURN
  ========================================================== */

  return {
    enqueue,
    unlock,
    unlocked,
  };
}

/* ============================================================
   CLOCK
============================================================ */

function useClock() {
  const [now, setNow] =
    useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    const timer =
      window.setInterval(() => {
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

  const branchCode =
    params.branchCode;

  const [
    counters,
    setCounters,
  ] = useState<
    CounterStatusRow[]
  >([]);

  const [
    agentQueue,
    setAgentQueue,
  ] = useState<
    AgentQueueRow[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<
    string | null
  >(null);

  /*
   * Đã phát announcement nào.
   *
   * key =
   * counter_code + called_at
   */
  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  /*
   * Chặn nhiều refresh chạy cùng lúc.
   */
  const loadingRef =
    useRef(false);

  /*
   * Debounce realtime.
   */
  const refreshTimer =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
  } = useAnnouncer();

  const clock = useClock();

  /* ==========================================================
     LOAD COUNTERS
  ========================================================== */

  const loadCounters =
    useCallback(async () => {
      const {
        data,
        error,
      } = await supabase.rpc(
        "tv_counter_status",
        {
          p_branch_code:
            branchCode,
        }
      );

      if (error) {
        console.error(
          "[TV] tv_counter_status error",
          error
        );

        setErrorMessage(
          error.message
        );

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
          p_branch_code:
            branchCode,
        }
      );

      if (error) {
        console.error(
          "[TV] tv_agent_queue_list error",
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
              Boolean(
                counter.queue_number
              ) &&
              Boolean(
                counter.called_at
              )
          );

        for (const call of activeCalls) {
          if (
            !call.queue_number ||
            !call.called_at
          ) {
            continue;
          }

          /*
           * Một lần gọi = một called_at.
           */
          const callKey =
            `${call.counter_code}:${call.called_at}`;

          if (
            announcedCalls.current.has(
              callKey
            )
          ) {
            continue;
          }

          const normalizedQueue =
            normalizeQueue(
              call.queue_number
            );

          /*
           * Tìm tài xế.
           */
          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) ===
                normalizedQueue
            );

          /*
           * Không có tên thì chưa phát.
           */
          if (
            !driver?.driver_name?.trim()
          ) {
            console.warn(
              "[TV] Driver not found for call",
              {
                queue:
                  call.queue_number,
                calledAt:
                  call.called_at,
                counter:
                  call.counter_code,
              }
            );

            continue;
          }

          /*
           * Mark trước enqueue.
           *
           * Tránh realtime + watchdog
           * tạo duplicate.
           */
          announcedCalls.current.add(
            callKey
          );

          console.log(
            "[TV] CALL DETECTED",
            {
              queue:
                call.queue_number,
              driver:
                driver.driver_name,
              counter:
                call.counter_code,
              calledAt:
                call.called_at,
            }
          );

          enqueueAudio(
            call.queue_number,
            driver.driver_name.trim(),
            call.counter_code
          );
        }

        /*
         * Giới hạn memory.
         */
        if (
          announcedCalls.current
            .size > 500
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

  const refresh =
    useCallback(async () => {
      if (loadingRef.current) {
        return;
      }

      loadingRef.current = true;

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
          "[TV] refresh failed",
          error
        );
      } finally {
        loadingRef.current =
          false;
      }
    }, [
      loadCounters,
      loadAgentQueue,
      handleCalls,
    ]);

  /* ==========================================================
     REALTIME REFRESH
  ========================================================== */

  const scheduleRefresh =
    useCallback(() => {
      if (refreshTimer.current) {
        clearTimeout(
          refreshTimer.current
        );
      }

      refreshTimer.current =
        setTimeout(() => {
          void refresh();
        }, 50);
    }, [refresh]);

  /* ==========================================================
     REALTIME
  ========================================================== */

  useEffect(() => {
    if (!branchCode) {
      return;
    }

    /*
     * Initial.
     */
    void refresh();

    /*
     * Realtime.
     */
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
          (payload) => {
            console.log(
              "[TV REALTIME] queue_tickets",
              payload
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
          (payload) => {
            console.log(
              "[TV REALTIME] service_cases",
              payload
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
          (payload) => {
            console.log(
              "[TV REALTIME] counters",
              payload
            );

            scheduleRefresh();
          }
        )
        .subscribe((status) => {
          console.log(
            "[TV REALTIME STATUS]",
            status
          );
        });

    /*
     * Watchdog 5s.
     *
     * Không phải đường chính.
     * Chỉ để cứu trường hợp Realtime miss.
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

        refreshTimer.current = null;
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
    scheduleRefresh,
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
          🔊 Bấm vào đây 1 lần để bật
          âm thanh thông báo
        </button>
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
                    weekday:
                      "long",
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
            Đang tải thông tin
            quầy...
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
                            Không có ai
                            chờ.
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
                    minHeight: "15vw",
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
                      Branch:{" "}
                      {branchCode}
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
                  marginTop: "1.2vw",
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
                    {unassigned.length})
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
