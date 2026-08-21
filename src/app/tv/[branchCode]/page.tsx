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

function normalizeQueue(
  value: string | null | undefined
): string {
  return (value ?? "").trim().toUpperCase();
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
): boolean {
  const queueNumber = normalizeQueue(
    queue.queue_number
  );

  if (!queueNumber) {
    return false;
  }

  return counters.some(
    (counter) =>
      normalizeQueue(
        counter.queue_number
      ) === queueNumber &&
      Boolean(counter.called_at)
  );
}

/* ============================================================
   VIETNAMESE NUMBER / CHARACTER WORDS
   ============================================================ */

const DIGIT_WORD: Record<
  string,
  string
> = {
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

/* ============================================================
   VIETNAMESE NUMBER TO WORD
   ============================================================ */

function numberToVietnameseWords(
  n: number
): string {
  if (
    !Number.isFinite(n) ||
    n < 0
  ) {
    return "";
  }

  n = Math.floor(n);

  if (n < 20) {
    return SMALL_NUMBER_WORDS[n] ?? "";
  }

  if (n < 100) {
    const tens = Math.floor(n / 10);
    const units = n % 10;

    const result =
      `${DIGIT_WORD[String(tens)]} mươi`;

    if (units === 0) {
      return result;
    }

    if (units === 1) {
      return `${result} mốt`;
    }

    if (units === 4) {
      return `${result} tư`;
    }

    if (units === 5) {
      return `${result} lăm`;
    }

    return (
      `${result} ` +
      `${DIGIT_WORD[String(units)]}`
    );
  }

  if (n < 1000) {
    const hundreds =
      Math.floor(n / 100);

    const remainder =
      n % 100;

    const result =
      `${DIGIT_WORD[String(hundreds)]} trăm`;

    if (remainder === 0) {
      return result;
    }

    if (remainder < 10) {
      return (
        `${result} lẻ ` +
        `${DIGIT_WORD[String(remainder)]}`
      );
    }

    return (
      `${result} ` +
      `${numberToVietnameseWords(
        remainder
      )}`
    );
  }

  return String(n)
    .split("")
    .map(
      (ch) =>
        DIGIT_WORD[ch] ?? ch
    )
    .join(" ");
}

/* ============================================================
   COUNTER NUMBER
   ============================================================ */

function extractCounterNumber(
  counterName: string
): string {
  const value =
    counterName.trim();

  const match =
    value.match(
      /(?:quầy\s*(?:số\s*)?)(\d+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  if (/^\d+$/.test(value)) {
    return value;
  }

  const fallback =
    value.match(/(\d+)\s*$/);

  if (fallback?.[1]) {
    return fallback[1];
  }

  return value;
}

function counterNumberToWords(
  counterName: string
): string {
  const number =
    extractCounterNumber(
      counterName
    );

  const numeric =
    Number(number);

  if (
    Number.isFinite(numeric) &&
    numeric >= 0 &&
    numeric < 1000
  ) {
    return numberToVietnameseWords(
      numeric
    );
  }

  return [...number]
    .map(
      (ch) =>
        DIGIT_WORD[
          ch.toUpperCase()
        ] ?? ch
    )
    .join(" ");
}

/* ============================================================
   QUEUE NUMBER
   ============================================================ */

function queueNumberToWords(
  queueNumber: string
): string {
  return [...queueNumber.trim().toUpperCase()]
    .map(
      (ch) =>
        DIGIT_WORD[ch] ?? ch
    )
    .join(" ");
}

/* ============================================================
   DRIVER NAME
   ============================================================ */

function cleanDriverName(
  driverName: string
): string {
  return driverName
    .trim()
    .replace(/\s+/g, " ");
}

/* ============================================================
   ANNOUNCEMENT TEXT
   ============================================================ */

function buildAnnouncementText(
  queueNumber: string,
  driverName: string,
  counterName: string
): string {
  const queueWords =
    queueNumberToWords(
      queueNumber
    );

  const counterWords =
    counterNumberToWords(
      counterName
    );

  const cleanName =
    cleanDriverName(
      driverName
    );

  return (
    `Kính mời tài xế số ${queueWords}, ` +
    `${cleanName}, ` +
    `vui lòng đến quầy số ${counterWords}.`
  );
}

/* ============================================================
   TV SPEECH ENGINE
   ============================================================ */

function useTvSpeech() {
  const queueRef =
    useRef<SpeechJob[]>([]);

  const speakingRef =
    useRef(false);

  const unlockedRef =
    useRef(false);

  const [unlocked, setUnlocked] =
    useState(false);

  const [audioStatus, setAudioStatus] =
    useState(
      "Chưa bật âm thanh"
    );

  /* ==========================================================
     GET VIETNAMESE VOICE
     ========================================================== */

  const getVietnameseVoice =
    useCallback(() => {
      if (
        typeof window ===
        "undefined"
      ) {
        return null;
      }

      if (
        !("speechSynthesis" in window)
      ) {
        return null;
      }

      const voices =
        window.speechSynthesis.getVoices();

      if (!voices.length) {
        return null;
      }

      /*
       * CHỈ CHẤP NHẬN GIỌNG TIẾNG VIỆT.
       *
       * Ưu tiên:
       * 1. vi-VN
       * 2. các voice bắt đầu bằng vi-
       *
       * TUYỆT ĐỐI KHÔNG fallback sang
       * English/default voice.
       */

      const exact =
        voices.find(
          (voice) =>
            voice.lang
              .trim()
              .toLowerCase() ===
            "vi-vn"
        );

      if (exact) {
        return exact;
      }

      const vietnamese =
        voices.find(
          (voice) =>
            voice.lang
              .trim()
              .toLowerCase()
              .startsWith("vi-")
        );

      return vietnamese ?? null;
    }, []);

  /* ==========================================================
     GET ALL VIETNAMESE VOICES
     ========================================================== */

  const getVietnameseVoices =
    useCallback(() => {
      if (
        typeof window ===
        "undefined" ||
        !(
          "speechSynthesis" in
          window
        )
      ) {
        return [];
      }

      return window.speechSynthesis
        .getVoices()
        .filter(
          (voice) =>
            voice.lang
              .trim()
              .toLowerCase()
              .startsWith("vi-")
        );
    }, []);

  /* ==========================================================
     SPEAK ONE TEXT
     ========================================================== */

  const speak =
    useCallback(
      (
        text: string
      ): Promise<void> => {
        return new Promise(
          (
            resolve,
            reject
          ) => {
            if (
              typeof window ===
              "undefined"
            ) {
              reject(
                new Error(
                  "Speech chỉ chạy trên browser"
                )
              );

              return;
            }

            if (
              !(
                "speechSynthesis" in
                window
              )
            ) {
              reject(
                new Error(
                  "Trình duyệt không hỗ trợ Speech Synthesis"
                )
              );

              return;
            }

            const synthesis =
              window.speechSynthesis;

            /*
             * KHÔNG BAO GIỜ dùng default voice.
             */
            const voice =
              getVietnameseVoice();

            if (!voice) {
              reject(
                new Error(
                  "Không tìm thấy giọng tiếng Việt (vi-VN) trên thiết bị"
                )
              );

              return;
            }

            /*
             * Xoá speech cũ trước khi đọc.
             */
            synthesis.cancel();

            const utterance =
              new SpeechSynthesisUtterance(
                text
              );

            /*
             * Bắt buộc tiếng Việt.
             */
            utterance.lang =
              "vi-VN";

            utterance.voice =
              voice;

            utterance.rate =
              0.9;

            utterance.pitch =
              1;

            utterance.volume =
              1;

            let finished =
              false;

            const cleanup =
              () => {
                /*
                 * Không dùng .oncancel = null
                 * vì lib.dom của TypeScript
                 * không expose property này.
                 */
                utterance.onend =
                  null;

                utterance.onerror =
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
              (
                event: SpeechSynthesisErrorEvent
              ) => {
                if (finished) {
                  return;
                }

                finished = true;

                cleanup();

                reject(
                  new Error(
                    `Speech synthesis failed: ${event.error}`
                  )
                );
              };

            utterance.onend =
              finish;

            utterance.onerror =
              fail;

            /*
             * TypeScript không expose
             * `utterance.oncancel`.
             *
             * Dùng event listener.
             */
            utterance.addEventListener(
              "cancel",
              finish
            );

            console.log(
              "[TV AUDIO] SPEAK:",
              {
                text,
                voice:
                  voice.name,
                lang:
                  voice.lang,
              }
            );

            synthesis.speak(
              utterance
            );
          }
        );
      },
      [getVietnameseVoice]
    );

  /* ==========================================================
     UNLOCK
     ========================================================== */

  const unlock =
    useCallback(async () => {
      console.log(
        "[TV AUDIO] ===== UNLOCK START ====="
      );

      try {
        if (
          typeof window ===
          "undefined"
        ) {
          throw new Error(
            "Audio chỉ chạy trên browser"
          );
        }

        if (
          !(
            "speechSynthesis" in
            window
          )
        ) {
          throw new Error(
            "Browser không hỗ trợ Speech Synthesis"
          );
        }

        const synthesis =
          window.speechSynthesis;

        /*
         * Xoá speech đang chạy.
         */
        synthesis.cancel();

        /*
         * Log toàn bộ voice.
         */
        const voices =
          synthesis.getVoices();

        console.log(
          "[TV AUDIO] AVAILABLE VOICES:",
          voices.map(
            (voice) => ({
              name: voice.name,
              lang: voice.lang,
              default:
                voice.default,
              isVietnamese:
                voice.lang
                  .toLowerCase()
                  .startsWith(
                    "vi-"
                  ),
            })
          )
        );

        /*
         * Chỉ lấy voice Việt.
         */
        const vietnameseVoices =
          getVietnameseVoices();

        console.log(
          "[TV AUDIO] VIETNAMESE VOICES:",
          vietnameseVoices.map(
            (voice) => ({
              name: voice.name,
              lang: voice.lang,
              default:
                voice.default,
            })
          )
        );

        const vietnameseVoice =
          getVietnameseVoice();

        console.log(
          "[TV AUDIO] SELECTED VIETNAMESE VOICE:",
          vietnameseVoice
            ? {
                name:
                  vietnameseVoice.name,
                lang:
                  vietnameseVoice.lang,
              }
            : null
        );

        /*
         * KHÔNG CÓ VOICE VIỆT:
         *
         * Dừng ngay.
         *
         * Không cho browser tự chọn
         * English/default voice.
         */
        if (!vietnameseVoice) {
          unlockedRef.current =
            false;

          setUnlocked(false);

          setAudioStatus(
            "TV chưa có giọng tiếng Việt"
          );

          console.error(
            "[TV AUDIO] NO VIETNAMESE VOICE"
          );

          return false;
        }

        /*
         * Test speech.
         *
         * Voice được chỉ định trực tiếp.
         */
        const test =
          new SpeechSynthesisUtterance(
            "Âm thanh thông báo đã được bật"
          );

        test.lang =
          "vi-VN";

        test.voice =
          vietnameseVoice;

        test.rate =
          0.9;

        test.pitch =
          1;

        test.volume =
          1;

        await new Promise<void>(
          (
            resolve,
            reject
          ) => {
            let finished =
              false;

            const cleanup =
              () => {
                test.onend =
                  null;

                test.onerror =
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
              (
                event: SpeechSynthesisErrorEvent
              ) => {
                if (finished) {
                  return;
                }

                finished = true;

                cleanup();

                reject(
                  new Error(
                    `Không phát được âm thanh: ${event.error}`
                  )
                );
              };

            test.onend =
              finish;

            test.onerror =
              fail;

            test.addEventListener(
              "cancel",
              finish
            );

            console.log(
              "[TV AUDIO] TEST SPEAK:",
              {
                text:
                  "Âm thanh thông báo đã được bật",
                voice:
                  vietnameseVoice.name,
                lang:
                  vietnameseVoice.lang,
              }
            );

            synthesis.speak(
              test
            );
          }
        );

        /*
         * Chỉ unlock sau khi test thành công.
         */
        unlockedRef.current =
          true;

        setUnlocked(true);

        setAudioStatus(
          `Sẵn sàng gọi số — ${vietnameseVoice.name}`
        );

        console.log(
          "[TV AUDIO] ===== UNLOCK SUCCESS ====="
        );

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
          error instanceof Error
            ? error.message
            : "Không bật được âm thanh"
        );

        return false;
      }
    }, [
      getVietnameseVoice,
      getVietnameseVoices,
    ]);

  /* ==========================================================
     PROCESS QUEUE
     ========================================================== */

  const processQueue =
    useCallback(async () => {
      if (
        speakingRef.current
      ) {
        return;
      }

      if (
        !unlockedRef.current
      ) {
        return;
      }

      if (
        queueRef.current.length ===
        0
      ) {
        return;
      }

      speakingRef.current =
        true;

      console.log(
        "[TV AUDIO] ===== QUEUE START ====="
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

          /*
           * ĐỌC 2 LẦN.
           */
          for (
            let repeat = 1;
            repeat <= 2;
            repeat++
          ) {
            if (
              !unlockedRef.current
            ) {
              break;
            }

            try {
              console.log(
                `[TV AUDIO] REPEAT ${repeat}/2:`,
                job.id
              );

              await speak(
                job.text
              );

              console.log(
                `[TV AUDIO] REPEAT ${repeat}/2 SUCCESS:`,
                job.id
              );
            } catch (error) {
              console.error(
                `[TV AUDIO] REPEAT ${repeat}/2 FAILED:`,
                job.id,
                error
              );
            }

            if (
              repeat === 1
            ) {
              await new Promise<void>(
                (resolve) =>
                  window.setTimeout(
                    resolve,
                    900
                  )
              );
            }
          }

          /*
           * Khoảng cách giữa 2 ticket.
           */
          await new Promise<void>(
            (resolve) =>
              window.setTimeout(
                resolve,
                700
              )
          );
        }
      } finally {
        speakingRef.current =
          false;

        console.log(
          "[TV AUDIO] ===== QUEUE END ====="
        );

        if (
          unlockedRef.current &&
          queueRef.current.length >
            0
        ) {
          window.setTimeout(
            () => {
              void processQueue();
            },
            100
          );
        }
      }
    }, [speak]);

  /* ==========================================================
     ENQUEUE
     ========================================================== */

  const enqueue =
    useCallback(
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

        const id =
          `${counterName}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        console.log(
          "[TV AUDIO] ENQUEUE:",
          {
            id,
            queueNumber,
            driverName,
            counterName,
            text,
          }
        );

        queueRef.current.push({
          id,
          text,
        });

        if (
          unlockedRef.current
        ) {
          void processQueue();
        }
      },
      [processQueue]
    );

  /* ==========================================================
     PROCESS AFTER UNLOCK
     ========================================================== */

  useEffect(() => {
    if (unlocked) {
      void processQueue();
    }
  }, [
    unlocked,
    processQueue,
  ]);

  /* ==========================================================
     LOAD BROWSER VOICES
     ========================================================== */

  useEffect(() => {
    if (
      typeof window ===
        "undefined" ||
      !(
        "speechSynthesis" in
        window
      )
    ) {
      return;
    }

    const synthesis =
      window.speechSynthesis;

    const handleVoicesChanged =
      () => {
        const voices =
          synthesis.getVoices();

        const vietnamese =
          voices.filter(
            (voice) =>
              voice.lang
                .toLowerCase()
                .startsWith("vi-")
          );

        console.log(
          "[TV AUDIO] VOICES LOADED:",
          voices.map(
            (voice) =>
              `${voice.name} (${voice.lang})`
          )
        );

        console.log(
          "[TV AUDIO] VIETNAMESE VOICES:",
          vietnamese.map(
            (voice) =>
              `${voice.name} (${voice.lang})`
          )
        );

        if (
          !unlockedRef.current
        ) {
          if (
            vietnamese.length >
            0
          ) {
            setAudioStatus(
              `Đã tìm thấy giọng Việt: ${vietnamese[0].name}`
            );
          } else {
            setAudioStatus(
              "TV chưa có giọng tiếng Việt"
            );
          }
        }
      };

    synthesis.addEventListener(
      "voiceschanged",
      handleVoicesChanged
    );

    handleVoicesChanged();

    return () => {
      synthesis.removeEventListener(
        "voiceschanged",
        handleVoicesChanged
      );
    };
  }, []);

  /* ==========================================================
     CLEANUP
     ========================================================== */

  useEffect(() => {
    return () => {
      if (
        typeof window !==
          "undefined" &&
        "speechSynthesis" in
          window
      ) {
        window.speechSynthesis.cancel();
      }

      queueRef.current = [];

      speakingRef.current =
        false;

      unlockedRef.current =
        false;
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

  const [counters, setCounters] =
    useState<
      CounterStatusRow[]
    >([]);

  const [agentQueue, setAgentQueue] =
    useState<
      AgentQueueRow[]
    >([]);

  const [loading, setLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(
      null
    );

  /* ==========================================================
     ANNOUNCED CALLS
     ========================================================== */

  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  /* ==========================================================
     REFRESH TIMER
     ========================================================== */

  const refreshTimer =
    useRef<number | null>(
      null
    );

  const loadingRef =
    useRef(false);

  /* ==========================================================
     AUDIO
     ========================================================== */

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
    audioStatus,
  } = useTvSpeech();

  /* ==========================================================
     CLOCK
     ========================================================== */

  const clock =
    useClock();

  /* ==========================================================
     LOAD COUNTERS
     ========================================================== */

  const loadCounters =
    useCallback(
      async () => {
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
      },
      [branchCode]
    );

  /* ==========================================================
     LOAD QUEUE
     ========================================================== */

  const loadAgentQueue =
    useCallback(
      async () => {
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
      },
      [branchCode]
    );

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

          const targetQueue =
            normalizeQueue(
              call.queue_number
            );

          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) ===
                targetQueue
            );

          if (!driver) {
            console.warn(
              "[TV] DRIVER NOT FOUND:",
              {
                queue:
                  call.queue_number,
                queueList:
                  queueList.length,
                counter:
                  call.counter_code,
              }
            );

            continue;
          }

          const driverName =
            driver.driver_name?.trim();

          if (!driverName) {
            console.warn(
              "[TV] DRIVER NAME EMPTY:",
              call.queue_number
            );

            continue;
          }

          const counterName =
            call.counter_name?.trim() ||
            call.counter_code?.trim() ||
            "quầy";

          console.log(
            "[TV] ===== NEW CALL =====",
            {
              queueNumber:
                call.queue_number,
              driverName,
              counterCode:
                call.counter_code,
              counterName,
              calledAt:
                call.called_at,
            }
          );

          announcedCalls.current.add(
            callKey
          );

          enqueueAudio(
            call.queue_number,
            driverName,
            counterName
          );
        }

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
      },
      [
        loadCounters,
        loadAgentQueue,
        handleCalls,
      ]
    );

  /* ==========================================================
     SCHEDULE REFRESH
     ========================================================== */

  const scheduleRefresh =
    useCallback(() => {
      if (
        refreshTimer.current !==
        null
      ) {
        window.clearTimeout(
          refreshTimer.current
        );

        refreshTimer.current =
          null;
      }

      refreshTimer.current =
        window.setTimeout(
          () => {
            refreshTimer.current =
              null;

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

    const watchdog =
      window.setInterval(
        () => {
          void refresh();
        },
        5000
      );

    return () => {
      if (
        refreshTimer.current !==
        null
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
          (q) =>
            !q.agent_id
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

      {/* AUDIO */}

      {!unlocked && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio();
          }}
          className="w-full bg-warn px-4 py-3 text-center font-body font-bold text-white hover:bg-warn/90"
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

      {/* HEADER */}

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

      {/* ERROR */}

      {errorMessage && (
        <div className="mx-[2.2vw] mt-[1vw] rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
          Không tải được dữ liệu:
          {" "}
          {errorMessage}
        </div>
      )}

      {/* CONTENT */}

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
            {/* COUNTERS */}

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

            {/* UNASSIGNED */}

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
