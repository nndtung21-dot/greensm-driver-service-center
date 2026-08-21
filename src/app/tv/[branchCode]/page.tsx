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
   AUDIO
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

function stripLeadingZeros(value: string) {
  const stripped = value.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : "0";
}

function buildAnnouncementClips(
  queueNumber: string,
  counterCode: string
): string[] {
  const clips: string[] = ["intro"];

  for (const ch of queueNumber.toUpperCase()) {
    if (DIGIT_CLIP[ch]) {
      clips.push(DIGIT_CLIP[ch]);
    }
  }

  clips.push("den_quay_so");

  const counterDigits = stripLeadingZeros(counterCode);

  for (const ch of counterDigits) {
    if (DIGIT_CLIP[ch]) {
      clips.push(DIGIT_CLIP[ch]);
    }
  }

  return clips;
}

function counterNumberToWords(counterCode: string): string {
  const stripped = counterCode.replace(/^0+/, "");
  const n = parseInt(stripped || "0", 10);

  if (
    !isNaN(n) &&
    n >= 0 &&
    n < SMALL_NUMBER_WORDS.length
  ) {
    return SMALL_NUMBER_WORDS[n];
  }

  return [...counterCode]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
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

/* ============================================================
   ANNOUNCER
   ============================================================ */

function useAnnouncer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const queueRef =
    useRef<Array<() => Promise<void>>>([]);

  const playingRef = useRef(false);

  const [unlocked, setUnlocked] = useState(false);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();

      audio.preload = "auto";
      audio.volume = 1;
      audio.setAttribute("playsinline", "");

      audioRef.current = audio;
    }

    return audioRef.current;
  }, []);

  /* ==========================================================
     UNLOCK
     ========================================================== */

  const unlock = useCallback(async () => {
    try {
      const audio = getAudio();

      audio.pause();
      audio.currentTime = 0;
      audio.src = `${CLIP_BASE}intro.mp3`;
      audio.volume = 1;

      await audio.play();

      audio.pause();
      audio.currentTime = 0;

      setUnlocked(true);

      console.log("TV audio unlocked");
    } catch (error) {
      console.error(
        "Không unlock được audio:",
        error
      );

      try {
        if (
          typeof window !== "undefined" &&
          "speechSynthesis" in window
        ) {
          const utterance =
            new SpeechSynthesisUtterance(" ");

          utterance.volume = 0;

          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(
            utterance
          );

          setUnlocked(true);
        }
      } catch (fallbackError) {
        console.error(
          "Speech unlock failed:",
          fallbackError
        );
      }
    }
  }, [getAudio]);

  /* ==========================================================
     PLAY ONE LOCAL CLIP
     ========================================================== */

  const playLocalClip = useCallback(
    async (
      audio: HTMLAudioElement,
      clipName: string
    ) => {
      await new Promise<void>(
        (resolve, reject) => {
          let finished = false;

          const cleanup = () => {
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
                `Không phát được ${clipName}.mp3`
              )
            );
          };

          audio.pause();
          audio.currentTime = 0;
          audio.src = `${CLIP_BASE}${clipName}.mp3`;

          audio.onended = done;
          audio.onerror = fail;

          void audio.play().catch(fail);
        }
      );
    },
    []
  );

  /* ==========================================================
     PLAY LOCAL ANNOUNCEMENT
     ========================================================== */

  const playLocalClips = useCallback(
    async (clipNames: string[]) => {
      const audio = getAudio();

      for (const clipName of clipNames) {
        await playLocalClip(
          audio,
          clipName
        );
      }
    },
    [getAudio, playLocalClip]
  );

  /* ==========================================================
     REMOTE TTS
     ========================================================== */

  const playRemote = useCallback(
    async (url: string) => {
      const audio = getAudio();

      await new Promise<void>(
        (resolve, reject) => {
          let finished = false;

          const cleanup = () => {
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
                "Không phát được TTS"
              )
            );
          };

          audio.pause();
          audio.currentTime = 0;
          audio.src = url;

          audio.onended = done;
          audio.onerror = fail;

          void audio.play().catch(fail);
        }
      );
    },
    [getAudio]
  );

  /* ==========================================================
     SPEECH FALLBACK
     ========================================================== */

  const playSpeech = useCallback(
    async (text: string) => {
      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      ) {
        throw new Error(
          "Browser không hỗ trợ speech synthesis"
        );
      }

      await new Promise<void>(
        (resolve, reject) => {
          window.speechSynthesis.cancel();

          const utterance =
            new SpeechSynthesisUtterance(text);

          utterance.lang = "vi-VN";
          utterance.rate = 0.9;
          utterance.pitch = 1;
          utterance.volume = 1;

          utterance.onend = () => {
            resolve();
          };

          utterance.onerror = () => {
            reject(
              new Error(
                "speechSynthesis failed"
              )
            );
          };

          window.speechSynthesis.speak(
            utterance
          );
        }
      );
    },
    []
  );

  /* ==========================================================
     PROCESS QUEUE
     ========================================================== */

  const processQueue = useCallback(async () => {
    if (playingRef.current) {
      return;
    }

    if (!unlocked) {
      return;
    }

    playingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const job =
          queueRef.current.shift();

        if (!job) {
          continue;
        }

        try {
          await job();
        } catch (error) {
          console.error(
            "TV announcement failed:",
            error
          );
        }

        await new Promise<void>(
          (resolve) =>
            setTimeout(resolve, 250)
        );
      }
    } finally {
      playingRef.current = false;
    }
  }, [unlocked]);

  useEffect(() => {
    if (unlocked) {
      void processQueue();
    }
  }, [unlocked, processQueue]);

  /* ==========================================================
     ENQUEUE
     ========================================================== */

  const enqueue = useCallback(
    (
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

      const localClips =
        buildAnnouncementClips(
          queueNumber,
          counterCode
        );

      queueRef.current.push(
        async () => {
          let played = false;

          /*
           * ==================================================
           * ƯU TIÊN LOCAL MP3
           *
           * Không chờ API TTS.
           * Đây là điểm quan trọng để gọi số gần như ngay.
           * ==================================================
           */

          try {
            await playLocalClips(
              localClips
            );

            played = true;
          } catch (error) {
            console.warn(
              "Local audio failed:",
              error
            );
          }

          /*
           * ==================================================
           * FALLBACK TTS
           * ==================================================
           */

          if (!played) {
            try {
              const response =
                await fetch(
                  `/api/tts?text=${encodeURIComponent(
                    text
                  )}`,
                  {
                    cache: "no-store",
                  }
                );

              if (!response.ok) {
                throw new Error(
                  `TTS HTTP ${response.status}`
                );
              }

              const blob =
                await response.blob();

              if (!blob || blob.size === 0) {
                throw new Error(
                  "TTS trả về audio rỗng"
                );
              }

              const url =
                URL.createObjectURL(blob);

              try {
                await playRemote(url);
                played = true;
              } finally {
                URL.revokeObjectURL(url);
              }
            } catch (error) {
              console.warn(
                "Remote TTS failed:",
                error
              );
            }
          }

          /*
           * ==================================================
           * FINAL FALLBACK
           * ==================================================
           */

          if (!played) {
            try {
              await playSpeech(text);
            } catch (error) {
              console.error(
                "Speech fallback failed:",
                error
              );
            }
          }
        }
      );

      if (unlocked) {
        void processQueue();
      }
    },
    [
      unlocked,
      processQueue,
      playLocalClips,
      playRemote,
      playSpeech,
    ]
  );

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

    const id = setInterval(
      () => setNow(new Date()),
      1000
    );

    return () => clearInterval(id);
  }, []);

  return now;
}

/* ============================================================
   HELPER
   ============================================================ */

function normalizeQueueNumber(
  value: string | null | undefined
) {
  return (
    value
      ?.trim()
      .toUpperCase() ?? ""
  );
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
) {
  const queueNumber =
    normalizeQueueNumber(
      queue.queue_number
    );

  return counters.some(
    (counter) =>
      normalizeQueueNumber(
        counter.queue_number
      ) === queueNumber &&
      Boolean(counter.called_at)
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

  const [
    counters,
    setCounters,
  ] = useState<CounterStatusRow[]>([]);

  const [
    agentQueue,
    setAgentQueue,
  ] = useState<AgentQueueRow[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(null);

  /* ==========================================================
     AUDIO
     ========================================================== */

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
  } = useAnnouncer();

  /* ==========================================================
     CLOCK
     ========================================================== */

  const clock = useClock();

  /* ==========================================================
     LOAD CONTROL
     ========================================================== */

  const loadingRef =
    useRef(false);

  const refreshPendingRef =
    useRef(false);

  const refreshTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const initialLoadedRef =
    useRef(false);

  /*
   * counter_code -> called_at
   */
  const lastAnnouncedAt =
    useRef<Map<string, string>>(
      new Map()
    );

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
          "tv_counter_status error:",
          error
        );

        throw error;
      }

      const result =
        ((data as CounterStatusRow[]) ??
          []).sort(
          (a, b) =>
            a.display_order -
            b.display_order
        );

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
          "tv_agent_queue_list error:",
          error
        );

        throw error;
      }

      const result =
        ((data as AgentQueueRow[]) ??
          []).sort(
          (a, b) =>
            new Date(
              a.created_at
            ).getTime() -
            new Date(
              b.created_at
            ).getTime()
        );

      return result;
    }, [branchCode]);

  /* ==========================================================
     ANNOUNCE NEW CALLS
     ========================================================== */

  const announceCalls =
    useCallback(
      (
        counterList: CounterStatusRow[],
        queueList: AgentQueueRow[]
      ) => {
        const activeCalls =
          counterList
            .filter(
              (counter) =>
                counter.queue_number &&
                counter.called_at
            )
            .sort(
              (a, b) =>
                new Date(
                  a.called_at!
                ).getTime() -
                new Date(
                  b.called_at!
                ).getTime()
            );

        for (const call of activeCalls) {
          const previous =
            lastAnnouncedAt.current.get(
              call.counter_code
            );

          /*
           * Đã phát rồi.
           */
          if (
            previous === call.called_at
          ) {
            continue;
          }

          const targetQueue =
            normalizeQueueNumber(
              call.queue_number
            );

          const driver =
            queueList.find(
              (q) =>
                normalizeQueueNumber(
                  q.queue_number
                ) === targetQueue
            );

          /*
           * Chưa lấy được driver name.
           *
           * Không đánh dấu.
           * Refresh sau sẽ thử lại.
           */
          if (
            !driver?.driver_name?.trim()
          ) {
            continue;
          }

          enqueueAudio(
            call.queue_number!,
            driver.driver_name.trim(),
            call.counter_code
          );

          /*
           * Đánh dấu ngay.
           */
          lastAnnouncedAt.current.set(
            call.counter_code,
            call.called_at!
          );
        }
      },
      [enqueueAudio]
    );

  /* ==========================================================
     CORE LOAD
     ========================================================== */

  const load =
    useCallback(async () => {
      /*
       * Nếu đang load thì không tạo thêm
       * request song song.
       */
      if (loadingRef.current) {
        refreshPendingRef.current =
          true;

        return;
      }

      loadingRef.current = true;

      try {
        /*
         * Hai RPC chạy song song.
         */
        const [
          counterResult,
          queueResult,
        ] = await Promise.allSettled([
          loadCounters(),
          loadAgentQueue(),
        ]);

        let counterList =
          counters;

        let queueList =
          agentQueue;

        /*
         * COUNTERS
         */
        if (
          counterResult.status ===
          "fulfilled"
        ) {
          counterList =
            counterResult.value;

          setCounters(
            counterResult.value
          );
        } else {
          console.error(
            "Load counters failed:",
            counterResult.reason
          );
        }

        /*
         * QUEUE
         */
        if (
          queueResult.status ===
          "fulfilled"
        ) {
          queueList =
            queueResult.value;

          setAgentQueue(
            queueResult.value
          );
        } else {
          console.error(
            "Load queue failed:",
            queueResult.reason
          );
        }

        /*
         * Nếu cả 2 đều fail.
         */
        if (
          counterResult.status ===
            "rejected" &&
          queueResult.status ===
            "rejected"
        ) {
          setErrorMessage(
            "Không tải được dữ liệu TV."
          );
        } else {
          setErrorMessage(null);
        }

        /*
         * Initial loading chỉ chạy lần đầu.
         *
         * Những lần realtime refresh:
         * KHÔNG hiện màn loading.
         */
        if (!initialLoadedRef.current) {
          initialLoadedRef.current =
            true;

          setLoading(false);
        }

        /*
         * Announcement.
         */
        if (
          counterResult.status ===
            "fulfilled" &&
          queueResult.status ===
            "fulfilled"
        ) {
          announceCalls(
            counterList,
            queueList
          );
        }
      } finally {
        loadingRef.current = false;

        /*
         * Nếu trong lúc load lại có event mới,
         * chạy thêm 1 lần nữa.
         */
        if (
          refreshPendingRef.current
        ) {
          refreshPendingRef.current =
            false;

          setTimeout(() => {
            void load();
          }, 50);
        }
      }
    }, [
      loadCounters,
      loadAgentQueue,
      announceCalls,
      counters,
      agentQueue,
    ]);

  /* ==========================================================
     SMART REFRESH
     ========================================================== */

  const scheduleRefresh =
    useCallback(() => {
      /*
       * Gom nhiều realtime event thành 1 request.
       *
       * Ví dụ check-in tạo:
       * queue_tickets
       * service_cases
       *
       * thay vì load 2 lần,
       * chỉ load 1 lần.
       */
      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current
        );
      }

      refreshTimerRef.current =
        setTimeout(() => {
          refreshTimerRef.current =
            null;

          void load();
        }, 100);
    }, [load]);

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
    void load();

    const channel =
      supabase
        .channel(
          `tv-${branchCode}`
        )

        /*
         * QUEUE
         */
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "queue_tickets",
          },
          () => {
            scheduleRefresh();
          }
        )

        /*
         * SERVICE CASE
         */
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "service_cases",
          },
          () => {
            scheduleRefresh();
          }
        )

        /*
         * COUNTERS
         */
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

        .subscribe((status) => {
          console.log(
            `TV realtime: ${status}`
          );
        });

    /*
     * Polling dự phòng.
     *
     * 30s thay vì 15s.
     *
     * Realtime vẫn là kênh chính.
     */
    const interval =
      setInterval(() => {
        void load();
      }, 30000);

    return () => {
      supabase.removeChannel(
        channel
      );

      clearInterval(interval);

      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current
        );
      }
    };
  }, [
    branchCode,
    load,
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
          🔊 Bấm vào đây 1 lần để bật
          âm thanh thông báo cho màn hình
          này (chỉ cần làm 1 lần mỗi khi
          mở trang)
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
                    normalizeQueueNumber(
                      counter.queue_number
                    );

                  const waitingForCounter =
                    myAgentQueue.filter(
                      (q) =>
                        normalizeQueueNumber(
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
                    {unassigned.length}
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
