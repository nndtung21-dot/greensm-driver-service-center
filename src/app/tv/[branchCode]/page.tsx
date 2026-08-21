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

function normalizeQueue(
  value: string | null | undefined
): string {
  return (value ?? "").trim().toUpperCase();
}

function isCalledQueue(
  queue: AgentQueueRow,
  counters: CounterStatusRow[]
): boolean {
  const queueNumber =
    normalizeQueue(queue.queue_number);

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
  B: "bê",
  C: "xê",
  D: "đê",
  E: "e",
  F: "ép",
  G: "gờ",
  H: "hát",
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

  if (n < 20) {
    return SMALL_NUMBER_WORDS[n] ?? "";
  }

  if (n < 100) {
    const tens =
      Math.floor(n / 10);

    const units =
      n % 10;

    let result =
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

    const hundredWord =
      DIGIT_WORD[
        String(hundreds)
      ];

    let result =
      `${hundredWord} trăm`;

    if (remainder === 0) {
      return result;
    }

    if (remainder < 10) {
      return (
        `${result} lẻ ` +
        `${DIGIT_WORD[
          String(remainder)
        ]}`
      );
    }

    return (
      `${result} ` +
      `${numberToVietnameseWords(
        remainder
      )}`
    );
  }

  /*
   * Queue/counter của hệ thống hiện tại
   * không cần đọc số > 999 theo kiểu
   * số tự nhiên.
   *
   * Fallback đọc từng ký tự.
   */
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

  /*
   * Quầy 04
   * Quầy số 04
   */
  const match =
    value.match(
      /(?:quầy\s*(?:số\s*)?)(\d+)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  /*
   * Chỉ là số
   */
  if (/^\d+$/.test(value)) {
    return value;
  }

  /*
   * Fallback:
   * lấy cụm số cuối
   */
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

/*
 * Queue là MÃ.
 *
 * A012
 * =>
 * "a không một hai"
 *
 * 012
 * =>
 * "không một hai"
 *
 * Không đọc 012 thành "mười hai".
 */

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
   SPEECH SYNTHESIS FALLBACK
   ============================================================ */

function speakWithBrowser(
  text: string
): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window)
  ) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>(
    (resolve) => {
      try {
        const synth =
          window.speechSynthesis;

        synth.cancel();

        const utterance =
          new SpeechSynthesisUtterance(
            text
          );

        utterance.lang = "vi-VN";
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        let finished = false;

        const finish = (
          value: boolean
        ) => {
          if (finished) {
            return;
          }

          finished = true;
          resolve(value);
        };

        utterance.onend = () =>
          finish(true);

        utterance.onerror = () =>
          finish(false);

        synth.speak(
          utterance
        );

        window.setTimeout(
          () => {
            if (!finished) {
              finish(true);
            }
          },
          Math.max(
            8000,
            text.length * 180
          )
        );
      } catch (error) {
        console.error(
          "[TV AUDIO] SPEECH FALLBACK ERROR:",
          error
        );

        resolve(false);
      }
    }
  );
}

/* ============================================================
   GOOGLE TTS AUDIO ENGINE
   ============================================================ */

function useGoogleTTS() {
  const audioRef =
    useRef<HTMLAudioElement | null>(
      null
    );

  const currentObjectUrlRef =
    useRef<string | null>(null);

  const queueRef =
    useRef<
      Array<{
        id: string;
        text: string;
        resolve: (
          success: boolean
        ) => void;
      }>
    >([]);

  const playingRef =
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
     GET AUDIO
     ========================================================== */

  const getAudio =
    useCallback(() => {
      if (
        typeof window ===
        "undefined"
      ) {
        throw new Error(
          "Audio chỉ chạy trên browser"
        );
      }

      if (!audioRef.current) {
        const audio =
          document.createElement(
            "audio"
          );

        audio.preload = "auto";
        audio.volume = 1;
        audio.setAttribute(
          "playsinline",
          ""
        );

        audio.style.display =
          "none";

        document.body.appendChild(
          audio
        );

        audioRef.current =
          audio;
      }

      return audioRef.current;
    }, []);

  /* ==========================================================
     REVOKE OBJECT URL
     ========================================================== */

  const cleanupObjectUrl =
    useCallback(() => {
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
     WAIT AUDIO READY
     ========================================================== */

  const waitForAudioReady =
    useCallback(
      (
        audio: HTMLAudioElement
      ): Promise<void> =>
        new Promise<void>(
          (
            resolve,
            reject
          ) => {
            if (
              audio.readyState >= 2
            ) {
              resolve();
              return;
            }

            let finished =
              false;

            const cleanup =
              () => {
                audio.oncanplay =
                  null;

                audio.onloadeddata =
                  null;

                audio.onerror =
                  null;
              };

            const success =
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
                    "Audio element không load được"
                  )
                );
              };

            audio.oncanplay =
              success;

            audio.onloadeddata =
              success;

            audio.onerror =
              fail;

            window.setTimeout(
              () => {
                if (
                  audio.readyState >= 2
                ) {
                  success();
                } else {
                  fail();
                }
              },
              7000
            );
          }
        ),
      []
    );

  /* ==========================================================
     PLAY AUDIO AND WAIT END
     ========================================================== */

  const playCurrentAudio =
    useCallback(
      (
        audio: HTMLAudioElement
      ): Promise<void> =>
        new Promise<void>(
          async (
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
              };

            const success =
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
                error: unknown
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
                        "Audio playback failed"
                      )
                );
              };

            /*
             * PHẢI gắn event trước play().
             *
             * Đây là lỗi quan trọng trong
             * code cũ.
             */
            audio.onended =
              success;

            audio.onerror =
              () =>
                fail(
                  new Error(
                    "HTMLAudioElement playback error"
                  )
                );

            try {
              await audio.play();
            } catch (error) {
              fail(error);
              return;
            }

            /*
             * Nếu audio cực ngắn hoặc browser
             * đã đánh dấu ended trước listener,
             * xử lý luôn.
             */
            if (audio.ended) {
              success();
              return;
            }

            /*
             * Không để queue treo vĩnh viễn.
             */
            window.setTimeout(
              () => {
                if (
                  audio.ended
                ) {
                  success();
                }
              },
              15000
            );
          }
        ),
      []
    );

  /* ==========================================================
     GOOGLE TTS REQUEST
     ========================================================== */

  const fetchGoogleTTS =
    useCallback(
      async (
        text: string
      ): Promise<Blob> => {
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
      },
      []
    );

  /* ==========================================================
     PLAY GOOGLE TTS
     ========================================================== */

  const playText =
    useCallback(
      async (
        text: string
      ): Promise<boolean> => {
        if (
          !unlockedRef.current
        ) {
          throw new Error(
            "Audio chưa được unlock"
          );
        }

        const audio =
          getAudio();

        console.log(
          "[TV AUDIO] FETCH:",
          text
        );

        try {
          const blob =
            await fetchGoogleTTS(
              text
            );

          cleanupObjectUrl();

          const url =
            URL.createObjectURL(
              blob
            );

          currentObjectUrlRef.current =
            url;

          audio.pause();

          try {
            audio.currentTime = 0;
          } catch {}

          audio.src = url;
          audio.volume = 1;
          audio.load();

          await waitForAudioReady(
            audio
          );

          console.log(
            "[TV AUDIO] PLAY:",
            text
          );

          await playCurrentAudio(
            audio
          );

          console.log(
            "[TV AUDIO] PLAY SUCCESS:",
            text
          );

          audio.pause();

          audio.removeAttribute(
            "src"
          );

          audio.load();

          cleanupObjectUrl();

          return true;
        } catch (error) {
          console.error(
            "[TV AUDIO] GOOGLE TTS PLAY FAILED:",
            error
          );

          try {
            audio.pause();
            audio.removeAttribute(
              "src"
            );
            audio.load();
          } catch {}

          cleanupObjectUrl();

          /*
           * Fallback:
           * nếu Chrome/Edge/TV chặn blob audio,
           * thử Web Speech.
           */
          console.warn(
            "[TV AUDIO] FALLBACK SPEECH SYNTHESIS"
          );

          const fallbackSuccess =
            await speakWithBrowser(
              text
            );

          if (
            fallbackSuccess
          ) {
            console.log(
              "[TV AUDIO] FALLBACK SUCCESS"
            );

            return true;
          }

          return false;
        }
      },
      [
        cleanupObjectUrl,
        fetchGoogleTTS,
        getAudio,
        playCurrentAudio,
        waitForAudioReady,
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

          let success =
            true;

          /*
           * Đọc 2 lần.
           */
          for (
            let repeat = 1;
            repeat <= 2;
            repeat++
          ) {
            console.log(
              `[TV AUDIO] REPEAT ${repeat}/2`,
              job.id
            );

            const played =
              await playText(
                job.text
              );

            if (!played) {
              success = false;

              console.error(
                `[TV AUDIO] REPEAT ${repeat}/2 FAILED`,
                job.id
              );

              /*
               * Không cố đọc lần 2 nếu
               * lần 1 đã fail.
               */
              break;
            }

            console.log(
              `[TV AUDIO] REPEAT ${repeat}/2 SUCCESS`,
              job.id
            );

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
           * Trả kết quả về cho enqueue().
           */
          job.resolve(success);

          /*
           * Khoảng cách giữa ticket.
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
        playingRef.current =
          false;

        console.log(
          "[TV AUDIO] ===== QUEUE END ====="
        );

        if (
          unlockedRef.current &&
          queueRef.current.length >
            0
        ) {
          void processQueue();
        }
      }
    }, [playText]);

  /* ==========================================================
     ENQUEUE
     ========================================================== */

  const enqueue =
    useCallback(
      (
        queueNumber: string,
        driverName: string,
        counterName: string
      ): Promise<boolean> => {
        const text =
          buildAnnouncementText(
            queueNumber,
            driverName,
            counterName
          );

        const id =
          `${counterName}-${queueNumber}-${Date.now()}-${Math.random()
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

        return new Promise<boolean>(
          (resolve) => {
            queueRef.current.push({
              id,
              text,
              resolve,
            });

            void processQueue();
          }
        );
      },
      [processQueue]
    );

  /* ==========================================================
     UNLOCK
     ========================================================== */

  const unlock =
    useCallback(async (): Promise<boolean> => {
      console.log(
        "[TV AUDIO] ===== UNLOCK START ====="
      );

      try {
        const audio =
          getAudio();

        /*
         * QUAN TRỌNG:
         *
         * play() được gọi ngay trong event
         * handler để browser cấp quyền.
         *
         * Không fetch Google TTS trước bước này.
         */
        audio.src =
          "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQQAAAAA";

        audio.volume = 0.01;
        audio.load();

        await audio.play();

        audio.pause();

        try {
          audio.currentTime = 0;
        } catch {}

        audio.removeAttribute(
          "src"
        );

        audio.load();

        /*
         * Từ đây coi browser audio đã được unlock.
         */
        unlockedRef.current =
          true;

        setUnlocked(true);

        setAudioStatus(
          "Đang kiểm tra Google TTS..."
        );

        console.log(
          "[TV AUDIO] BROWSER AUDIO UNLOCKED"
        );

        /*
         * Test Google TTS nhưng KHÔNG làm
         * trạng thái unlock thất bại nếu
         * Google TTS đang lỗi.
         */
        try {
          const testText =
            "Âm thanh thông báo đã được bật";

          const blob =
            await fetchGoogleTTS(
              testText
            );

          cleanupObjectUrl();

          const url =
            URL.createObjectURL(
              blob
            );

          currentObjectUrlRef.current =
            url;

          audio.src = url;
          audio.volume = 1;
          audio.load();

          await waitForAudioReady(
            audio
          );

          /*
           * onended đã được đăng ký trong
           * playCurrentAudio trước play().
           */
          await playCurrentAudio(
            audio
          );

          audio.pause();
          audio.removeAttribute(
            "src"
          );
          audio.load();

          cleanupObjectUrl();

          setAudioStatus(
            "Sẵn sàng gọi số"
          );

          console.log(
            "[TV AUDIO] GOOGLE TTS TEST SUCCESS"
          );
        } catch (ttsError) {
          console.error(
            "[TV AUDIO] GOOGLE TTS TEST FAILED:",
            ttsError
          );

          /*
           * Browser vẫn unlocked.
           * Không khóa audio chỉ vì test API lỗi.
           */
          setAudioStatus(
            "Đã bật âm thanh — Google TTS đang lỗi"
          );
        }

        void processQueue();

        console.log(
          "[TV AUDIO] ===== UNLOCK COMPLETE ====="
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
          "Không bật được âm thanh"
        );

        return false;
      }
    }, [
      cleanupObjectUrl,
      fetchGoogleTTS,
      getAudio,
      playCurrentAudio,
      processQueue,
      waitForAudioReady,
    ]);

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

        audio.remove();
      }

      cleanupObjectUrl();

      if (
        "speechSynthesis" in
        window
      ) {
        window.speechSynthesis.cancel();
      }
    };
  }, [cleanupObjectUrl]);

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
     ANNOUNCEMENT STATE
     ========================================================== */

  /*
   * Đã đọc thành công.
   *
   * Chỉ add vào đây SAU KHI audio
   * thực sự phát xong.
   */
  const announcedCalls =
    useRef<Set<string>>(
      new Set()
    );

  /*
   * Đang xử lý.
   *
   * Chống realtime + watchdog enqueue
   * cùng một ticket.
   */
  const announcingCalls =
    useRef<Set<string>>(
      new Set()
    );

  /* ==========================================================
     REFRESH
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
  } = useGoogleTTS();

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
      async (): Promise<
        CounterStatusRow[]
      > => {
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
      },
      [branchCode]
    );

  /* ==========================================================
     LOAD QUEUE
     ========================================================== */

  const loadAgentQueue =
    useCallback(
      async (): Promise<
        AgentQueueRow[]
      > => {
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

        console.log(
          "[TV AUDIO] ACTIVE CALLS:",
          activeCalls.map(
            (x) => ({
              counter:
                x.counter_code,
              queue:
                x.queue_number,
              calledAt:
                x.called_at,
            })
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
           * callKey phải đại diện cho
           * một lần gọi cụ thể.
           */
          const callKey =
            `${call.counter_code}:${call.queue_number}:${call.called_at}`;

          /*
           * Đã đọc thành công -> bỏ qua.
           */
          if (
            announcedCalls.current.has(
              callKey
            )
          ) {
            continue;
          }

          /*
           * Đang đọc -> bỏ qua.
           */
          if (
            announcingCalls.current.has(
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
           * Tìm đúng ticket.
           */
          const driver =
            queueList.find(
              (q) =>
                normalizeQueue(
                  q.queue_number
                ) ===
                targetQueue
            );

          if (!driver) {
            /*
             * CỰC KỲ QUAN TRỌNG:
             *
             * Không add announcedCalls.
             *
             * Watchdog 5s sẽ tìm lại.
             */
            console.warn(
              "[TV AUDIO] DRIVER NOT FOUND — WILL RETRY:",
              {
                queue:
                  call.queue_number,
                queueList:
                  queueList.length,
                callKey,
              }
            );

            continue;
          }

          const driverName =
            cleanDriverName(
              driver.driver_name ?? ""
            );

          if (!driverName) {
            console.warn(
              "[TV AUDIO] DRIVER NAME EMPTY — WILL RETRY:",
              call.queue_number
            );

            continue;
          }

          const counterName =
            call.counter_name?.trim() ||
            call.counter_code?.trim() ||
            "quầy";

          const announcement =
            buildAnnouncementText(
              call.queue_number,
              driverName,
              counterName
            );

          console.log(
            "[TV AUDIO] ===== NEW CALL =====",
            {
              callKey,
              queueNumber:
                call.queue_number,
              driverName,
              counterCode:
                call.counter_code,
              counterName,
              calledAt:
                call.called_at,
              announcement,
            }
          );

          /*
           * Đánh dấu đang xử lý.
           */
          announcingCalls.current.add(
            callKey
          );

          /*
           * Không await trực tiếp trong for loop.
           */
          void enqueueAudio(
            call.queue_number,
            driverName,
            counterName
          )
            .then(
              (
                success
              ) => {
                if (success) {
                  /*
                   * CHỈ lúc này mới
                   * đánh dấu đã đọc.
                   */
                  announcedCalls.current.add(
                    callKey
                  );

                  console.log(
                    "[TV AUDIO] CALL ANNOUNCED SUCCESS:",
                    callKey
                  );
                } else {
                  console.error(
                    "[TV AUDIO] CALL ANNOUNCEMENT FAILED — WILL RETRY:",
                    callKey
                  );
                }
              }
            )
            .catch(
              (error) => {
                console.error(
                  "[TV AUDIO] CALL QUEUE ERROR:",
                  callKey,
                  error
                );
              }
            )
            .finally(
              () => {
                announcingCalls.current.delete(
                  callKey
                );
              }
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

        if (
          announcingCalls.current
            .size > 100
        ) {
          const values =
            Array.from(
              announcingCalls.current
            );

          announcingCalls.current =
            new Set(
              values.slice(-50)
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
          (payload) => {
            console.log(
              "[TV REALTIME] queue_tickets:",
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
              "[TV REALTIME] service_cases:",
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
              "[TV REALTIME] counters:",
              payload
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
     * Đây là safety net nếu realtime
     * bị miss.
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

      {/* ======================================================
          AUDIO
          ====================================================== */}

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
