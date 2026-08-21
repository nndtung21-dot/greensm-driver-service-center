
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
   HELPERS
============================================================ */

function normalizeQueue(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

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

function queueNumberToWords(value: string) {
  return [...value.toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

function counterNumberToWords(value: string) {
  const normalized = value.replace(/^0+/, "") || "0";

  const smallNumbers: Record<string, string> = {
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

  if (smallNumbers[normalized]) {
    return smallNumbers[normalized];
  }

  return [...normalized]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterCode: string
) {
  /*
   * Ví dụ:
   * A0123
   * Nguyễn Văn Tùng
   * 03
   *
   * => Kính mời tài xế có số a không một hai ba,
   *    Nguyễn Văn Tùng, đến quầy số ba
   */

  const queueText =
    queueNumberToWords(queueNumber);

  const counterText =
    counterNumberToWords(counterCode);

  const cleanDriverName =
    driverName
      .replace(/\s+/g, " ")
      .trim();

  return `Kính mời tài xế có số ${queueText}, ${cleanDriverName}, đến quầy số ${counterText}`;
}

/* ============================================================
   GOOGLE TTS AUDIO
============================================================ */

function useGoogleAnnouncer() {
  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const audioContextRef =
    useRef<AudioContext | null>(null);

  const unlockedRef =
    useRef(false);

  const playingRef =
    useRef(false);

  const queueRef =
    useRef<
      Array<{
        text: string;
        key: string;
      }>
    >([]);

  const [unlocked, setUnlocked] =
    useState(false);

  const [audioError, setAudioError] =
    useState<string | null>(null);

  /* ==========================================================
     GET AUDIO ELEMENT
  ========================================================== */

  const getAudio =
    useCallback(() => {
      if (audioRef.current) {
        return audioRef.current;
      }

      const audio =
        document.createElement("audio");

      audio.preload = "auto";
      audio.volume = 1;
      audio.setAttribute(
        "playsinline",
        ""
      );

      /*
       * Append vào DOM để Chrome/TV browser
       * quản lý media element ổn định hơn.
       */
      audio.style.display = "none";

      document.body.appendChild(audio);

      audioRef.current = audio;

      return audio;
    }, []);

  /* ==========================================================
     UNLOCK BROWSER AUDIO
  ========================================================== */

  const unlock =
    useCallback(async () => {
      try {
        console.log(
          "[TV AUDIO] Unlock started"
        );

        /*
         * 1. Unlock Web Audio Context.
         */
        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (AudioContextClass) {
          if (!audioContextRef.current) {
            audioContextRef.current =
              new AudioContextClass();
          }

          const ctx =
            audioContextRef.current;

          if (ctx.state === "suspended") {
            await ctx.resume();
          }

          /*
           * Tạo âm thanh im lặng cực ngắn.
           * Mục đích: xác nhận user gesture
           * với browser.
           */
          const oscillator =
            ctx.createOscillator();

          const gain =
            ctx.createGain();

          gain.gain.value = 0;

          oscillator.connect(gain);
          gain.connect(ctx.destination);

          oscillator.start();

          oscillator.stop(
            ctx.currentTime + 0.01
          );
        }

        /*
         * 2. Lấy media element.
         */
        const audio =
          getAudio();

        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        /*
         * 3. Dùng data URI cực ngắn làm
         * media gesture unlock.
         *
         * Đây KHÔNG phải local MP3.
         * Chỉ là silent audio để browser
         * cho phép những lần play sau.
         */
        const silentWav =
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

        audio.src = silentWav;

        try {
          await audio.play();
          audio.pause();
        } catch (error) {
          console.warn(
            "[TV AUDIO] Silent media unlock failed",
            error
          );
        }

        try {
          audio.currentTime = 0;
        } catch {}

        audio.src = "";

        unlockedRef.current = true;
        setUnlocked(true);
        setAudioError(null);

        console.log(
          "[TV AUDIO] UNLOCKED SUCCESSFULLY"
        );

        /*
         * Nếu có cuộc gọi đang chờ,
         * xử lý ngay.
         */
        setTimeout(() => {
          void processQueueRef.current();
        }, 0);

        return true;
      } catch (error) {
        console.error(
          "[TV AUDIO] UNLOCK FAILED",
          error
        );

        unlockedRef.current = false;
        setUnlocked(false);

        setAudioError(
          "Không bật được âm thanh. Hãy bấm nút bật âm thanh trên TV."
        );

        return false;
      }
    }, [getAudio]);

  /* ==========================================================
     PLAY GOOGLE TTS
  ========================================================== */

  const playGoogleTTS =
    useCallback(
      async (text: string) => {
        if (!unlockedRef.current) {
          throw new Error(
            "Audio chưa được unlock"
          );
        }

        const audio =
          getAudio();

        const url =
          `/api/tts?text=${encodeURIComponent(
            text
          )}&_=${Date.now()}`;

        console.log(
          "[TV AUDIO] Google TTS:",
          text
        );

        setAudioError(null);

        await new Promise<void>(
          (resolve, reject) => {
            let finished = false;

            const cleanup =
              () => {
                audio.onended = null;
                audio.onerror = null;
                audio.onstalled = null;
                audio.onabort = null;
              };

            const success =
              () => {
                if (finished) return;

                finished = true;
                cleanup();

                console.log(
                  "[TV AUDIO] PLAY SUCCESS"
                );

                resolve();
              };

            const fail =
              (reason?: unknown) => {
                if (finished) return;

                finished = true;
                cleanup();

                console.error(
                  "[TV AUDIO] PLAY FAILED",
                  reason
                );

                reject(
                  reason instanceof Error
                    ? reason
                    : new Error(
                        "Google TTS playback failed"
                      )
                );
              };

            audio.pause();

            try {
              audio.currentTime = 0;
            } catch {}

            audio.src = url;

            audio.onended =
              success;

            audio.onerror =
              () =>
                fail(
                  new Error(
                    "Audio element error"
                  )
                );

            audio.onstalled =
              () =>
                console.warn(
                  "[TV AUDIO] Audio stalled"
                );

            audio.onabort =
              () =>
                fail(
                  new Error(
                    "Audio aborted"
                  )
                );

            /*
             * QUAN TRỌNG:
             *
             * Không fetch blob trước.
             * Browser tự request /api/tts.
             *
             * Như vậy:
             *
             * click
             * -> audio permission
             * -> media element
             * -> Google TTS
             * -> phát
             */
            void audio
              .play()
              .then(() => {
                console.log(
                  "[TV AUDIO] Browser accepted play()"
                );
              })
              .catch(fail);
          }
        );
      },
      [getAudio]
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
        queueRef.current.length ===
        0
      ) {
        return;
      }

      playingRef.current = true;

      try {
        while (
          queueRef.current.length >
            0 &&
          unlockedRef.current
        ) {
          const job =
            queueRef.current.shift();

          if (!job) {
            continue;
          }

          try {
            await playGoogleTTS(
              job.text
            );
          } catch (error) {
            console.error(
              "[TV AUDIO] Announcement failed",
              {
                key: job.key,
                error,
              }
            );

            setAudioError(
              "Không phát được giọng Google TTS."
            );
          }

          /*
           * Nghỉ rất ngắn giữa 2 lượt.
           */
          await new Promise<void>(
            (resolve) =>
              window.setTimeout(
                resolve,
                100
              )
          );
        }
      } finally {
        playingRef.current = false;
      }
    }, [playGoogleTTS]);

  /*
   * Ref để unlock() có thể gọi processQueue
   * mà không dính dependency vòng.
   */
  const processQueueRef =
    useRef(processQueue);

  useEffect(() => {
    processQueueRef.current =
      processQueue;
  }, [processQueue]);

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
          queueNumber.trim();

        const cleanDriver =
          driverName
            .replace(/\s+/g, " ")
            .trim();

        const cleanCounter =
          counterCode.trim();

        const text =
          buildAnnouncementText(
            cleanQueue,
            cleanDriver,
            cleanCounter
          );

        const key =
          `${cleanQueue}:${cleanCounter}:${cleanDriver}`;

        console.log(
          "[TV AUDIO] ENQUEUE",
          {
            key,
            text,
            unlocked:
              unlockedRef.current,
          }
        );

        queueRef.current.push({
          text,
          key,
        });

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
      const audio =
        audioRef.current;

      if (audio) {
        audio.pause();
        audio.removeAttribute(
          "src"
        );
        audio.load();

        if (audio.parentNode) {
          audio.parentNode.removeChild(
            audio
          );
        }
      }

      if (
        audioContextRef.current
      ) {
        void audioContextRef.current.close();
      }
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
      window.setInterval(() => {
        setNow(new Date());
      }, 1000);

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

  /*
   * counter_code + called_at
   */
  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  /*
   * Không refresh song song.
   */
  const loadingRef =
    useRef(false);

  /*
   * Debounce realtime.
   */
  const refreshTimer =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const {
    enqueue:
      enqueueAudio,
    unlock:
      unlockAudio,
    unlocked,
    audioError,
  } =
    useGoogleAnnouncer();

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
          "[TV] Counter RPC error",
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
          "[TV] Queue RPC error",
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

          const callKey =
            `${call.counter_code}:${call.called_at}`;

          if (
            announcedCalls.current.has(
              callKey
            )
          ) {
            continue;
          }

          const queueNumber =
            normalizeQueue(
              call.queue_number
            );

          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) === queueNumber
            );

          /*
           * Nếu queue đã gọi nhưng chưa lấy được
           * tên tài xế thì KHÔNG đánh dấu.
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
           * Mark trước enqueue để realtime
           * không gọi trùng.
           */
          announcedCalls.current.add(
            callKey
          );

          console.log(
            "[TV] NEW CALL",
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
            driver.driver_name,
            call.counter_code
          );
        }

        /*
         * Giữ Set không phình.
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
        ] =
          await Promise.all([
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
          "[TV] Refresh failed",
          error
        );
      } finally {
        loadingRef.current = false;
      }
    }, [
      loadCounters,
      loadAgentQueue,
      handleCalls,
    ]);

  /* ==========================================================
     SCHEDULE REFRESH
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
        }, 50);
    }, [refresh]);

  /* ==========================================================
     REALTIME
  ========================================================== */

  useEffect(() => {
    if (!branchCode) {
      return;
    }

    void refresh();

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
              "[TV REALTIME]",
              status
            );
          }
        );

    /*
     * Watchdog 5 giây.
     * Chỉ để recover khi realtime miss.
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
    useMemo(() => {
      const map =
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
          map.get(
            queue.agent_id
          ) ?? [];

        current.push(queue);

        map.set(
          queue.agent_id,
          current
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
          className="w-full bg-warn px-4 py-3 text-center font-body font-semibold text-white hover:bg-warn/90"
          style={{
            fontSize: "1vw",
          }}
        >
          🔊 BẤM VÀO ĐÂY 1 LẦN ĐỂ BẬT
          ÂM THANH
        </button>
      )}

      {unlocked && audioError && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio();
          }}
          className="w-full bg-red-600 px-4 py-2 text-center font-body font-semibold text-white"
          style={{
            fontSize: "0.9vw",
          }}
        >
          🔊 Âm thanh gặp lỗi — bấm
          để bật lại
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
                    month:
                      "2-digit",
                    year:
                      "numeric",
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
                      ? waitingByAgent.get(
                          counter.agent_id
                        ) ?? []
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

