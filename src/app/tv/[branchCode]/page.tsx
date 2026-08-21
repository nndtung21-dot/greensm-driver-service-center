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

type AudioJob = {
  id: string;
  queueNumber: string;
  driverName: string;
  counterName: string;
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
  G: "g",
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
    n < 0 ||
    !Number.isInteger(n)
  ) {
    return "";
  }

  if (n < 20) {
    return (
      SMALL_NUMBER_WORDS[n] ?? ""
    );
  }

  if (n < 100) {
    const tens = Math.floor(n / 10);
    const units = n % 10;

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

    let result =
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
    Number.isInteger(numeric) &&
    numeric >= 0 &&
    numeric < 1000
  ) {
    return numberToVietnameseWords(
      numeric
    );
  }

  /*
   * Fallback nếu không phải số.
   */
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
   VALID SILENT WAV
   ============================================================ */

/*
 * Không dùng data URI WAV hard-code nữa.
 *
 * WAV cũ trong code trước:
 *
 *   UklGRigAAABXQVZF...
 *
 * bị sai kích thước RIFF/data so với số byte thực tế.
 *
 * Tạo WAV hợp lệ trực tiếp bằng ArrayBuffer.
 */

function createSilentWavBlob(
  durationMs = 100
): Blob {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;

  const sampleCount =
    Math.max(
      1,
      Math.floor(
        sampleRate *
          (durationMs / 1000)
      )
    );

  const bytesPerSample =
    bitsPerSample / 8;

  const dataSize =
    sampleCount *
    channels *
    bytesPerSample;

  const buffer =
    new ArrayBuffer(
      44 + dataSize
    );

  const view =
    new DataView(buffer);

  let offset = 0;

  const writeString =
    (value: string) => {
      for (
        let i = 0;
        i < value.length;
        i++
      ) {
        view.setUint8(
          offset++,
          value.charCodeAt(i)
        );
      }
    };

  writeString("RIFF");

  view.setUint32(
    offset,
    36 + dataSize,
    true
  );

  offset += 4;

  writeString("WAVE");
  writeString("fmt ");

  view.setUint32(
    offset,
    16,
    true
  );

  offset += 4;

  view.setUint16(
    offset,
    1,
    true
  );

  offset += 2;

  view.setUint16(
    offset,
    channels,
    true
  );

  offset += 2;

  view.setUint32(
    offset,
    sampleRate,
    true
  );

  offset += 4;

  view.setUint32(
    offset,
    sampleRate *
      channels *
      bytesPerSample,
    true
  );

  offset += 4;

  view.setUint16(
    offset,
    channels *
      bytesPerSample,
    true
  );

  offset += 2;

  view.setUint16(
    offset,
    bitsPerSample,
    true
  );

  offset += 2;

  writeString("data");

  view.setUint32(
    offset,
    dataSize,
    true
  );

  offset += 4;

  /*
   * Silence = toàn bộ sample = 0.
   */
  for (
    let i = 0;
    i < dataSize;
    i++
  ) {
    view.setUint8(
      offset + i,
      0
    );
  }

  return new Blob(
    [buffer],
    {
      type: "audio/wav",
    }
  );
}

/* ============================================================
   AUDIO WAIT HELPERS
   ============================================================ */

function waitForAudioCanPlay(
  audio: HTMLAudioElement,
  timeoutMs = 8000
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      let finished = false;

      const cleanup = () => {
        audio.oncanplay = null;
        audio.oncanplaythrough = null;
        audio.onerror = null;
      };

      const finish = () => {
        if (finished) {
          return;
        }

        finished = true;
        cleanup();
        resolve();
      };

      const fail = () => {
        if (finished) {
          return;
        }

        finished = true;
        cleanup();

        reject(
          new Error(
            "Audio element không load được file TTS"
          )
        );
      };

      audio.oncanplay = finish;
      audio.oncanplaythrough = finish;
      audio.onerror = fail;

      if (
        audio.readyState >=
        HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        finish();
        return;
      }

      window.setTimeout(
        () => {
          if (finished) {
            return;
          }

          if (
            audio.readyState >=
            HTMLMediaElement.HAVE_FUTURE_DATA
          ) {
            finish();
          } else {
            fail();
          }
        },
        timeoutMs
      );
    }
  );
}

function waitForAudioEnded(
  audio: HTMLAudioElement,
  timeoutMs = 30000
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      let finished = false;

      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
      };

      const finish = () => {
        if (finished) {
          return;
        }

        finished = true;
        cleanup();
        resolve();
      };

      const fail = () => {
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

      /*
       * QUAN TRỌNG:
       *
       * Gắn handler TRƯỚC audio.play().
       *
       * Không gắn sau play() như code cũ.
       */
      audio.onended = finish;
      audio.onerror = fail;

      if (audio.ended) {
        finish();
        return;
      }

      window.setTimeout(
        () => {
          if (finished) {
            return;
          }

          fail();
        },
        timeoutMs
      );
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

  const audioContextRef =
    useRef<AudioContext | null>(
      null
    );

  const currentObjectUrlRef =
    useRef<string | null>(null);

  const queueRef =
    useRef<AudioJob[]>([]);

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
        audio.autoplay = false;

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
     GET AUDIO CONTEXT
     ========================================================== */

  const getAudioContext =
    useCallback(() => {
      if (
        typeof window ===
        "undefined"
      ) {
        return null;
      }

      if (
        audioContextRef.current
      ) {
        return audioContextRef.current;
      }

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextClass) {
        return null;
      }

      const context =
        new AudioContextClass();

      audioContextRef.current =
        context;

      return context;
    }, []);

  /* ==========================================================
     RELEASE OBJECT URL
     ========================================================== */

  const releaseObjectUrl =
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
     RESET AUDIO ELEMENT
     ========================================================== */

  const resetAudio =
    useCallback(() => {
      const audio =
        audioRef.current;

      if (!audio) {
        return;
      }

      try {
        audio.pause();
      } catch {}

      audio.onended = null;
      audio.onerror = null;
      audio.oncanplay = null;
      audio.oncanplaythrough = null;

      try {
        audio.removeAttribute(
          "src"
        );

        audio.load();
      } catch {}
    }, []);

  /* ==========================================================
     UNLOCK BROWSER AUDIO
     ========================================================== */

  const unlock =
    useCallback(async () => {
      console.log(
        "[TV AUDIO] ===== BROWSER UNLOCK START ====="
      );

      setAudioStatus(
        "Đang bật âm thanh..."
      );

      try {
        const audio =
          getAudio();

        /*
         * ------------------------------------------------------
         * 1. UNLOCK WEB AUDIO
         * ------------------------------------------------------
         *
         * Phải thực hiện trong user gesture.
         */

        const context =
          getAudioContext();

        if (context) {
          if (
            context.state ===
            "suspended"
          ) {
            await context.resume();
          }

          /*
           * Tạo một source cực ngắn.
           *
           * Mục đích không phải phát tiếng,
           * mà đảm bảo AudioContext đã được activate.
           */
          const buffer =
            context.createBuffer(
              1,
              1,
              context.sampleRate
            );

          const source =
            context.createBufferSource();

          const gain =
            context.createGain();

          gain.gain.value = 0;

          source.buffer =
            buffer;

          source.connect(
            gain
          );

          gain.connect(
            context.destination
          );

          source.start(0);
        }

        /*
         * ------------------------------------------------------
         * 2. UNLOCK HTML AUDIO
         * ------------------------------------------------------
         *
         * Dùng WAV hợp lệ tạo bằng code.
         *
         * Không dùng data URI WAV cũ.
         */

        const silentBlob =
          createSilentWavBlob(
            100
          );

        const silentUrl =
          URL.createObjectURL(
            silentBlob
          );

        try {
          audio.pause();

          audio.volume = 0.01;

          audio.src =
            silentUrl;

          audio.load();

          await waitForAudioCanPlay(
            audio,
            5000
          );

          /*
           * Đây là play() nằm trực tiếp
           * trong chuỗi user click.
           */
          await audio.play();

          audio.pause();

          try {
            audio.currentTime = 0;
          } catch {}
        } finally {
          URL.revokeObjectURL(
            silentUrl
          );

          resetAudio();
        }

        /*
         * ------------------------------------------------------
         * 3. CHỈ SAU KHI BROWSER UNLOCK THÀNH CÔNG
         *    mới set unlocked = true.
         *
         * KHÔNG gọi /api/tts ở đây.
         *
         * Vì nếu Google TTS lỗi thì browser audio
         * vẫn đã unlock thành công.
         * ------------------------------------------------------
         */

        unlockedRef.current =
          true;

        setUnlocked(true);

        setAudioStatus(
          "Âm thanh đã bật — sẵn sàng gọi số"
        );

        console.log(
          "[TV AUDIO] ===== BROWSER UNLOCK SUCCESS ====="
        );

        /*
         * Nếu queue đã có ticket từ trước,
         * bắt đầu xử lý ngay.
         */
        window.setTimeout(
          () => {
            void processQueue();
          },
          0
        );

        return true;
      } catch (error) {
        console.error(
          "[TV AUDIO] ===== BROWSER UNLOCK FAILED =====",
          error
        );

        unlockedRef.current =
          false;

        setUnlocked(false);

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setAudioStatus(
          `Không bật được âm thanh: ${message}`
        );

        return false;
      }
    }, [
      getAudio,
      getAudioContext,
      resetAudio,
    ]);

  /* ==========================================================
     PLAY GOOGLE TTS
     ========================================================== */

  const playText =
    useCallback(
      async (
        text: string
      ) => {
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
          "[TV AUDIO] FETCH GOOGLE TTS:",
          text
        );

        setAudioStatus(
          "Đang phát thông báo..."
        );

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
          "[TV AUDIO] GOOGLE TTS RESPONSE:",
          response.status,
          response.headers.get(
            "content-type"
          )
        );

        if (!response.ok) {
          let serverMessage =
            "";

          try {
            serverMessage =
              await response.text();
          } catch {}

          throw new Error(
            `Google TTS HTTP ${response.status}${
              serverMessage
                ? `: ${serverMessage.slice(
                    0,
                    200
                  )}`
                : ""
            }`
          );
        }

        const blob =
          await response.blob();

        console.log(
          "[TV AUDIO] GOOGLE TTS BLOB:",
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

        /*
         * Nếu API trả JSON thay vì audio,
         * báo lỗi rõ ràng thay vì cố phát.
         */
        const contentType =
          response.headers.get(
            "content-type"
          ) ??
          blob.type ??
          "";

        if (
          contentType.includes(
            "application/json"
          ) ||
          contentType.includes(
            "text/html"
          )
        ) {
          let body = "";

          try {
            body =
              await blob.text();
          } catch {}

          throw new Error(
            `API TTS không trả audio: ${body.slice(
              0,
              200
            )}`
          );
        }

        const url =
          URL.createObjectURL(
            blob
          );

        /*
         * Release URL cũ.
         */
        releaseObjectUrl();

        currentObjectUrlRef.current =
          url;

        /*
         * Reset audio trước khi
         * nạp file mới.
         */
        try {
          audio.pause();
        } catch {}

        audio.onended = null;
        audio.onerror = null;
        audio.oncanplay = null;
        audio.oncanplaythrough =
          null;

        try {
          audio.currentTime = 0;
        } catch {}

        audio.src = url;
        audio.volume = 1;
        audio.autoplay = false;

        audio.load();

        /*
         * Chờ audio load xong.
         */
        await waitForAudioCanPlay(
          audio,
          8000
        );

        /*
         * ------------------------------------------------------
         * QUAN TRỌNG:
         *
         * Đăng ký onended/onerror TRƯỚC play().
         * ------------------------------------------------------
         */
        const endedPromise =
          waitForAudioEnded(
            audio,
            30000
          );

        console.log(
          "[TV AUDIO] PLAYING:",
          text
        );

        try {
          await audio.play();
        } catch (error) {
          /*
           * Nếu browser vẫn chặn playback,
           * báo rõ NotAllowedError.
           */
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          throw new Error(
            `Browser chặn phát audio: ${message}`
          );
        }

        await endedPromise;

        console.log(
          "[TV AUDIO] PLAY END:",
          text
        );

        /*
         * Cleanup sau khi phát xong.
         */
        try {
          audio.pause();
        } catch {}

        releaseObjectUrl();

        resetAudio();

        setAudioStatus(
          "Âm thanh sẵn sàng"
        );
      },
      [
        getAudio,
        releaseObjectUrl,
        resetAudio,
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
        "[TV AUDIO] QUEUE START",
        queueRef.current.length
      );

      try {
        while (
          queueRef.current.length >
          0
        ) {
          const job =
            queueRef.current[0];

          if (!job) {
            queueRef.current.shift();
            continue;
          }

          console.log(
            "[TV AUDIO] PROCESS:",
            job.id,
            job.text
          );

          let completed = false;

          /*
           * ----------------------------------------------------
           * Mỗi ticket:
           * đọc tối đa 2 lần.
           *
           * Nếu cả 2 lần fail:
           * giữ ticket trong queue và retry sau.
           *
           * Không được làm mất ticket.
           * ----------------------------------------------------
           */

          for (
            let repeat = 1;
            repeat <= 2;
            repeat++
          ) {
            let success = false;

            for (
              let attempt = 1;
              attempt <= 2;
              attempt++
            ) {
              try {
                console.log(
                  `[TV AUDIO] TICKET ${job.id} — REPEAT ${repeat}/2 — ATTEMPT ${attempt}/2`
                );

                await playText(
                  job.text
                );

                success = true;

                console.log(
                  `[TV AUDIO] TICKET ${job.id} — REPEAT ${repeat}/2 SUCCESS`
                );

                break;
              } catch (error) {
                console.error(
                  `[TV AUDIO] TICKET ${job.id} — REPEAT ${repeat}/2 — ATTEMPT ${attempt}/2 FAILED`,
                  error
                );

                if (
                  attempt < 2
                ) {
                  await new Promise<void>(
                    (resolve) =>
                      window.setTimeout(
                        resolve,
                        1200
                      )
                  );
                }
              }
            }

            if (!success) {
              /*
               * Không xóa ticket.
               *
               * Giữ ticket đầu queue.
               * Dừng processor.
               *
               * User có thể bấm "Test lại âm thanh"
               * hoặc watchdog sẽ không tự gọi trùng
               * vì ticket vẫn còn trong queue.
               */
              setAudioStatus(
                "Không phát được thông báo — đang giữ vé để thử lại"
              );

              console.error(
                "[TV AUDIO] KEEP FAILED JOB IN QUEUE:",
                job.id
              );

              return;
            }

            /*
             * Khoảng cách giữa 2 lần đọc.
             */
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
           * Ticket hoàn thành đủ 2 lần.
           *
           * Chỉ lúc này mới remove khỏi queue.
           */
          completed = true;

          if (completed) {
            queueRef.current.shift();
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
        playingRef.current =
          false;

        console.log(
          "[TV AUDIO] QUEUE END"
        );

        /*
         * Nếu còn ticket:
         * xử lý tiếp.
         */
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
      ) => {
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

        const job: AudioJob = {
          id,
          queueNumber,
          driverName,
          counterName,
          text,
        };

        console.log(
          "[TV AUDIO] ENQUEUE:",
          job
        );

        queueRef.current.push(
          job
        );

        /*
         * Nếu audio đã unlock,
         * xử lý ngay.
         *
         * Nếu chưa unlock:
         * giữ trong queue.
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
     TEST TTS
     ========================================================== */

  const testAudio =
    useCallback(async () => {
      /*
       * Nếu browser chưa unlock,
       * chính nút này cũng có thể unlock.
       */
      if (
        !unlockedRef.current
      ) {
        const success =
          await unlock();

        if (!success) {
          return false;
        }
      }

      try {
        setAudioStatus(
          "Đang kiểm tra Google TTS..."
        );

        await playText(
          "Âm thanh thông báo đã được bật"
        );

        setAudioStatus(
          "Test Google TTS thành công"
        );

        return true;
      } catch (error) {
        console.error(
          "[TV AUDIO] TTS TEST FAILED:",
          error
        );

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setAudioStatus(
          `Google TTS lỗi: ${message}`
        );

        return false;
      }
    }, [
      unlock,
      playText,
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
      playingRef.current =
        false;

      queueRef.current = [];

      const audio =
        audioRef.current;

      if (audio) {
        try {
          audio.pause();
        } catch {}

        audio.onended = null;
        audio.onerror = null;
        audio.oncanplay = null;
        audio.oncanplaythrough =
          null;

        audio.removeAttribute(
          "src"
        );

        try {
          audio.load();
        } catch {}

        try {
          audio.remove();
        } catch {}
      }

      releaseObjectUrl();

      const context =
        audioContextRef.current;

      if (context) {
        void context.close();
      }

      audioRef.current = null;
      audioContextRef.current =
        null;
    };
  }, [releaseObjectUrl]);

  return {
    enqueue,
    unlock,
    testAudio,
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
    testAudio,
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
           * Một call được định danh bằng:
           *
           * counter + called_at
           *
           * Không dùng queue number đơn thuần
           * vì cùng queue có thể được gọi lại.
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
             * KHÔNG mark announced.
             *
             * Refresh sau sẽ thử lại.
             */
            console.warn(
              "[TV] DRIVER NOT FOUND:",
              {
                queue:
                  call.queue_number,
                queueList:
                  queueList.length,
              }
            );

            continue;
          }

          const driverName =
            driver.driver_name?.trim();

          if (!driverName) {
            /*
             * KHÔNG mark announced.
             *
             * Đợi dữ liệu driver hoàn chỉnh.
             */
            console.warn(
              "[TV] DRIVER NAME EMPTY:",
              call.queue_number
            );

            continue;
          }

          /*
           * Dùng counter_name để đọc.
           *
           * Ví dụ:
           *
           * HCM014 + Quầy 04
           *
           * =>
           * "Quầy số bốn"
           */
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

          /*
           * Mark trước enqueue.
           *
           * Nhưng AudioJob vẫn nằm trong
           * audio queue cho đến khi phát xong.
           */
          announcedCalls.current.add(
            callKey
          );

          enqueueAudio(
            call.queue_number,
            driverName,
            counterName
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

          /*
           * Chỉ clear lỗi khi cả hai
           * RPC đều trả được dữ liệu hợp lệ.
           *
           * loadAgentQueue hiện không trả
           * error object ra ngoài nên giữ
           * behavior cũ cho phần này.
           */
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
     * Dùng để bắt trường hợp Realtime
     * bị miss event.
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

        /*
         * Không đưa ticket đã được gọi
         * vào danh sách waiting.
         */
        if (
          isCalledQueue(
            queue,
            counters
          )
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
    }, [
      agentQueue,
      counters,
    ]);

  /* ==========================================================
     UNASSIGNED
     ========================================================== */

  const unassigned =
    useMemo(
      () =>
        agentQueue.filter(
          (q) =>
            !q.agent_id &&
            !isCalledQueue(
              q,
              counters
            )
        ),
      [
        agentQueue,
        counters,
      ]
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
            /*
             * Đây là USER GESTURE.
             *
             * unlockAudio() KHÔNG fetch Google TTS.
             * Nó chỉ unlock browser audio.
             */
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
              /*
               * Test Google TTS thật sự.
               */
              void testAudio();
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
