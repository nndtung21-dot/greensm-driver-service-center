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
  return (value ?? "").trim().toUpperCase();
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
) {
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
   GOOGLE TTS TEXT
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

function counterNumberToWords(counterCode: string) {
  const clean = counterCode.trim();

  const stripped = clean.replace(/^0+/, "");
  const n = parseInt(stripped || "0", 10);

  if (
    !Number.isNaN(n) &&
    n >= 0 &&
    n < SMALL_NUMBER_WORDS.length
  ) {
    return SMALL_NUMBER_WORDS[n];
  }

  return [...clean]
    .map(
      (ch) =>
        DIGIT_WORD[ch.toUpperCase()] ?? ch
    )
    .join(" ");
}

function queueNumberToWords(queueNumber: string) {
  return [...queueNumber.toUpperCase()]
    .map(
      (ch) =>
        DIGIT_WORD[ch] ?? ch
    )
    .join(" ");
}

function cleanDriverName(name: string) {
  return name
    .replace(/\s+/g, " ")
    .trim();
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterCode: string
) {
  const queueWords =
    queueNumberToWords(queueNumber);

  const counterWords =
    counterNumberToWords(counterCode);

  const name =
    cleanDriverName(driverName);

  /*
   * Không dùng local MP3.
   *
   * Tên tài xế được gửi nguyên văn sang Google TTS
   * để Google đọc bằng giọng tiếng Việt.
   */
  return (
    `Kính mời tài xế có số ${queueWords}, ` +
    `${name}, ` +
    `đến quầy số ${counterWords}.`
  );
}

/* ============================================================
   GOOGLE TTS AUDIO ENGINE
   ============================================================ */

function useGoogleTTS() {
  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const currentObjectUrlRef =
    useRef<string | null>(null);

  const queueRef =
    useRef<
      Array<{
        id: string;
        text: string;
      }>
    >([]);

  const playingRef =
    useRef(false);

  const unlockedRef =
    useRef(false);

  const unlockingRef =
    useRef(false);

  const mountedRef =
    useRef(true);

  const [unlocked, setUnlocked] =
    useState(false);

  const [audioStatus, setAudioStatus] =
    useState("Chưa bật âm thanh");

  /* ==========================================================
     AUDIO ELEMENT
     ========================================================== */

  const getAudio =
    useCallback(() => {
      if (typeof window === "undefined") {
        throw new Error(
          "Audio chỉ chạy trên browser"
        );
      }

      if (!audioRef.current) {
        const audio =
          document.createElement("audio");

        audio.preload = "auto";
        audio.volume = 1;
        audio.muted = false;
        audio.autoplay = false;

        audio.setAttribute(
          "playsinline",
          ""
        );

        audio.setAttribute(
          "webkit-playsinline",
          ""
        );

        audio.style.display = "none";

        document.body.appendChild(audio);

        audioRef.current = audio;
      }

      return audioRef.current;
    }, []);

  /* ==========================================================
     CLEANUP AUDIO URL
     ========================================================== */

  const cleanupAudioSource =
    useCallback(() => {
      const audio =
        audioRef.current;

      if (audio) {
        audio.pause();

        audio.removeAttribute("src");

        try {
          audio.load();
        } catch {}
      }

      if (
        currentObjectUrlRef.current
      ) {
        URL.revokeObjectURL(
          currentObjectUrlRef.current
        );

        currentObjectUrlRef.current =
          null;
      }
    }, []);

  /* ==========================================================
     FETCH GOOGLE TTS
     ========================================================== */

  const fetchTTS =
    useCallback(async (text: string) => {
      const response =
        await fetch(
          `/api/tts?text=${encodeURIComponent(
            text
          )}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

      console.log(
        "[TV AUDIO] TTS RESPONSE:",
        response.status,
        response.headers.get(
          "content-type"
        )
      );

      if (!response.ok) {
        throw new Error(
          `Google TTS HTTP ${response.status}`
        );
      }

      const blob =
        await response.blob();

      console.log(
        "[TV AUDIO] TTS BLOB:",
        {
          type: blob.type,
          size: blob.size,
        }
      );

      if (
        !blob ||
        blob.size === 0
      ) {
        throw new Error(
          "Google TTS trả về audio rỗng"
        );
      }

      return blob;
    }, []);

  /* ==========================================================
     PLAY AUDIO
     ========================================================== */

  const playBlob =
    useCallback(
      async (
        blob: Blob,
        label: string
      ) => {
        const audio =
          getAudio();

        cleanupAudioSource();

        const url =
          URL.createObjectURL(blob);

        currentObjectUrlRef.current =
          url;

        audio.src = url;
        audio.volume = 1;
        audio.muted = false;

        audio.load();

        console.log(
          "[TV AUDIO] LOAD:",
          label
        );

        /*
         * Chờ audio thực sự có thể phát.
         */
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let finished = false;

            const cleanup =
              () => {
                audio.oncanplay =
                  null;

                audio.oncanplaythrough =
                  null;

                audio.onerror =
                  null;

                window.clearTimeout(
                  timer
                );
              };

            const finish =
              () => {
                if (finished) {
                  return;
                }

                finished = true;

                cleanup();

                resolve();
              };

            const fail =
              () => {
                if (finished) {
                  return;
                }

                finished = true;

                cleanup();

                reject(
                  new Error(
                    "Audio element không load được Google TTS"
                  )
                );
              };

            const timer =
              window.setTimeout(
                () => {
                  if (
                    audio.readyState >= 2
                  ) {
                    finish();
                  } else {
                    fail();
                  }
                },
                8000
              );

            audio.oncanplay =
              finish;

            audio.oncanplaythrough =
              finish;

            audio.onerror =
              fail;

            if (
              audio.readyState >= 2
            ) {
              finish();
            }
          }
        );

        if (
          !mountedRef.current
        ) {
          return;
        }

        console.log(
          "[TV AUDIO] PLAY:",
          label
        );

        /*
         * Đây là audio element đã được user
         * unlock bằng click.
         */
        await audio.play();

        /*
         * Chờ phát hết.
         */
        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let finished = false;

            const cleanup =
              () => {
                audio.onended =
                  null;

                audio.onerror =
                  null;
              };

            const finish =
              () => {
                if (finished) {
                  return;
                }

                finished = true;

                cleanup();

                resolve();
              };

            const fail =
              () => {
                if (finished) {
                  return;
                }

                finished = true;

                cleanup();

                reject(
                  new Error(
                    "Google TTS playback failed"
                  )
                );
              };

            audio.onended =
              finish;

            audio.onerror =
              fail;

            if (
              audio.ended
            ) {
              finish();
            }
          }
        );

        console.log(
          "[TV AUDIO] PLAY END:",
          label
        );

        cleanupAudioSource();
      },
      [
        getAudio,
        cleanupAudioSource,
      ]
    );

  /* ==========================================================
     PROCESS QUEUE
     ========================================================== */

  const processQueue =
    useCallback(async () => {
      if (
        playingRef.current
      ) {
        return;
      }

      if (
        !unlockedRef.current
      ) {
        console.log(
          "[TV AUDIO] QUEUE WAIT - NOT UNLOCKED"
        );

        return;
      }

      if (
        queueRef.current.length ===
        0
      ) {
        return;
      }

      playingRef.current =
        true;

      console.log(
        "[TV AUDIO] ===== QUEUE START =====",
        queueRef.current.length
      );

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

          console.log(
            "[TV AUDIO] PROCESS:",
            job.id,
            job.text
          );

          try {
            const blob =
              await fetchTTS(
                job.text
              );

            await playBlob(
              blob,
              job.text
            );

            console.log(
              "[TV AUDIO] SUCCESS:",
              job.id
            );
          } catch (error) {
            console.error(
              "[TV AUDIO] PLAY FAILED:",
              job.id,
              error
            );
          }

          /*
           * Nghỉ ngắn giữa 2 cuộc gọi.
           */
          await new Promise<void>(
            (resolve) =>
              window.setTimeout(
                resolve,
                150
              )
          );
        }
      } finally {
        playingRef.current =
          false;

        console.log(
          "[TV AUDIO] ===== QUEUE END ====="
        );
      }
    }, [
      fetchTTS,
      playBlob,
    ]);

  /* ==========================================================
     UNLOCK AUDIO
     ========================================================== */

  const unlock =
    useCallback(async () => {
      /*
       * Không cho click nhiều lần đồng thời.
       */
      if (
        unlockingRef.current
      ) {
        console.log(
          "[TV AUDIO] UNLOCK ALREADY RUNNING"
        );

        return false;
      }

      unlockingRef.current =
        true;

      console.log(
        "[TV AUDIO] ===== UNLOCK START ====="
      );

      try {
        const audio =
          getAudio();

        /*
         * Đảm bảo không muted.
         */
        audio.muted = false;
        audio.volume = 1;

        setAudioStatus(
          "Đang kiểm tra Google TTS..."
        );

        /*
         * TEST Google TTS.
         */
        const testText =
          "Âm thanh thông báo đã được bật.";

        const blob =
          await fetchTTS(
            testText
          );

        /*
         * QUAN TRỌNG:
         *
         * Không set unlocked = true ở đây.
         *
         * Phải phát xong test trước.
         *
         * Tránh useEffect processQueue()
         * đè source của câu test.
         */
        await playBlob(
          blob,
          "TEST: Âm thanh thông báo đã được bật"
        );

        if (
          !mountedRef.current
        ) {
          return false;
        }

        /*
         * Chỉ sau khi test phát xong
         * mới chính thức unlock.
         */
        unlockedRef.current =
          true;

        setUnlocked(true);

        setAudioStatus(
          "Âm thanh Google đã bật — Sẵn sàng gọi số"
        );

        console.log(
          "[TV AUDIO] ===== UNLOCK COMPLETE ====="
        );

        /*
         * Nếu trong lúc user chưa bật audio
         * đã có cuộc gọi mới thì xử lý ngay.
         */
        void processQueue();

        return true;
      } catch (error) {
        console.error(
          "[TV AUDIO] ===== UNLOCK FAILED =====",
          error
        );

        unlockedRef.current =
          false;

        setUnlocked(false);

        setAudioStatus(
          "Không bật được âm thanh"
        );

        return false;
      } finally {
        unlockingRef.current =
          false;
      }
    }, [
      getAudio,
      fetchTTS,
      playBlob,
      processQueue,
    ]);

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
        const text =
          buildAnnouncementText(
            queueNumber,
            driverName,
            counterCode
          );

        const id =
          `${counterCode}-${queueNumber}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        console.log(
          "[TV AUDIO] ===== ENQUEUE =====",
          {
            id,
            queueNumber,
            driverName,
            counterCode,
            text,
            unlocked:
              unlockedRef.current,
          }
        );

        queueRef.current.push({
          id,
          text,
        });

        /*
         * Nếu đã bật âm thanh thì phát ngay.
         *
         * Nếu chưa bật:
         * queue giữ lại.
         *
         * Sau khi user click bật audio,
         * unlock() sẽ gọi processQueue().
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
     UNLOCKED QUEUE WATCH
     ========================================================== */

  useEffect(() => {
    if (!unlocked) {
      return;
    }

    void processQueue();
  }, [
    unlocked,
    processQueue,
  ]);

  /* ==========================================================
     CLEANUP
     ========================================================== */

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      unlockedRef.current =
        false;

      unlockingRef.current =
        false;

      playingRef.current =
        false;

      queueRef.current = [];

      const audio =
        audioRef.current;

      if (audio) {
        audio.pause();

        audio.removeAttribute(
          "src"
        );

        try {
          audio.load();
        } catch {}

        audio.remove();
      }

      if (
        currentObjectUrlRef.current
      ) {
        URL.revokeObjectURL(
          currentObjectUrlRef.current
        );

        currentObjectUrlRef.current =
          null;
      }
    };
  }, []);

  return {
    enqueue,
    unlock,
    unlocked,
    audioStatus,
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
   * Một call chỉ được đọc một lần.
   */
  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  /*
   * QUAN TRỌNG CHO NEXT.JS / VERCEL:
   *
   * Dùng ReturnType<typeof window.setTimeout>
   * thay vì NodeJS.Timeout.
   */
  const refreshTimer =
    useRef<
      ReturnType<typeof window.setTimeout> | null
    >(null);

  const loadingRef =
    useRef(false);

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
    audioStatus,
  } = useGoogleTTS();

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
          "[TV] COUNTER RPC ERROR:",
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
          "[TV] QUEUE RPC ERROR:",
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

        console.log(
          "[TV] ACTIVE CALLS:",
          activeCalls
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
           * Mỗi lần counter gọi một queue,
           * called_at phải tạo callKey mới.
           */
          const callKey =
            `${call.counter_code}:${call.queue_number}:${call.called_at}`;

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
           * Tìm ticket chính xác.
           */
          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) === targetQueue
            );

          if (!driver) {
            console.warn(
              "[TV] DRIVER NOT FOUND:",
              {
                queue:
                  call.queue_number,
                queueList:
                  queueList.length,
              }
            );

            /*
             * Không mark.
             *
             * Refresh sau sẽ tìm lại.
             */
            continue;
          }

          const driverName =
            cleanDriverName(
              driver.driver_name ?? ""
            );

          if (!driverName) {
            console.warn(
              "[TV] DRIVER NAME EMPTY:",
              call.queue_number
            );

            continue;
          }

          console.log(
            "[TV] ===== NEW CALL =====",
            {
              callKey,
              queueNumber:
                call.queue_number,
              driverName,
              counter:
                call.counter_code,
              calledAt:
                call.called_at,
              audioUnlocked:
                unlocked,
            }
          );

          /*
           * Mark TRƯỚC enqueue.
           *
           * Tránh realtime + watchdog
           * enqueue cùng một cuộc gọi.
           */
          announcedCalls.current.add(
            callKey
          );

          enqueueAudio(
            call.queue_number,
            driverName,
            call.counter_code
          );
        }

        /*
         * Không để Set phình vô hạn.
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
      [
        enqueueAudio,
        unlocked,
      ]
    );

  /* ==========================================================
     REFRESH
     ========================================================== */

  const refresh =
    useCallback(async () => {
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
          "[TV] REFRESH ERROR:",
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
     SCHEDULE REFRESH
     ========================================================== */

  const scheduleRefresh =
    useCallback(() => {
      if (
        refreshTimer.current
      ) {
        window.clearTimeout(
          refreshTimer.current
        );
      }

      refreshTimer.current =
        window.setTimeout(
          () => {
            void refresh();
          },
          80
        );
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

    console.log(
      "[TV REALTIME] SUBSCRIBE:",
      branchCode
    );

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
        .subscribe(
          (status) => {
            console.log(
              "[TV REALTIME] STATUS:",
              status
            );
          }
        );

    /*
     * Watchdog 5s.
     *
     * Backup nếu realtime miss.
     */
    const watchdog =
      window.setInterval(() => {
        void refresh();
      }, 5000);

    return () => {
      if (
        refreshTimer.current
      ) {
        window.clearTimeout(
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
    useMemo(() => {
      const map =
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
      [
        agentQueue,
        counters,
      ]
    );

  /* ==========================================================
     RENDER
     ========================================================== */

  return (
    <div className="flex min-h-screen w-screen flex-col overflow-hidden bg-paper">

      {/* ======================================================
          AUDIO
          ====================================================== */}

      {!unlocked && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio();
          }}
          disabled={
            audioStatus.includes(
              "Đang kiểm tra"
            )
          }
          className="w-full bg-warn px-4 py-3 text-center font-body font-bold text-white hover:bg-warn/90 disabled:cursor-wait disabled:opacity-80"
          style={{
            fontSize: "1vw",
          }}
        >
          🔊 BẤM ĐỂ BẬT ÂM THANH
          {" — "}
          {audioStatus}
        </button>
      )}

      {unlocked && (
        <div
          className="flex items-center justify-between bg-brand-700 px-4 py-1.5 text-white"
          style={{
            fontSize: "0.75vw",
          }}
        >
          <span>
            🔊 {audioStatus}
          </span>

          <button
            type="button"
            onClick={() => {
              void unlockAudio();
            }}
            className="rounded-md bg-white/15 px-3 py-1 hover:bg-white/25"
          >
            Test lại âm thanh
          </button>
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
