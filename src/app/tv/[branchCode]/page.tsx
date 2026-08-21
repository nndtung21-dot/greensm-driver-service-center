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

/* ============================================================
   AUDIO CONFIG
   ============================================================ */

const AUDIO_BASE = "/audio/tv/";

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

/* ============================================================
   AUDIO HELPERS
   ============================================================ */

function normalizeQueue(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function stripLeadingZeros(value: string) {
  const stripped = value.replace(/^0+/, "");
  return stripped || "0";
}

function buildAnnouncementClips(
  queueNumber: string,
  counterCode: string
): string[] {
  const clips: string[] = ["intro"];

  for (const ch of queueNumber.toUpperCase()) {
    const clip = DIGIT_CLIP[ch];

    if (clip) {
      clips.push(clip);
    }
  }

  clips.push("den_quay_so");

  const counter = stripLeadingZeros(counterCode);

  for (const ch of counter) {
    const clip = DIGIT_CLIP[ch];

    if (clip) {
      clips.push(clip);
    }
  }

  return clips;
}

function counterNumberToWords(counterCode: string) {
  const stripped = counterCode.replace(/^0+/, "") || "0";
  const n = Number(stripped);

  if (
    Number.isFinite(n) &&
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
) {
  const queueWords = [...queueNumber.toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");

  const counterWords =
    counterNumberToWords(counterCode);

  return `Kính mời tài xế có số ${queueWords}, ${driverName}, đến quầy số ${counterWords}`;
}

/* ============================================================
   ANNOUNCER
   ============================================================ */

function useAnnouncer() {
  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const unlockedRef =
    useRef(false);

  const playingRef =
    useRef(false);

  const queueRef =
    useRef<
      Array<{
        queueNumber: string;
        driverName: string;
        counterCode: string;
      }>
    >([]);

  const [unlocked, setUnlocked] =
    useState(false);

  const [audioError, setAudioError] =
    useState<string | null>(null);

  /* ==========================================================
     CREATE AUDIO
     ========================================================== */

  const getAudio = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }

    if (!audioRef.current) {
      const audio = document.createElement("audio");

      audio.preload = "auto";
      audio.volume = 1;
      audio.muted = false;

      audio.setAttribute(
        "playsinline",
        "true"
      );

      audioRef.current = audio;

      /*
       * Add vào DOM giúp một số TV/browser
       * xử lý audio ổn định hơn.
       */
      audio.style.display = "none";

      document.body.appendChild(audio);
    }

    return audioRef.current;
  }, []);

  /* ==========================================================
     UNLOCK
     ========================================================== */

  const unlock = useCallback(async () => {
    const audio = getAudio();

    if (!audio) {
      return false;
    }

    try {
      setAudioError(null);

      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.volume = 1;

      /*
       * Quan trọng:
       * play một file LOCAL ngay trong click gesture.
       */
      audio.src =
        `${AUDIO_BASE}intro.mp3`;

      audio.load();

      await audio.play();

      /*
       * Browser đã cấp quyền audio.
       */
      unlockedRef.current = true;
      setUnlocked(true);

      /*
       * Không pause quá sớm.
       * Đợi audio bắt đầu chạy rồi pause.
       */
      window.setTimeout(() => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {}
      }, 250);

      console.log(
        "[TV AUDIO] unlocked"
      );

      /*
       * Có queue đang chờ thì xử lý ngay.
       */
      void processQueue();

      return true;
    } catch (error) {
      console.error(
        "[TV AUDIO] unlock failed",
        error
      );

      unlockedRef.current = false;
      setUnlocked(false);

      setAudioError(
        "Không bật được âm thanh. Hãy bấm nút 🔊 lại trên TV."
      );

      return false;
    }
  }, [getAudio]);

  /* ==========================================================
     PLAY ONE LOCAL CLIP
     ========================================================== */

  const playClip = useCallback(
    async (
      audio: HTMLAudioElement,
      clipName: string
    ) => {
      const src =
        `${AUDIO_BASE}${clipName}.mp3`;

      return new Promise<void>(
        (resolve, reject) => {
          let finished = false;

          const cleanup = () => {
            audio.onended = null;
            audio.onerror = null;
          };

          const success = () => {
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
                `Audio failed: ${src}`
              )
            );
          };

          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          audio.volume = 1;

          audio.onended = success;
          audio.onerror = fail;

          audio.src = src;
          audio.load();

          const promise =
            audio.play();

          promise.catch(fail);
        }
      );
    },
    []
  );

  /* ==========================================================
     PLAY LOCAL ANNOUNCEMENT
     ========================================================== */

  const playLocalAnnouncement =
    useCallback(
      async (
        queueNumber: string,
        counterCode: string
      ) => {
        const audio = getAudio();

        if (!audio) {
          throw new Error(
            "Audio element unavailable"
          );
        }

        const clips =
          buildAnnouncementClips(
            queueNumber,
            counterCode
          );

        console.log(
          "[TV AUDIO] local clips:",
          clips
        );

        for (const clip of clips) {
          await playClip(
            audio,
            clip
          );
        }
      },
      [getAudio, playClip]
    );

  /* ==========================================================
     PLAY TTS FALLBACK
     ========================================================== */

  const playTTS = useCallback(
    async (text: string) => {
      const audio = getAudio();

      if (!audio) {
        throw new Error(
          "Audio element unavailable"
        );
      }

      console.log(
        "[TV AUDIO] TTS fallback"
      );

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

      if (!blob.size) {
        throw new Error(
          "TTS returned empty audio"
        );
      }

      const url =
        URL.createObjectURL(blob);

      try {
        await new Promise<void>(
          (resolve, reject) => {
            let finished = false;

            const cleanup = () => {
              audio.onended = null;
              audio.onerror = null;
            };

            const success = () => {
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
                  "TTS audio play failed"
                )
              );
            };

            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            audio.volume = 1;

            audio.onended = success;
            audio.onerror = fail;

            audio.src = url;
            audio.load();

            audio.play().catch(fail);
          }
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [getAudio]
  );

  /* ==========================================================
     SPEECH FALLBACK
     ========================================================== */

  const playSpeech =
    useCallback(
      async (text: string) => {
        if (
          typeof window === "undefined" ||
          !window.speechSynthesis
        ) {
          throw new Error(
            "Speech synthesis unavailable"
          );
        }

        await new Promise<void>(
          (resolve, reject) => {
            window.speechSynthesis.cancel();

            const utterance =
              new SpeechSynthesisUtterance(
                text
              );

            utterance.lang = "vi-VN";
            utterance.rate = 0.9;
            utterance.pitch = 1;
            utterance.volume = 1;

            utterance.onend =
              () => resolve();

            utterance.onerror =
              () =>
                reject(
                  new Error(
                    "Speech synthesis failed"
                  )
                );

            window.speechSynthesis.speak(
              utterance
            );
          }
        );
      },
      []
    );

  /* ==========================================================
     PROCESS ONE JOB
     ========================================================== */

  const processJob =
    useCallback(
      async (job: {
        queueNumber: string;
        driverName: string;
        counterCode: string;
      }) => {
        const text =
          buildAnnouncementText(
            job.queueNumber,
            job.driverName,
            job.counterCode
          );

        /*
         * =====================================================
         * 1. LOCAL MP3 — ƯU TIÊN TUYỆT ĐỐI
         * =====================================================
         *
         * Không gọi API TTS trước.
         *
         * Nếu file tồn tại:
         *
         *     gần như phát ngay.
         *
         */

        try {
          await playLocalAnnouncement(
            job.queueNumber,
            job.counterCode
          );

          console.log(
            "[TV AUDIO] local success:",
            job.queueNumber,
            job.counterCode
          );

          return;
        } catch (error) {
          console.warn(
            "[TV AUDIO] local failed:",
            error
          );
        }

        /*
         * =====================================================
         * 2. TTS API FALLBACK
         * =====================================================
         */

        try {
          await playTTS(text);

          console.log(
            "[TV AUDIO] TTS success:",
            job.queueNumber
          );

          return;
        } catch (error) {
          console.warn(
            "[TV AUDIO] TTS failed:",
            error
          );
        }

        /*
         * =====================================================
         * 3. BROWSER SPEECH FALLBACK
         * =====================================================
         */

        try {
          await playSpeech(text);

          console.log(
            "[TV AUDIO] speech success:",
            job.queueNumber
          );

          return;
        } catch (error) {
          console.error(
            "[TV AUDIO] ALL AUDIO FAILED:",
            error
          );

          setAudioError(
            `Không phát được âm thanh cho ${job.queueNumber}`
          );
        }
      },
      [
        playLocalAnnouncement,
        playTTS,
        playSpeech,
      ]
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
        return;
      }

      playingRef.current = true;

      try {
        while (
          queueRef.current.length > 0
        ) {
          const job =
            queueRef.current.shift();

          if (!job) {
            continue;
          }

          await processJob(job);

          /*
           * Nghỉ rất ngắn giữa 2 lượt.
           */
          await new Promise<void>(
            (resolve) =>
              window.setTimeout(
                resolve,
                200
              )
          );
        }
      } finally {
        playingRef.current = false;
      }
    }, [processJob]);

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
          return;
        }

        /*
         * Chống duplicate trong audio queue.
         */
        const exists =
          queueRef.current.some(
            (job) =>
              normalizeQueue(
                job.queueNumber
              ) ===
                normalizeQueue(
                  queueNumber
                ) &&
              job.counterCode ===
                counterCode
          );

        if (exists) {
          return;
        }

        queueRef.current.push({
          queueNumber,
          driverName,
          counterCode,
        });

        console.log(
          "[TV AUDIO] enqueue:",
          queueNumber,
          driverName,
          counterCode
        );

        void processQueue();
      },
      [processQueue]
    );

  /* ==========================================================
     CLEANUP
     ========================================================== */

  useEffect(() => {
    return () => {
      const audio =
        audioRef.current;

      if (audio) {
        try {
          audio.pause();
          audio.src = "";
          audio.remove();
        } catch {}
      }

      queueRef.current = [];
    };
  }, []);

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
  const [now, setNow] =
    useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    const id =
      window.setInterval(
        () => setNow(new Date()),
        1000
      );

    return () =>
      window.clearInterval(id);
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

  const [
    lastRefresh,
    setLastRefresh,
  ] = useState<Date | null>(
    null
  );

  /*
   * counter_code -> called_at
   *
   * Dùng để đảm bảo cùng 1 lần gọi
   * chỉ phát đúng 1 lần.
   */
  const lastAnnouncedAt =
    useRef<
      Map<string, string>
    >(new Map());

  /*
   * Chống nhiều realtime event
   * chạy load cùng lúc.
   */
  const loadingRef =
    useRef(false);

  const reloadTimer =
    useRef<number | null>(null);

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
    audioError,
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
          "[TV] counter RPC error:",
          error
        );

        setErrorMessage(
          error.message
        );

        return [];
      }

      const result =
        ((data ??
          []) as CounterStatusRow[]);

      result.sort(
        (a, b) =>
          a.display_order -
          b.display_order
      );

      return result;
    }, [branchCode]);

  /* ==========================================================
     LOAD QUEUE
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
          "[TV] queue RPC error:",
          error
        );

        return [];
      }

      const result =
        ((data ??
          []) as AgentQueueRow[]);

      result.sort(
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
     PROCESS NEW CALLS
     ========================================================== */

  const detectNewCalls =
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
           * Cùng called_at => không phát lại.
           */
          if (
            previous ===
            call.called_at
          ) {
            continue;
          }

          const targetQueue =
            normalizeQueue(
              call.queue_number
            );

          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) === targetQueue
            );

          /*
           * Chưa có driver.
           *
           * Không đánh dấu.
           * Load sau sẽ tìm lại.
           */
          if (
            !driver?.driver_name?.trim()
          ) {
            console.warn(
              "[TV] Driver chưa tìm thấy:",
              call.queue_number
            );

            continue;
          }

          /*
           * Đánh dấu TRƯỚC enqueue
           * để tránh realtime event duplicate.
           */
          lastAnnouncedAt.current.set(
            call.counter_code,
            call.called_at!
          );

          enqueueAudio(
            call.queue_number!,
            driver.driver_name.trim(),
            call.counter_code
          );
        }
      },
      [enqueueAudio]
    );

  /* ==========================================================
     LOAD ALL
     ========================================================== */

  const load =
    useCallback(async () => {
      /*
       * Không cho nhiều load chạy song song.
       */
      if (loadingRef.current) {
        return;
      }

      loadingRef.current = true;

      try {
        setErrorMessage(null);

        /*
         * Hai RPC chạy song song.
         */
        const [
          counterList,
          queueList,
        ] = await Promise.all([
          loadCounters(),
          loadAgentQueue(),
        ]);

        setCounters(
          counterList
        );

        setAgentQueue(
          queueList
        );

        detectNewCalls(
          counterList,
          queueList
        );

        setLoading(false);
        setLastRefresh(
          new Date()
        );
      } catch (error) {
        console.error(
          "[TV] load error:",
          error
        );

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu"
        );
      } finally {
        loadingRef.current = false;
      }
    }, [
      loadCounters,
      loadAgentQueue,
      detectNewCalls,
    ]);

  /* ==========================================================
     DEBOUNCED REALTIME RELOAD
     ========================================================== */

  const scheduleReload =
    useCallback(() => {
      if (
        reloadTimer.current !==
        null
      ) {
        window.clearTimeout(
          reloadTimer.current
        );
      }

      reloadTimer.current =
        window.setTimeout(
          () => {
            reloadTimer.current =
              null;

            void load();
          },
          100
        );
    }, [load]);

  /* ==========================================================
     REALTIME
     ========================================================== */

  useEffect(() => {
    /*
     * Initial load.
     */
    void load();

    const channel =
      supabase
        .channel(
          `tv-${branchCode}-${Date.now()}`
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
              "[TV] queue_tickets changed"
            );

            scheduleReload();
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
              "[TV] service_cases changed"
            );

            scheduleReload();
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
              "[TV] counters changed"
            );

            scheduleReload();
          }
        )
        .subscribe(
          (status) => {
            console.log(
              "[TV] realtime:",
              status
            );

            if (
              status ===
                "SUBSCRIBED"
            ) {
              void load();
            }

            if (
              status ===
              "CHANNEL_ERROR"
            ) {
              scheduleReload();
            }

            if (
              status ===
              "TIMED_OUT"
            ) {
              scheduleReload();
            }
          }
        );

    /*
     * Fallback.
     *
     * Không cần 15s nữa.
     * 5s chỉ là safety net nếu realtime mất.
     */
    const interval =
      window.setInterval(
        () => {
          void load();
        },
        5000
      );

    return () => {
      supabase.removeChannel(
        channel
      );

      window.clearInterval(
        interval
      );

      if (
        reloadTimer.current !==
        null
      ) {
        window.clearTimeout(
          reloadTimer.current
        );

        reloadTimer.current =
          null;
      }
    };
  }, [
    branchCode,
    load,
    scheduleReload,
  ]);

  /* ==========================================================
     WAITING BY AGENT
     ========================================================== */

  const waitingByAgent =
    useMemo(() => {
      const map =
        new Map<
          string,
          AgentQueueRow[]
        >();

      for (const queue of agentQueue) {
        if (!queue.agent_id) {
          continue;
        }

        const list =
          map.get(
            queue.agent_id
          ) ?? [];

        list.push(queue);

        map.set(
          queue.agent_id,
          list
        );
      }

      return map;
    }, [agentQueue]);

  /* ==========================================================
     UNASSIGNED
     ========================================================== */

  const unassigned =
    useMemo(
      () =>
        agentQueue.filter(
          (q) => !q.agent_id
        ),
      [agentQueue]
    );

  /* ==========================================================
     TOTAL WAITING
     ========================================================== */

  const totalWaiting =
    useMemo(
      () =>
        agentQueue.filter(
          (q) =>
            !isCalledQueue(
              q,
              counters
            )
        ).length,
      [agentQueue, counters]
    );

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
          className="w-full bg-warn px-4 py-3 text-center font-body font-semibold text-white"
          style={{
            fontSize: "1vw",
          }}
        >
          🔊 BẤM VÀO ĐÂY 1 LẦN ĐỂ BẬT
          ÂM THANH
        </button>
      )}

      {/* ======================================================
          AUDIO ERROR
          ====================================================== */}

      {audioError && (
        <div
          className="bg-red-600 px-4 py-2 text-center font-body font-semibold text-white"
          style={{
            fontSize: "0.9vw",
          }}
        >
          🔇 {audioError}
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
          Không tải được dữ liệu:
          {" "}
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
                      {/* HEADER */}

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

                        <p
                          className={`mt-2 font-body font-semibold ${
                            busy
                              ? "text-brand-700"
                              : "text-ink/40"
                          }`}
                          style={{
                            fontSize:
                              "0.9vw",
                          }}
                        >
                          {busy
                            ? "ĐANG GỌI"
                            : counter.counter_status ===
                              "OFFLINE"
                            ? "OFFLINE"
                            : counter.counter_status ===
                              "CLOSED"
                            ? "ĐÃ ĐÓNG"
                            : "SẴN SÀNG"}
                        </p>
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

      {/* ======================================================
          DEBUG
          ====================================================== */}

      <div
        className="fixed bottom-1 right-2 opacity-30"
        style={{
          fontSize: "0.55vw",
        }}
      >
        TV {branchCode}
        {" · "}
        {lastRefresh
          ? lastRefresh.toLocaleTimeString(
              "vi-VN"
            )
          : "--:--:--"}
      </div>
    </div>
  );
}
