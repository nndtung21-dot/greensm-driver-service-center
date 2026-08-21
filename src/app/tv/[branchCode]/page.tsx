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
   AUDIO CONFIG
   ============================================================ */

const CLIP_BASE = "/audio/tv/";

const DIGIT_CLIP: Record<string, string> = {
  "0": "so_0",
  "1": "so_1",
  "2": "so_2",
  "3": "so_3",
  "4": "so_4",
  "5": "so_5",
  "6": "so_6",
  "7": "so_7",
  "8": "so_8",
  "9": "so_9",
  A: "chu_a",
};

const REQUIRED_AUDIO_CLIPS = [
  "intro",
  "den_quay_so",
  "so_0",
  "so_1",
  "so_2",
  "so_3",
  "so_4",
  "so_5",
  "so_6",
  "so_7",
  "so_8",
  "so_9",
  "chu_a",
];

/* ============================================================
   AUDIO HELPERS
   ============================================================ */

function stripLeadingZeros(value: string) {
  const stripped = value.replace(/^0+/, "");

  return stripped.length > 0
    ? stripped
    : "0";
}

function buildAnnouncementClips(
  queueNumber: string,
  counterCode: string
): string[] {
  const clips: string[] = ["intro"];

  for (
    const ch of queueNumber.toUpperCase()
  ) {
    const clip = DIGIT_CLIP[ch];

    if (clip) {
      clips.push(clip);
    }
  }

  clips.push("den_quay_so");

  const counterDigits =
    stripLeadingZeros(counterCode);

  for (
    const ch of counterDigits
  ) {
    const clip = DIGIT_CLIP[ch];

    if (clip) {
      clips.push(clip);
    }
  }

  return clips;
}

/* ============================================================
   NORMALIZE
   ============================================================ */

function normalizeQueue(
  value: string | null
) {
  return (
    value
      ?.trim()
      .toUpperCase() ?? ""
  );
}

/* ============================================================
   AUDIO ANNOUNCER
   ============================================================ */

function useAnnouncer() {
  /*
   * IMPORTANT:
   *
   * Mỗi clip chỉ có đúng 1 Audio object.
   *
   * Không tạo Audio mới mỗi lần phát.
   */
  const audioCacheRef =
    useRef<Map<
      string,
      HTMLAudioElement
    >>(new Map());

  /*
   * Queue announcement.
   */
  const queueRef =
    useRef<
      Array<{
        queueNumber: string;
        counterCode: string;
      }>
    >([]);

  /*
   * Chống phát đồng thời.
   */
  const playingRef =
    useRef(false);

  /*
   * State unlock.
   */
  const unlockedRef =
    useRef(false);

  const [unlocked, setUnlocked] =
    useState(false);

  /* ==========================================================
     GET AUDIO
     ========================================================== */

  const getAudio =
    useCallback(
      (clipName: string) => {
        let audio =
          audioCacheRef.current.get(
            clipName
          );

        if (!audio) {
          audio = new Audio(
            `${CLIP_BASE}${clipName}.mp3`
          );

          audio.preload = "auto";
          audio.volume = 1;

          audio.setAttribute(
            "playsinline",
            ""
          );

          /*
           * Một số browser cần muted=false
           * rõ ràng sau unlock.
           */
          audio.muted = false;

          audioCacheRef.current.set(
            clipName,
            audio
          );
        }

        return audio;
      },
      []
    );

  /* ==========================================================
     PRELOAD AUDIO
     ========================================================== */

  const preloadAudio =
    useCallback(() => {
      if (
        typeof window === "undefined"
      ) {
        return;
      }

      for (
        const clip of REQUIRED_AUDIO_CLIPS
      ) {
        const audio =
          getAudio(clip);

        try {
          audio.load();
        } catch (error) {
          console.warn(
            "[TV AUDIO] preload failed:",
            clip,
            error
          );
        }
      }

      console.log(
        "[TV AUDIO] preload started"
      );
    }, [getAudio]);

  /* ==========================================================
     UNLOCK AUDIO
     ========================================================== */

  const unlock =
    useCallback(async () => {
      try {
        console.log(
          "[TV AUDIO] unlocking..."
        );

        const audio =
          getAudio("intro");

        /*
         * Reset.
         */
        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        audio.volume = 0.01;
        audio.muted = false;

        /*
         * QUAN TRỌNG:
         *
         * play() phải được gọi trực tiếp
         * trong user gesture.
         */
        await audio.play();

        /*
         * Browser đã cấp quyền audio.
         */
        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        audio.volume = 1;
        audio.muted = false;

        unlockedRef.current = true;

        setUnlocked(true);

        /*
         * Preload sau khi browser đã unlock.
         */
        preloadAudio();

        console.log(
          "[TV AUDIO] UNLOCKED"
        );

        /*
         * Có queue chờ thì xử lý.
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

        return false;
      }
    }, [
      getAudio,
      preloadAudio,
    ]);

  /* ==========================================================
     PLAY ONE CLIP
     ========================================================== */

  const playClip =
    useCallback(
      async (
        clipName: string
      ) => {
        const audio =
          getAudio(clipName);

        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let finished = false;

            const cleanup = () => {
              audio.onended = null;
              audio.onerror = null;
              audio.onabort = null;
            };

            const success = () => {
              if (finished) {
                return;
              }

              finished = true;

              cleanup();

              resolve();
            };

            const failed = (
              error?: unknown
            ) => {
              if (finished) {
                return;
              }

              finished = true;

              cleanup();

              reject(
                error instanceof Error
                  ? error
                  : new Error(
                      `Audio failed: ${clipName}`
                    )
              );
            };

            /*
             * Reset audio.
             */
            audio.pause();

            try {
              audio.currentTime = 0;
            } catch {}

            audio.volume = 1;
            audio.muted = false;

            audio.onended =
              success;

            audio.onerror = () => {
              failed(
                new Error(
                  `Cannot play ${clipName}.mp3`
                )
              );
            };

            audio.onabort = () => {
              failed(
                new Error(
                  `Audio aborted: ${clipName}`
                )
              );
            };

            /*
             * IMPORTANT:
             *
             * Không tạo Audio mới.
             */
            const playPromise =
              audio.play();

            playPromise.catch(
              (error) => {
                failed(error);
              }
            );
          }
        );
      },
      [getAudio]
    );

  /* ==========================================================
     PLAY FULL ANNOUNCEMENT
     ========================================================== */

  const playAnnouncement =
    useCallback(
      async (
        queueNumber: string,
        counterCode: string
      ) => {
        const clips =
          buildAnnouncementClips(
            queueNumber,
            counterCode
          );

        console.log(
          "[TV AUDIO] PLAY ANNOUNCEMENT",
          {
            queueNumber,
            counterCode,
            clips,
          }
        );

        for (
          const clip of clips
        ) {
          console.log(
            "[TV AUDIO] PLAY CLIP:",
            clip
          );

          await playClip(clip);
        }
      },
      [playClip]
    );

  /* ==========================================================
     PROCESS QUEUE
     ========================================================== */

  const processQueue =
    useCallback(async () => {
      /*
       * Đang phát.
       */
      if (
        playingRef.current
      ) {
        return;
      }

      /*
       * Chưa unlock.
       */
      if (
        !unlockedRef.current
      ) {
        console.warn(
          "[TV AUDIO] waiting for unlock"
        );

        return;
      }

      /*
       * Không có ticket.
       */
      if (
        queueRef.current.length ===
        0
      ) {
        return;
      }

      playingRef.current =
        true;

      try {
        while (
          queueRef.current.length >
          0
        ) {
          const item =
            queueRef.current.shift();

          if (!item) {
            continue;
          }

          try {
            await playAnnouncement(
              item.queueNumber,
              item.counterCode
            );

            console.log(
              "[TV AUDIO] SUCCESS:",
              item.queueNumber,
              item.counterCode
            );
          } catch (error) {
            console.error(
              "[TV AUDIO] PLAY FAILED:",
              {
                queueNumber:
                  item.queueNumber,
                counterCode:
                  item.counterCode,
                error,
              }
            );
          }

          /*
           * Khoảng nghỉ rất ngắn
           * giữa 2 lượt gọi.
           */
          await new Promise<void>(
            (resolve) =>
              setTimeout(
                resolve,
                100
              )
          );
        }
      } finally {
        playingRef.current =
          false;

        /*
         * Race protection.
         */
        if (
          unlockedRef.current &&
          queueRef.current.length >
            0
        ) {
          void processQueue();
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
        console.log(
          "[TV AUDIO] ENQUEUE:",
          {
            queueNumber,
            driverName,
            counterCode,
            unlocked:
              unlockedRef.current,
          }
        );

        queueRef.current.push({
          queueNumber,
          counterCode,
        });

        /*
         * Nếu đã unlock thì phát ngay.
         */
        if (
          unlockedRef.current
        ) {
          void processQueue();
        }
      },
      [processQueue]
    );

  /* ==========================================================
     UNLOCKED EFFECT
     ========================================================== */

  useEffect(() => {
    if (unlocked) {
      void processQueue();
    }
  }, [
    unlocked,
    processQueue,
  ]);

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

    const id =
      window.setInterval(() => {
        setNow(new Date());
      }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, []);

  return now;
}

/* ============================================================
   HELPER
   ============================================================ */

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
) {
  const queueNumber =
    normalizeQueue(
      queue.queue_number
    );

  return counters.some(
    (counter) =>
      normalizeQueue(
        counter.queue_number
      ) === queueNumber &&
      Boolean(
        counter.called_at
      )
  );
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

  /* ==========================================================
     STATE
     ========================================================== */

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

  /* ==========================================================
     AUDIO
     ========================================================== */

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
  } = useAnnouncer();

  /* ==========================================================
     ANNOUNCED CALLS
     ========================================================== */

  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  /* ==========================================================
     REFRESH CONTROL
     ========================================================== */

  const refreshTimer =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const loadingRef =
    useRef(false);

  const clock =
    useClock();

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
          "[TV] tv_counter_status:",
          error
        );

        setErrorMessage(
          error.message
        );

        return [];
      }

      const result =
        (
          (data ?? []) as CounterStatusRow[]
        )
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
          "[TV] tv_agent_queue_list:",
          error
        );

        return [];
      }

      const result =
        (
          (data ?? []) as AgentQueueRow[]
        )
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

        for (
          const call of activeCalls
        ) {
          if (
            !call.queue_number ||
            !call.called_at
          ) {
            continue;
          }

          /*
           * Unique call.
           *
           * Cùng quầy + cùng called_at
           * chỉ phát 1 lần.
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

          const normalized =
            normalizeQueue(
              call.queue_number
            );

          /*
           * Tìm driver.
           */
          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) === normalized
            );

          /*
           * Chưa có driver.
           *
           * KHÔNG mark.
           *
           * Refresh sau sẽ thử lại.
           */
          if (
            !driver?.driver_name?.trim()
          ) {
            console.warn(
              "[TV] Driver not found:",
              call.queue_number
            );

            continue;
          }

          /*
           * Đủ dữ liệu mới mark.
           */
          announcedCalls.current.add(
            callKey
          );

          console.log(
            "[TV] NEW CALL",
            {
              queueNumber:
                call.queue_number,
              driverName:
                driver.driver_name,
              counter:
                call.counter_code,
              calledAt:
                call.called_at,
            }
          );

          /*
           * Đẩy vào audio queue.
           */
          enqueueAudio(
            call.queue_number,
            driver.driver_name.trim(),
            call.counter_code
          );
        }

        /*
         * Không để Set phình vô hạn.
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
      /*
       * Không chạy song song.
       */
      if (
        loadingRef.current
      ) {
        return;
      }

      loadingRef.current =
        true;

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
          "[TV] refresh failed:",
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
     DEBOUNCED REFRESH
     ========================================================== */

  const scheduleRefresh =
    useCallback(() => {
      if (
        refreshTimer.current
      ) {
        clearTimeout(
          refreshTimer.current
        );
      }

      refreshTimer.current =
        setTimeout(() => {
          void refresh();
        }, 100);
    }, [refresh]);

  /* ==========================================================
     REALTIME
     ========================================================== */

  useEffect(() => {
    if (!branchCode) {
      return;
    }

    /*
     * Initial load.
     */
    void refresh();

    /*
     * Realtime channel.
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
            table:
              "queue_tickets",
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
            table:
              "service_cases",
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
        .subscribe(
          (status) => {
            console.log(
              "[TV REALTIME STATUS]",
              status
            );
          }
        );

    /*
     * Watchdog.
     *
     * Realtime là chính.
     * 5 giây chỉ để recover
     * nếu realtime bị miss.
     */
    const watchdog =
      window.setInterval(() => {
        void refresh();
      }, 5000);

    return () => {
      if (
        refreshTimer.current
      ) {
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

  for (
    const queue of agentQueue
  ) {
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
      (q) => !q.agent_id
    );

  /* ==========================================================
     TOTAL WAITING
     ========================================================== */

  const totalWaiting =
    agentQueue.filter(
      (q) =>
        !isCalledQueue(
          q,
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
          className="w-full bg-warn px-4 py-2 text-center font-body font-semibold text-white hover:bg-warn/90"
          style={{
            fontSize: "1vw",
          }}
        >
          🔊 Bấm vào đây 1 lần để bật âm thanh
          thông báo cho màn hình này
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
              minHeight:
                "20vw",
              fontSize:
                "1.2vw",
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
                      (q) =>
                        normalizeQueue(
                          q.queue_number
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
                            lineHeight:
                              1.1,
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
                              (q) => (
                                <div
                                  key={
                                    q.ticket_code
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
                                      q.queue_number
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
                                      q.driver_name
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
                    (q) => (
                      <div
                        key={
                          q.ticket_code
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
                            q.queue_number
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
                            q.driver_name
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
