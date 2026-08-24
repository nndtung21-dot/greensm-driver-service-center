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

type SpeechJob = {
  id: string;
  text: string;
};

/* ============================================================
   HELPERS
   ============================================================ */

function normalizeQueue(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
): boolean {
  const queueNumber = normalizeQueue(queue.queue_number);

  if (!queueNumber) return false;

  return counters.some(
    (counter) =>
      normalizeQueue(counter.queue_number) === queueNumber &&
      Boolean(counter.called_at)
  );
}

/* ============================================================
   VIETNAMESE NUMBER / CHARACTER WORDS
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
  B: "bê",
  C: "xê",
  D: "đê",
  E: "e",
  F: "ép",
  G: "gờ",
  H: "hát",
  I: "i",
  J: "gi",
  K: "ca",
  L: "e lờ",
  M: "em",
  N: "en",
  O: "ô",
  P: "pê",
  Q: "quy",
  R: "e rờ",
  S: "ét",
  T: "tê",
  U: "u",
  V: "vê",
  W: "vê kép",
  X: "ích",
  Y: "i dài",
  Z: "dét",
};

const SMALL_NUMBER_WORDS: string[] = [
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
];

function numberToVietnameseWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";

  n = Math.floor(n);

  if (n < 20) {
    return SMALL_NUMBER_WORDS[n] ?? "";
  }

  if (n < 100) {
    const tens = Math.floor(n / 10);
    const units = n % 10;

    const result = `${DIGIT_WORD[String(tens)]} mươi`;

    if (units === 0) return result;
    if (units === 1) return `${result} mốt`;
    if (units === 4) return `${result} tư`;
    if (units === 5) return `${result} lăm`;

    return `${result} ${DIGIT_WORD[String(units)]}`;
  }

  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const remainder = n % 100;

    const result = `${DIGIT_WORD[String(hundreds)]} trăm`;

    if (remainder === 0) return result;

    if (remainder < 10) {
      return `${result} lẻ ${DIGIT_WORD[String(remainder)]}`;
    }

    return `${result} ${numberToVietnameseWords(remainder)}`;
  }

  return String(n)
    .split("")
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

function extractCounterNumber(counterName: string): string {
  const value = counterName.trim();

  const match = value.match(
    /(?:quầy\s*(?:số\s*)?)(\d+)/i
  );

  if (match?.[1]) {
    return match[1];
  }

  if (/^\d+$/.test(value)) {
    return value;
  }

  const fallback = value.match(/(\d+)\s*$/);

  if (fallback?.[1]) {
    return fallback[1];
  }

  return value;
}

function counterNumberToWords(counterName: string): string {
  const number = extractCounterNumber(counterName);
  const numeric = Number(number);

  if (
    Number.isFinite(numeric) &&
    numeric >= 0 &&
    numeric < 1000
  ) {
    return numberToVietnameseWords(numeric);
  }

  return [...number]
    .map(
      (ch) => DIGIT_WORD[ch.toUpperCase()] ?? ch
    )
    .join(" ");
}

function queueNumberToWords(queueNumber: string): string {
  return [...queueNumber.trim().toUpperCase()]
    .map((ch) => DIGIT_WORD[ch] ?? ch)
    .join(" ");
}

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterName: string
): string {
  return (
    `Kính mời tài xế số ${queueNumberToWords(queueNumber)}, ` +
    `${driverName.trim().replace(/\s+/g, " ")}, ` +
    `vui lòng đến quầy số ${counterNumberToWords(counterName)}.`
  );
}

/* ============================================================
   TV SPEECH ENGINE
   GOOGLE TTS /api/tts
   ============================================================ */

function useTvSpeech(
  apiEndpoint: string = "/api/tts"
) {
  const queueRef = useRef<SpeechJob[]>([]);
  const speakingRef = useRef(false);
  const unlockedRef = useRef(false);

  /*
   * Dùng ref để luôn gọi processQueue phiên bản mới nhất,
   * tránh stale closure trong các callback.
   */
  const processQueueRef =
    useRef<() => void>(() => {});

  const [unlocked, setUnlocked] =
    useState(false);

  const [audioStatus, setAudioStatus] =
    useState("Chưa bật âm thanh");

  /* ----------------------------------------------------------
     PLAY TTS
     ---------------------------------------------------------- */

  const speakText = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }

        const safeText = text
          .trim()
          .slice(0, 290);

        if (!safeText) {
          resolve();
          return;
        }

        const audioUrl =
          `${apiEndpoint}?text=${encodeURIComponent(
            safeText
          )}`;

        const audio = new Audio(audioUrl);

        /*
         * Preload để giảm delay khi gọi.
         */
        audio.preload = "auto";

        /*
         * Volume tối đa.
         */
        audio.volume = 1;

        let finished = false;

        let timeoutId: number | undefined;

        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          audio.onabort = null;
          audio.onstalled = null;
          audio.oncanplay = null;

          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          };
        };

        const finish = () => {
          if (finished) return;

          finished = true;

          cleanup();

          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {
            // Ignore cleanup errors
          }

          resolve();
        };

        /*
         * Timeout 15 giây.
         *
         * Tăng từ 10s lên 15s vì request TTS/network
         * đôi khi mất vài giây trên TV.
         */
        timeoutId = window.setTimeout(() => {
          console.warn(
            "[TTS Client] Audio timeout"
          );

          finish();
        }, 15000);

        audio.onended = () => {
          finish();
        };

        audio.onerror = (event) => {
          console.error(
            "[TTS Client] Lỗi phát âm thanh:",
            event
          );

          finish();
        };

        audio.onabort = () => {
          finish();
        };

        audio.onstalled = () => {
          console.warn(
            "[TTS Client] Audio bị stalled"
          );
        };

        /*
         * Quan trọng:
         * Chỉ gọi play() sau khi user đã unlock.
         *
         * Nếu browser vẫn chặn thì queue không bị treo.
         */
        audio
          .play()
          .then(() => {
            setAudioStatus(
              "Đang phát âm thanh"
            );
          })
          .catch((error) => {
            console.error(
              "[TTS Client] Trình duyệt chặn audio:",
              error
            );

            finish();
          });
      });
    },
    [apiEndpoint]
  );

  /* ----------------------------------------------------------
     PROCESS QUEUE
     ---------------------------------------------------------- */

  const processQueue = useCallback(
    async () => {
      if (
        speakingRef.current ||
        !unlockedRef.current ||
        queueRef.current.length === 0
      ) {
        return;
      }

      speakingRef.current = true;

      try {
        while (
          unlockedRef.current &&
          queueRef.current.length > 0
        ) {
          const job =
            queueRef.current.shift();

          if (!job) {
            continue;
          }

          /*
           * Mỗi lượt đọc 2 lần.
           */
          for (
            let repeat = 1;
            repeat <= 2;
            repeat++
          ) {
            if (!unlockedRef.current) {
              break;
            }

            await speakText(job.text);

            /*
             * Nghỉ 800ms giữa 2 lần đọc.
             */
            if (repeat === 1) {
              await new Promise<void>(
                (resolve) => {
                  window.setTimeout(
                    resolve,
                    800
                  );
                }
              );
            }
          }

          /*
           * Nghỉ trước lượt tiếp theo.
           */
          if (
            unlockedRef.current &&
            queueRef.current.length > 0
          ) {
            await new Promise<void>(
              (resolve) => {
                window.setTimeout(
                  resolve,
                  600
                );
              }
            );
          }
        }
      } finally {
        speakingRef.current = false;

        if (
          unlockedRef.current &&
          queueRef.current.length > 0
        ) {
          window.setTimeout(() => {
            void processQueueRef.current();
          }, 100);
        } else {
          setAudioStatus(
            unlockedRef.current
              ? "Âm thanh sẵn sàng"
              : "Chưa bật âm thanh"
          );
        }
      }
    },
    [speakText]
  );

  useEffect(() => {
    processQueueRef.current = () => {
      void processQueue();
    };
  }, [processQueue]);

  /* ----------------------------------------------------------
     UNLOCK
     ---------------------------------------------------------- */

  const unlock = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      /*
       * Đây là click trực tiếp của user.
       * Tạo một audio cực ngắn để browser cho phép
       * audio playback trong session hiện tại.
       */
      const silentAudio =
        new Audio(
          "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAA"
        );

      silentAudio.volume = 0;

      unlockedRef.current = true;
      setUnlocked(true);
      setAudioStatus(
        "Đang kiểm tra âm thanh"
      );

      /*
       * Thử unlock audio.
       */
      void silentAudio
        .play()
        .then(() => {
          try {
            silentAudio.pause();
            silentAudio.currentTime = 0;
          } catch {
            // Ignore
          }
        })
        .catch((error) => {
          /*
           * Không coi đây là lỗi chết.
           *
           * Audio TTS thật vẫn được thử ngay bên dưới.
           */
          console.warn(
            "[TTS Client] Silent audio unlock failed:",
            error
          );
        });

      /*
       * Đọc câu test thật từ /api/tts.
       *
       * Vì đây là thao tác trực tiếp sau click user,
       * browser sẽ cho phép audio.
       */
      void speakText(
        "Hệ thống gọi số đã sẵn sàng."
      ).then(() => {
        setAudioStatus(
          "Âm thanh sẵn sàng"
        );

        /*
         * Sau câu test, xử lý queue.
         */
        window.setTimeout(() => {
          void processQueueRef.current();
        }, 100);
      });

      return true;
    } catch (error) {
      console.error(
        "[TTS Client] Không bật được âm thanh:",
        error
      );

      unlockedRef.current = false;
      setUnlocked(false);
      setAudioStatus(
        "Không bật được âm thanh"
      );

      return false;
    }
  }, [speakText]);

  /* ----------------------------------------------------------
     ENQUEUE
     ---------------------------------------------------------- */

  const enqueue = useCallback(
    (
      queueNumber: string,
      driverName: string,
      counterName: string
    ) => {
      const text =
        buildAnnouncementText(
          queueNumber,
          driverName,
          counterName
        );

      const job: SpeechJob = {
        id:
          `${counterName}-${queueNumber}-` +
          `${Date.now()}-${Math.random()}`,
        text,
      };

      /*
       * Không để queue phình vô hạn.
       */
      if (queueRef.current.length >= 100) {
        queueRef.current.shift();
      }

      queueRef.current.push(job);

      /*
       * Nếu audio đã unlock thì xử lý ngay.
       *
       * Nếu chưa unlock, job nằm trong queue.
       * Khi user bấm bật âm thanh, nó sẽ được đọc.
       */
      if (unlockedRef.current) {
        void processQueueRef.current();
      }
    },
    []
  );

  /* ----------------------------------------------------------
     STOP
     ---------------------------------------------------------- */

  const stop = useCallback(() => {
    /*
     * Không reset unlocked.
     *
     * Chỉ dùng để dọn queue khi component unmount.
     */
    queueRef.current = [];
    speakingRef.current = false;
  }, []);

  return {
    enqueue,
    unlock,
    stop,
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
   MAIN TV COMPONENT
   ============================================================ */

export default function TvDisplayPage() {
  const params =
    useParams<{ branchCode: string }>();

  const branchCode =
    params.branchCode;

  const [counters, setCounters] =
    useState<CounterStatusRow[]>([]);

  const [agentQueue, setAgentQueue] =
    useState<AgentQueueRow[]>([]);

  /*
   * Lịch sử các lượt đã announcement.
   *
   * Key:
   * counter_code + called_at
   */
  const announcedCalls =
    useRef<Set<string>>(new Set());

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    stop: stopAudio,
    unlocked,
    audioStatus,
  } = useTvSpeech("/api/tts");

  const clock = useClock();

  /* ==========================================================
     LOAD DATA
     ========================================================== */

  const loadData = useCallback(
    async () => {
      if (!branchCode) return;

      try {
        const [cRes, qRes] =
          await Promise.all([
            supabase.rpc(
              "tv_counter_status",
              {
                p_branch_code:
                  branchCode,
              }
            ),

            supabase.rpc(
              "tv_agent_queue_list",
              {
                p_branch_code:
                  branchCode,
              }
            ),
          ]);

        if (cRes.error) {
          console.error(
            "[TV] tv_counter_status error:",
            cRes.error
          );
        }

        if (qRes.error) {
          console.error(
            "[TV] tv_agent_queue_list error:",
            qRes.error
          );
        }

        const counterList =
          (
            (cRes.data ??
              []) as CounterStatusRow[]
          ).sort(
            (a, b) =>
              a.display_order -
              b.display_order
          );

        const queueList =
          (
            (qRes.data ??
              []) as AgentQueueRow[]
          ).sort(
            (a, b) =>
              new Date(
                a.created_at
              ).getTime() -
              new Date(
                b.created_at
              ).getTime()
          );

        setCounters(counterList);
        setAgentQueue(queueList);

        /* ======================================================
           DETECT NEW CALLS
           ====================================================== */

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
           * Mỗi lần gọi mới sẽ có called_at mới.
           */
          const callKey =
            `${call.counter_code}:${call.called_at}`;

          /*
           * Đã đọc rồi thì không đọc lại.
           */
          if (
            announcedCalls.current.has(
              callKey
            )
          ) {
            continue;
          }

          /*
           * Tìm thông tin tài xế.
           */
          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) ===
                normalizeQueue(
                  call.queue_number
                )
            );

          /*
           * Nếu chưa lấy được driver,
           * KHÔNG đánh dấu đã đọc.
           *
           * Polling sau sẽ thử lại.
           */
          if (!driver?.driver_name) {
            continue;
          }

          /*
           * Giới hạn history 200 lượt.
           */
          if (
            announcedCalls.current
              .size >= 200
          ) {
            const firstKey =
              announcedCalls.current
                .values()
                .next().value;

            if (firstKey) {
              announcedCalls.current.delete(
                firstKey
              );
            }
          }

          /*
           * Đánh dấu trước khi enqueue.
           *
           * Quan trọng để polling 3 giây
           * không tạo duplicate.
           */
          announcedCalls.current.add(
            callKey
          );

          enqueueAudio(
            call.queue_number,
            driver.driver_name,
            call.counter_name ||
              call.counter_code
          );
        }
      } catch (error) {
        console.error(
          "[TV] Load data error:",
          error
        );
      }
    },
    [
      branchCode,
      enqueueAudio,
    ]
  );

  /* ==========================================================
     POLLING
     ========================================================== */

  useEffect(() => {
    if (!branchCode) return;

    void loadData();

    const interval =
      window.setInterval(() => {
        void loadData();
      }, 3000);

    return () => {
      window.clearInterval(
        interval
      );
    };
  }, [branchCode, loadData]);

  /* ==========================================================
     CLEANUP
     ========================================================== */

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  /* ==========================================================
     WAITING QUEUE
     ========================================================== */

  const waitingQueue =
    useMemo(() => {
      return agentQueue.filter(
        (q) =>
          !isCalledQueue(
            q,
            counters
          )
      );
    }, [
      agentQueue,
      counters,
    ]);

  /* ==========================================================
     QUEUE BY COUNTER
     ========================================================== */

  const queueByCounter =
    useMemo(() => {
      const map =
        new Map<
          string,
          AgentQueueRow[]
        >();

      counters.forEach(
        (counter) => {
          if (counter.agent_id) {
            map.set(
              counter.agent_id,
              []
            );
          }
        }
      );

      waitingQueue.forEach(
        (q) => {
          if (
            q.agent_id &&
            map.has(q.agent_id)
          ) {
            map
              .get(q.agent_id)
              ?.push(q);
          }
        }
      );

      return map;
    }, [
      counters,
      waitingQueue,
    ]);

  /* ============================================================
     UI
     ============================================================ */

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-white select-none overflow-hidden font-sans">
      <header className="flex h-20 items-center justify-between border-b border-slate-800 bg-slate-900/80 px-8">
        <h1 className="text-2xl font-bold text-amber-400">
          HỆ THỐNG GỌI SỐ - CHI NHÁNH{" "}
          {branchCode?.toUpperCase()}
        </h1>

        <div className="flex items-center gap-6">
          <button
            onClick={() => {
              if (!unlocked) {
                void unlockAudio();
              }
            }}
            disabled={unlocked}
            className={`rounded-lg px-4 py-2 font-medium transition-colors ${
              unlocked
                ? "cursor-default border border-emerald-500/30 bg-emerald-600/30 text-emerald-400"
                : "border border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
            }`}
          >
            {audioStatus}
          </button>

          <div className="font-mono text-2xl font-semibold text-slate-200">
            {clock
              ? clock.toLocaleTimeString(
                  "vi-VN"
                )
              : "--:--:--"}
          </div>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* ====================================================
            TRẠNG THÁI QUẦY
           ==================================================== */}

        <section className="col-span-7 flex flex-col gap-4 overflow-y-auto pr-2">
          <h2 className="text-xl font-semibold text-slate-400 border-b border-slate-800 pb-2">
            TRẠNG THÁI QUẦY PHỤC VỤ
          </h2>

          <div className="grid grid-cols-2 gap-4">
            {counters.map(
              (counter) => {
                const isServing =
                  Boolean(
                    counter.queue_number &&
                      counter.called_at
                  );

                return (
                  <div
                    key={
                      counter.counter_code
                    }
                    className={`flex flex-col justify-between rounded-xl border p-5 ${
                      isServing
                        ? "border-amber-500/50 bg-amber-500/10 shadow-lg shadow-amber-500/5 animate-pulse"
                        : "border-slate-800 bg-slate-900/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-slate-200">
                        {
                          counter.counter_name
                        }
                      </span>

                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                        {
                          counter.counter_status
                        }
                      </span>
                    </div>

                    <div className="my-4 text-center">
                      <div className="text-xs uppercase text-slate-400">
                        Đang gọi
                      </div>

                      <div className="text-5xl font-extrabold text-amber-400 mt-1">
                        {counter.queue_number ??
                          "---"}
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </section>

        {/* ====================================================
            HÀNG ĐỢI THEO TỪNG QUẦY
           ==================================================== */}

        <section className="col-span-5 flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-xl font-semibold text-slate-400 border-b border-slate-800 pb-3 mb-3">
            HÀNG ĐỢI THEO QUẦY
          </h2>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {counters.map(
              (counter) => {
                const list =
                  (counter.agent_id
                    ? queueByCounter.get(
                        counter.agent_id
                      )
                    : []) ?? [];

                return (
                  <div
                    key={
                      counter.counter_code
                    }
                    className="rounded-lg border border-slate-800 bg-slate-900/90 p-3"
                  >
                    <div className="flex justify-between items-center border-b border-slate-800/80 pb-2 mb-2">
                      <span className="font-bold text-amber-400">
                        {
                          counter.counter_name
                        }
                      </span>

                      <span className="text-xs text-slate-400">
                        Đang chờ:{" "}
                        {list.length}
                      </span>
                    </div>

                    {list.length ===
                    0 ? (
                      <div className="text-xs text-slate-600 italic py-1">
                        Không có hàng chờ
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {list.map(
                          (item) => (
                            <div
                              key={
                                item.ticket_code
                              }
                              className="flex justify-between items-center bg-slate-950/60 p-2 rounded border border-slate-800/50 text-sm"
                            >
                              <div>
                                <span className="font-bold text-slate-200 mr-2">
                                  {
                                    item.queue_number
                                  }
                                </span>

                                <span className="text-slate-400 text-xs">
                                  {
                                    item.driver_name
                                  }
                                </span>
                              </div>

                              <span className="text-xs text-slate-500 font-mono">
                                {new Date(
                                  item.created_at
                                ).toLocaleTimeString(
                                  "vi-VN",
                                  {
                                    hour: "2-digit",
                                    minute:
                                      "2-digit",
                                  }
                                )}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
