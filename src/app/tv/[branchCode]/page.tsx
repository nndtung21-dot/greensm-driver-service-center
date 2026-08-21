tsx
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

const AUDIO_FILES = [
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

function normalizeQueue(value: string | null) {
  return value?.trim().toUpperCase() ?? "";
}

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
    const clip = DIGIT_CLIP[ch];

    if (clip) {
      clips.push(clip);
    }
  }

  clips.push("den_quay_so");

  const counterDigits = stripLeadingZeros(counterCode);

  for (const ch of counterDigits) {
    const clip = DIGIT_CLIP[ch];

    if (clip) {
      clips.push(clip);
    }
  }

  return clips;
}

function counterNumberToWords(counterCode: string) {
  const stripped = counterCode.replace(/^0+/, "");
  const n = parseInt(stripped || "0", 10);

  if (
    !Number.isNaN(n) &&
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
  const qWords = [...queueNumber.toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");

  const cWords = counterNumberToWords(counterCode);

  return `Kính mời tài xế có số ${qWords}, ${driverName}, đến quầy số ${cWords}`;
}

/* ============================================================
   AUDIO ANNOUNCER

   NGUYÊN TẮC:

   1. Chỉ dùng 1 HTMLAudioElement.
   2. Element được giữ suốt lifecycle.
   3. Unlock bằng user gesture.
   4. Preload bằng chính audio element đó.
   5. Mỗi clip:
      - pause
      - reset
      - đổi src
      - load
      - chờ canplay
      - play
      - chờ ended
   6. Local MP3 là đường chính.
   7. Speech synthesis chỉ là fallback cuối.
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
      Array<() => Promise<void>>
    >([]);

  const [unlocked, setUnlocked] =
    useState(false);

  /* ==========================================================
     CREATE AUDIO ELEMENT
  ========================================================== */

  const getAudio = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }

    if (!audioRef.current) {
      const audio =
        document.createElement("audio");

      audio.preload = "auto";
      audio.volume = 1;
      audio.autoplay = false;

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
     WAIT FOR AUDIO READY
  ========================================================== */

  const waitForCanPlay =
    useCallback(
      (
        audio: HTMLAudioElement
      ) =>
        new Promise<void>(
          (resolve, reject) => {
            if (
              audio.readyState >= 3
            ) {
              resolve();
              return;
            }

            let finished = false;

            const cleanup = () => {
              audio.removeEventListener(
                "canplay",
                onCanPlay
              );

              audio.removeEventListener(
                "canplaythrough",
                onCanPlay
              );

              audio.removeEventListener(
                "error",
                onError
              );

              audio.removeEventListener(
                "abort",
                onError
              );
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
                  "Audio không load được"
                )
              );
            };

            const onCanPlay =
              () => done();

            const onError =
              () => fail();

            audio.addEventListener(
              "canplay",
              onCanPlay
            );

            audio.addEventListener(
              "canplaythrough",
              onCanPlay
            );

            audio.addEventListener(
              "error",
              onError
            );

            audio.addEventListener(
              "abort",
              onError
            );

            /*
             * Có thể audio đã chuyển
             * trạng thái giữa lúc check
             * và lúc add listener.
             */
            if (
              audio.readyState >= 3
            ) {
              done();
            }
          }
        ),
      []
    );

  /* ==========================================================
     PRELOAD

     Không tạo new Audio() hàng loạt.
     Browser sẽ tự cache các MP3.
  ========================================================== */

  const preloadAudio =
    useCallback(() => {
      if (
        typeof window ===
        "undefined"
      ) {
        return;
      }

      for (const file of AUDIO_FILES) {
        const link =
          document.createElement(
            "link"
          );

        link.rel = "preload";
        link.as = "audio";
        link.href =
          `${CLIP_BASE}${file}.mp3`;

        document.head.appendChild(
          link
        );
      }

      console.log(
        "[TV AUDIO] preload requested"
      );
    }, []);

  /* ==========================================================
     UNLOCK

     QUAN TRỌNG:
     Không dùng volume 0.01.
     Phát intro thật ở volume 1 trong
     user gesture.

     Sau khi play thành công mới pause.
  ========================================================== */

  const unlock = useCallback(
    async () => {
      const audio = getAudio();

      if (!audio) {
        return false;
      }

      try {
        console.log(
          "[TV AUDIO] unlocking..."
        );

        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        audio.src =
          `${CLIP_BASE}intro.mp3`;

        audio.volume = 1;

        audio.load();

        await waitForCanPlay(audio);

        /*
         * Đây là play trực tiếp bên trong
         * click event.
         */
        await audio.play();

        /*
         * Đợi browser thực sự bắt đầu.
         */
        await new Promise<void>(
          (resolve) =>
            setTimeout(
              resolve,
              250
            )
        );

        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        unlockedRef.current = true;

        setUnlocked(true);

        preloadAudio();

        console.log(
          "[TV AUDIO] UNLOCK SUCCESS"
        );

        /*
         * Nếu lúc chưa unlock đã có
         * ticket chờ thì phát luôn.
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
    },
    [
      getAudio,
      waitForCanPlay,
      preloadAudio,
    ]
  );

  /* ==========================================================
     PLAY ONE CLIP
  ========================================================== */

  const playClip =
    useCallback(
      async (clipName: string) => {
        const audio = getAudio();

        if (!audio) {
          throw new Error(
            "Audio element unavailable"
          );
        }

        const src =
          `${CLIP_BASE}${clipName}.mp3`;

        console.log(
          "[TV AUDIO] loading:",
          src
        );

        /*
         * Dừng clip trước.
         */
        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        /*
         * Đổi source.
         */
        audio.src = src;
        audio.volume = 1;

        /*
         * Bắt browser load source mới.
         */
        audio.load();

        /*
         * Chờ source thực sự usable.
         */
        await waitForCanPlay(audio);

        console.log(
          "[TV AUDIO] playing:",
          clipName
        );

        await new Promise<void>(
          (resolve, reject) => {
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
                new Error(
                  `Không phát được ${src}`
                )
              );
            };

            audio.onended = finish;
            audio.onerror = fail;
            audio.onabort = fail;

            audio
              .play()
              .then(() => {
                console.log(
                  "[TV AUDIO] play() OK:",
                  clipName
                );
              })
              .catch((error) => {
                console.error(
                  "[TV AUDIO] play() FAILED:",
                  clipName,
                  error
                );

                fail();
              });
          }
        );
      },
      [
        getAudio,
        waitForCanPlay,
      ]
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
        const clips =
          buildAnnouncementClips(
            queueNumber,
            counterCode
          );

        console.log(
          "[TV AUDIO] ANNOUNCEMENT:",
          {
            queueNumber,
            counterCode,
            clips,
          }
        );

        for (const clip of clips) {
          await playClip(clip);

          /*
           * Khoảng nghỉ rất nhỏ giữa
           * các clip để tránh TV/browser
           * nuốt event.
           */
          await new Promise<void>(
            (resolve) =>
              setTimeout(
                resolve,
                30
              )
          );
        }
      },
      [playClip]
    );

  /* ==========================================================
     SPEECH FALLBACK
  ========================================================== */

  const playSpeech =
    useCallback(
      async (text: string) => {
        if (
          typeof window ===
            "undefined" ||
          !(
            "speechSynthesis" in
            window
          )
        ) {
          throw new Error(
            "speechSynthesis unavailable"
          );
        }

        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            window.speechSynthesis.cancel();

            const utterance =
              new SpeechSynthesisUtterance(
                text
              );

            utterance.lang =
              "vi-VN";

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
     PROCESS QUEUE
  ========================================================== */

  const processQueue =
    useCallback(async () => {
      if (playingRef.current) {
        return;
      }

      if (
        !unlockedRef.current
      ) {
        console.warn(
          "[TV AUDIO] waiting for unlock"
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

      console.log(
        "[TV AUDIO] processing queue:",
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

          try {
            await job();
          } catch (error) {
            console.error(
              "[TV AUDIO] announcement failed:",
              error
            );
          }

          await new Promise<void>(
            (resolve) =>
              setTimeout(
                resolve,
                150
              )
          );
        }
      } finally {
        playingRef.current = false;

        console.log(
          "[TV AUDIO] queue finished"
        );
      }
    }, []);

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

        console.log(
          "[TV AUDIO] enqueue:",
          {
            queueNumber,
            driverName,
            counterCode,
          }
        );

        queueRef.current.push(
          async () => {
            /*
             * LOCAL MP3
             */
            try {
              await playLocalAnnouncement(
                queueNumber,
                counterCode
              );

              console.log(
                "[TV AUDIO] LOCAL SUCCESS"
              );

              return;
            } catch (localError) {
              console.error(
                "[TV AUDIO] LOCAL FAILED:",
                localError
              );
            }

            /*
             * FALLBACK SPEECH
             */
            try {
              await playSpeech(
                text
              );

              console.log(
                "[TV AUDIO] SPEECH SUCCESS"
              );
            } catch (speechError) {
              console.error(
                "[TV AUDIO] ALL AUDIO FAILED:",
                speechError
              );
            }
          }
        );

        void processQueue();
      },
      [
        playLocalAnnouncement,
        playSpeech,
        processQueue,
      ]
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
        audio.src = "";
      }

      audioRef.current = null;

      queueRef.current = [];
      playingRef.current = false;
      unlockedRef.current = false;
    };
  }, []);

  /* ==========================================================
     PROCESS AFTER UNLOCK
  ========================================================== */

  useEffect(() => {
    if (unlocked) {
      void processQueue();
    }
  }, [unlocked, processQueue]);

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
   CALLED QUEUE HELPER
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
  ] =
    useState<
      CounterStatusRow[]
    >([]);

  const [
    agentQueue,
    setAgentQueue,
  ] =
    useState<
      AgentQueueRow[]
    >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    errorMessage,
    setErrorMessage,
  ] =
    useState<string | null>(
      null
    );

  /*
   * counter_code + called_at
   */
  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  const refreshTimer =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const loadingRef =
    useRef(false);

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
          "[TV] counter RPC error:",
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

        for (const call of activeCalls) {
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

          const normalized =
            normalizeQueue(
              call.queue_number
            );

          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) === normalized
            );

          if (
            !driver?.driver_name?.trim()
          ) {
            console.warn(
              "[TV] driver not found:",
              call.queue_number
            );

            continue;
          }

          /*
           * Mark trước enqueue.
           */
          announcedCalls.current.add(
            callKey
          );

          console.log(
            "[TV] NEW CALL:",
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
         * Không để Set tăng vô hạn.
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
     DEBOUNCE REALTIME
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
        }, 80);
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
     * Supabase realtime.
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
            "[TV REALTIME STATUS]",
            status
          );
        });

    /*
     * Watchdog 5s.
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
          className="w-full bg-warn px-4 py-3 text-center font-body font-semibold text-white hover:bg-warn/90"
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

