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
  return (
    value
      ?.trim()
      .toUpperCase() ?? ""
  );
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterCode: string
) {
  const queue =
    queueNumber
      .trim()
      .toUpperCase();

  const name =
    driverName
      .trim();

  const counter =
    counterCode
      .trim()
      .replace(/^0+/, "") || "0";

  /*
   * Đây là câu Google TTS sẽ đọc.
   *
   * Ví dụ:
   * Kính mời tài xế có số A123,
   * Nguyễn Văn Tùng,
   * đến quầy số 2
   */
  return (
    `Kính mời tài xế có số ${queue}, ` +
    `${name}, ` +
    `đến quầy số ${counter}`
  );
}

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
      Boolean(counter.called_at)
  );
}

/* ============================================================
   GOOGLE TTS ANNOUNCER
   ============================================================ */

function useAnnouncer() {
  const audioRef =
    useRef<HTMLAudioElement | null>(
      null
    );

  /*
   * Các announcement đang chờ phát.
   */
  const queueRef =
    useRef<
      Array<() => Promise<void>>
    >([]);

  /*
   * Đảm bảo chỉ có một audio đang phát.
   */
  const playingRef =
    useRef(false);

  /*
   * Dùng ref thay vì chỉ dùng state.
   *
   * Vì realtime callback có thể chạy
   * trước khi React render lại.
   */
  const unlockedRef =
    useRef(false);

  const [unlocked, setUnlocked] =
    useState(false);

  /* ==========================================================
     GET AUDIO ELEMENT
     ========================================================== */

  const getAudio = useCallback(() => {
    if (
      !audioRef.current
    ) {
      const audio =
        document.createElement(
          "audio"
        );

      audio.preload = "auto";
      audio.volume = 1;

      /*
       * Mobile / Android TV / Chrome.
       */
      audio.setAttribute(
        "playsinline",
        ""
      );

      audio.setAttribute(
        "webkit-playsinline",
        ""
      );

      audioRef.current =
        audio;
    }

    return audioRef.current;
  }, []);

  /* ==========================================================
     GOOGLE TTS URL
     ========================================================== */

  const buildTtsUrl =
    useCallback(
      (text: string) => {
        return (
          `/api/tts?text=${encodeURIComponent(
            text
          )}`
        );
      },
      []
    );

  /* ==========================================================
     UNLOCK AUDIO
     ========================================================== */

  const unlock = useCallback(
    async () => {
      const audio =
        getAudio();

      /*
       * QUAN TRỌNG:
       *
       * Không fetch() trước.
       *
       * Nếu:
       *
       * await fetch(...)
       * await blob()
       * audio.play()
       *
       * thì Chrome có thể coi play()
       * không còn nằm trong user gesture.
       *
       * Vì vậy set src trực tiếp rồi
       * gọi play() ngay.
       */

      const unlockText =
        "Xin chào";

      const url =
        buildTtsUrl(
          unlockText
        );

      try {
        console.log(
          "[TV AUDIO] Unlock start"
        );

        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        audio.src = url;
        audio.volume = 0.01;

        /*
         * play() được gọi trực tiếp
         * trong event click.
         */
        const playPromise =
          audio.play();

        await playPromise;

        console.log(
          "[TV AUDIO] Unlock playback started"
        );

        /*
         * Không cần chờ hết câu.
         *
         * Chỉ cần browser cho phép
         * element này phát audio.
         */
        setTimeout(() => {
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1;
          } catch {}
        }, 150);

        unlockedRef.current =
          true;

        setUnlocked(true);

        console.log(
          "[TV AUDIO] GOOGLE TTS UNLOCKED"
        );

        /*
         * Có announcement đang chờ
         * thì xử lý ngay.
         */
        setTimeout(() => {
          void processQueue();
        }, 0);

        return true;
      } catch (error) {
        console.error(
          "[TV AUDIO] Unlock failed:",
          error
        );

        unlockedRef.current =
          false;

        setUnlocked(false);

        return false;
      }
    },
    [
      getAudio,
      buildTtsUrl,
    ]
  );

  /* ==========================================================
     PLAY GOOGLE TTS
     ========================================================== */

  const playGoogleTTS =
    useCallback(
      async (
        text: string
      ) => {
        const audio =
          getAudio();

        const url =
          buildTtsUrl(text);

        console.log(
          "[TV AUDIO] PLAY GOOGLE TTS",
          {
            text,
            url,
          }
        );

        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let finished =
              false;

            const cleanup =
              () => {
                audio.onended =
                  null;

                audio.onerror =
                  null;

                audio.onabort =
                  null;

                audio.onstalled =
                  null;
              };

            const finish =
              () => {
                if (
                  finished
                ) {
                  return;
                }

                finished =
                  true;

                cleanup();

                console.log(
                  "[TV AUDIO] Playback ended"
                );

                resolve();
              };

            const fail =
              (
                error?: unknown
              ) => {
                if (
                  finished
                ) {
                  return;
                }

                finished =
                  true;

                cleanup();

                reject(
                  error ??
                    new Error(
                      "Google TTS playback failed"
                    )
                );
              };

            /*
             * Dừng audio cũ.
             */
            audio.pause();

            try {
              audio.currentTime =
                0;
            } catch {}

            /*
             * Load Google TTS.
             */
            audio.src = url;
            audio.volume = 1;

            /*
             * Event handlers.
             */
            audio.onended =
              finish;

            audio.onerror =
              () => {
                fail(
                  new Error(
                    "Google TTS audio error"
                  )
                );
              };

            audio.onabort =
              () => {
                fail(
                  new Error(
                    "Google TTS audio aborted"
                  )
                );
              };

            audio.onstalled =
              () => {
                console.warn(
                  "[TV AUDIO] Audio stalled"
                );
              };

            /*
             * Play.
             */
            void audio
              .play()
              .then(() => {
                console.log(
                  "[TV AUDIO] Playback started"
                );
              })
              .catch(
                (error) => {
                  console.error(
                    "[TV AUDIO] play() rejected:",
                    error
                  );

                  fail(error);
                }
              );
          }
        );
      },
      [
        getAudio,
        buildTtsUrl,
      ]
    );

  /* ==========================================================
     PROCESS AUDIO QUEUE
     ========================================================== */

  const processQueue =
    useCallback(
      async () => {
        /*
         * Đang có một process khác chạy.
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
            "[TV AUDIO] Waiting for unlock"
          );

          return;
        }

        /*
         * Không có job.
         */
        if (
          queueRef.current
            .length === 0
        ) {
          return;
        }

        playingRef.current =
          true;

        console.log(
          "[TV AUDIO] PROCESS START",
          queueRef.current.length
        );

        try {
          while (
            queueRef.current
              .length > 0
          ) {
            const job =
              queueRef.current.shift();

            if (!job) {
              continue;
            }

            try {
              await job();
            } catch (
              error
            ) {
              console.error(
                "[TV AUDIO] Announcement failed:",
                error
              );
            }

            /*
             * Khoảng nghỉ rất ngắn
             * giữa hai lần gọi.
             */
            await new Promise<void>(
              (resolve) =>
                setTimeout(
                  resolve,
                  150
                )
            );
          }
        } finally {
          playingRef.current =
            false;

          console.log(
            "[TV AUDIO] PROCESS END"
          );
        }
      },
      []
    );

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
        const cleanQueue =
          queueNumber
            .trim()
            .toUpperCase();

        const cleanName =
          driverName.trim();

        const cleanCounter =
          counterCode.trim();

        /*
         * Không có tên thì không đọc.
         */
        if (
          !cleanName
        ) {
          console.warn(
            "[TV AUDIO] Missing driver name",
            {
              queueNumber,
              counterCode,
            }
          );

          return;
        }

        const text =
          buildAnnouncementText(
            cleanQueue,
            cleanName,
            cleanCounter
          );

        console.log(
          "[TV AUDIO] ENQUEUE",
          {
            queueNumber:
              cleanQueue,
            driverName:
              cleanName,
            counterCode:
              cleanCounter,
            text,
          }
        );

        /*
         * Thêm vào queue.
         */
        queueRef.current.push(
          async () => {
            await playGoogleTTS(
              text
            );
          }
        );

        /*
         * Nếu đã unlock,
         * phát ngay.
         */
        if (
          unlockedRef.current
        ) {
          void processQueue();
        }
      },
      [
        playGoogleTTS,
        processQueue,
      ]
    );

  /* ==========================================================
     PROCESS AFTER UNLOCK
     ========================================================== */

  useEffect(() => {
    if (
      unlocked
    ) {
      void processQueue();
    }
  }, [
    unlocked,
    processQueue,
  ]);

  /* ==========================================================
     CLEANUP
     ========================================================== */

  useEffect(() => {
    return () => {
      const audio =
        audioRef.current;

      if (audio) {
        audio.pause();
        audio.src = "";
      }

      queueRef.current = [];

      playingRef.current =
        false;

      unlockedRef.current =
        false;
    };
  }, []);

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
    useState<Date | null>(
      null
    );

  useEffect(() => {
    setNow(new Date());

    const id =
      window.setInterval(
        () => {
          setNow(new Date());
        },
        1000
      );

    return () => {
      window.clearInterval(id);
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
    enqueue:
      enqueueAudio,

    unlock:
      unlockAudio,

    unlocked,
  } = useAnnouncer();

  /* ==========================================================
     CLOCK
     ========================================================== */

  const clock =
    useClock();

  /* ==========================================================
     ANNOUNCED CALLS
     ========================================================== */

  /*
   * Key:
   *
   * counter_code + called_at
   *
   * Ví dụ:
   *
   * C01:2026-08-20T10:20:30
   */
  const announcedCalls =
    useRef<
      Set<string>
    >(new Set());

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

  /* ==========================================================
     LOAD COUNTERS
     ========================================================== */

  const loadCounters =
    useCallback(
      async () => {
        const {
          data,
          error,
        } =
          await supabase.rpc(
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
            (data ??
              []) as CounterStatusRow[]
          )
            .slice()
            .sort(
              (a, b) =>
                a.display_order -
                b.display_order
            );

        setCounters(
          result
        );

        return result;
      },
      [branchCode]
    );

  /* ==========================================================
     LOAD AGENT QUEUE
     ========================================================== */

  const loadAgentQueue =
    useCallback(
      async () => {
        const {
          data,
          error,
        } =
          await supabase.rpc(
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
            (data ??
              []) as AgentQueueRow[]
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

        setAgentQueue(
          result
        );

        return result;
      },
      [branchCode]
    );

  /* ==========================================================
     HANDLE NEW CALLS
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
           * Một lần gọi = một key.
           */
          const callKey =
            `${call.counter_code}:${call.called_at}`;

          /*
           * Đã đọc rồi.
           */
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
           * Tìm driver.
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
           * Chưa có driver.
           *
           * Không mark.
           * Refresh sau sẽ thử lại.
           */
          if (
            !driver?.driver_name?.trim()
          ) {
            console.warn(
              "[TV] Driver not found:",
              {
                queueNumber:
                  call.queue_number,
                calledAt:
                  call.called_at,
              }
            );

            continue;
          }

          /*
           * Mark TRƯỚC khi enqueue.
           *
           * Tránh 2 realtime events
           * cùng enqueue một ticket.
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
           * Google TTS.
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
    useCallback(
      async () => {
        /*
         * Không cho nhiều refresh
         * chạy cùng lúc.
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
          ] =
            await Promise.all([
              loadCounters(),
              loadAgentQueue(),
            ]);

          setLoading(false);
          setErrorMessage(
            null
          );

          /*
           * Xử lý ticket vừa gọi.
           */
          handleCalls(
            counterList,
            queueList
          );
        } catch (
          error
        ) {
          console.error(
            "[TV] refresh failed:",
            error
          );
        } finally {
          loadingRef.current =
            false;
        }
      },
      [
        loadCounters,
        loadAgentQueue,
        handleCalls,
      ]
    );

  /* ==========================================================
     DEBOUNCED REFRESH
     ========================================================== */

  const scheduleRefresh =
    useCallback(
      () => {
        if (
          refreshTimer.current
        ) {
          clearTimeout(
            refreshTimer.current
          );
        }

        /*
         * Chỉ delay 50ms để gom
         * duplicate Postgres events.
         */
        refreshTimer.current =
          setTimeout(
            () => {
              void refresh();
            },
            50
          );
      },
      [refresh]
    );

  /* ==========================================================
     REALTIME
     ========================================================== */

  useEffect(() => {
    if (
      !branchCode
    ) {
      return;
    }

    /*
     * Initial load.
     */
    void refresh();

    /*
     * Supabase realtime.
     */
    const channel =
      supabase
        .channel(
          `tv-display-${branchCode}`
        )

        /* ----------------------------------------------------
           QUEUE TICKETS
           ---------------------------------------------------- */

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

        /* ----------------------------------------------------
           SERVICE CASES
           ---------------------------------------------------- */

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

        /* ----------------------------------------------------
           COUNTERS
           ---------------------------------------------------- */

        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "counters",
          },
          () => {
            console.log(
              "[TV REALTIME] counters"
            );

            scheduleRefresh();
          }
        )

        /* ----------------------------------------------------
           SUBSCRIBE
           ---------------------------------------------------- */

        .subscribe(
          (status) => {
            console.log(
              "[TV REALTIME]",
              status
            );
          }
        );

    /*
     * Watchdog 5s.
     *
     * Không phải đường chính.
     * Chỉ dùng nếu realtime miss.
     */
    const watchdog =
      window.setInterval(
        () => {
          void refresh();
        },
        5000
      );

    return () => {
      if (
        refreshTimer.current
      ) {
        clearTimeout(
          refreshTimer.current
        );

        refreshTimer.current =
          null;
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
    if (
      !queue.agent_id
    ) {
      continue;
    }

    const current =
      waitingByAgent.get(
        queue.agent_id
      ) ?? [];

    current.push(
      queue
    );

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
      (q) =>
        !q.agent_id
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

      {/* ====================================================
          AUDIO UNLOCK
          ==================================================== */}

      {!unlocked && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio();
          }}
          className="w-full bg-warn px-4 py-3 text-center font-body font-semibold text-white hover:bg-warn/90"
          style={{
            fontSize:
              "1vw",
          }}
        >
          🔊 Bấm vào đây 1 lần để
          bật âm thanh thông báo
          cho màn hình này
        </button>
      )}

      {/* ====================================================
          HEADER
          ==================================================== */}

      <div
        className="flex items-center justify-between border-b border-line bg-white shadow-sm"
        style={{
          padding:
            "1.4vw 2.2vw",
        }}
      >
        {/* BRAND */}

        <div>
          <p
            className="font-body font-semibold uppercase tracking-widest text-brand-500"
            style={{
              fontSize:
                "1vw",
            }}
          >
            Green SM
          </p>

          <p
            className="font-display font-bold text-brand-900"
            style={{
              fontSize:
                "2vw",
            }}
          >
            Driver Service Center
          </p>
        </div>

        {/* RIGHT */}

        <div
          className="flex items-center"
          style={{
            gap:
              "2.2vw",
          }}
        >
          {/* CLOCK */}

          {clock && (
            <div className="text-right">
              <p
                className="font-display font-bold tabular-nums text-brand-900"
                style={{
                  fontSize:
                    "2.2vw",
                }}
              >
                {clock.toLocaleTimeString(
                  "vi-VN",
                  {
                    hour:
                      "2-digit",
                    minute:
                      "2-digit",
                    second:
                      "2-digit",
                  }
                )}
              </p>

              <p
                className="font-body capitalize text-ink/50"
                style={{
                  fontSize:
                    "0.9vw",
                }}
              >
                {clock.toLocaleDateString(
                  "vi-VN",
                  {
                    weekday:
                      "long",
                    day:
                      "2-digit",
                    month:
                      "2-digit",
                    year:
                      "numeric",
                  }
                )}
              </p>
            </div>
          )}

          {/* WAITING */}

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
                fontSize:
                  "0.85vw",
              }}
            >
              Đang chờ
            </p>

            <p
              className="font-display font-bold text-brand-900"
              style={{
                fontSize:
                  "2.2vw",
              }}
            >
              {totalWaiting}
            </p>
          </div>
        </div>
      </div>

      {/* ====================================================
          ERROR
          ==================================================== */}

      {errorMessage && (
        <div className="mx-[2.2vw] mt-[1vw] rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          Không tải được dữ liệu:
          {" "}
          {errorMessage}
        </div>
      )}

      {/* ====================================================
          CONTENT
          ==================================================== */}

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
                gap:
                  "1.2vw",
              }}
            >
              {counters.map(
                (
                  counter
                ) => {
                  /*
                   * Ticket đang gọi.
                   */
                  const busy =
                    Boolean(
                      counter.queue_number &&
                        counter.called_at
                    );

                  /*
                   * Queue của Agent
                   * đang đứng tại quầy.
                   */
                  const myAgentQueue =
                    counter.agent_id
                      ? (
                          waitingByAgent.get(
                            counter.agent_id
                          ) ??
                          []
                        )
                      : [];

                  /*
                   * Ticket hiện tại.
                   */
                  const currentQueue =
                    normalizeQueue(
                      counter.queue_number
                    );

                  /*
                   * Các ticket đang chờ.
                   */
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
                              (
                                q
                              ) => (
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
                            Không có ai
                            chờ.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }
              )}

              {/* NO COUNTER */}

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
                      Branch:
                      {" "}
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
                    padding:
                      "1vw",
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
