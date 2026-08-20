"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type CounterStatusRow = {
  counter_code: string;
  counter_name: string;
  counter_status:
    | "OPEN"
    | "CLOSED"
    | "AVAILABLE"
    | "BUSY"
    | "OFFLINE";
};

type AgentQueueRow = {
  agent_id: string | null;
  ticket_code: string;
  queue_number: string;
  driver_name: string;
  created_at: string;
};

type ActiveCall = {
  counter_code: string;
  queue_number: string;
  called_at: string;
};

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

  const counterDigits =
    stripLeadingZeros(counterCode);

  for (const ch of counterDigits) {
    if (DIGIT_CLIP[ch]) {
      clips.push(DIGIT_CLIP[ch]);
    }
  }

  return clips;
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

function counterNumberToWords(
  counterCode: string
): string {
  const stripped =
    counterCode.replace(/^0+/, "");

  const n = parseInt(stripped, 10);

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

  const cWords =
    counterNumberToWords(counterCode);

  return `Kính mời tài xế có số ${qWords}, ${driverName}, đến quầy số ${cWords}`;
}

function useAnnouncer() {
  const audioRef =
    useRef<HTMLAudioElement | null>(null);

  const queueRef =
    useRef<(() => Promise<void>)[]>([]);

  const playingRef = useRef(false);

  const [unlocked, setUnlocked] =
    useState(false);

  const unlock = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;

    audio.src = `${CLIP_BASE}intro.mp3`;

    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        setUnlocked(true);
      })
      .catch(() => {});
  }, []);

  const playLocalClips = useCallback(
    (clipNames: string[]) => {
      return new Promise<void>(
        (resolve, reject) => {
          if (!audioRef.current) {
            audioRef.current = new Audio();
          }

          const audio =
            audioRef.current;

          let index = 0;

          const playNext = () => {
            if (index >= clipNames.length) {
              resolve();
              return;
            }

            audio.src =
              `${CLIP_BASE}${clipNames[index]}.mp3`;

            index += 1;

            audio.onended = playNext;

            audio
              .play()
              .catch(reject);
          };

          playNext();
        }
      );
    },
    []
  );

  const playRemote = useCallback(
    (url: string) => {
      return new Promise<void>(
        (resolve, reject) => {
          if (!audioRef.current) {
            audioRef.current = new Audio();
          }

          const audio =
            audioRef.current;

          audio.src = url;

          audio.onended = () =>
            resolve();

          audio.onerror = () =>
            reject(
              new Error(
                "playback error"
              )
            );

          audio
            .play()
            .catch(reject);
        }
      );
    },
    []
  );

  const processQueue = useCallback(
    async () => {
      if (playingRef.current) {
        return;
      }

      playingRef.current = true;

      while (
        queueRef.current.length > 0
      ) {
        const job =
          queueRef.current.shift();

        if (!job) {
          continue;
        }

        try {
          await job();
        } catch (error) {
          console.warn(
            "TV Display: không phát được âm thanh.",
            error
          );
        }
      }

      playingRef.current = false;
    },
    []
  );

  const enqueue = useCallback(
    (
      queueNumber: string,
      driverName: string,
      counterCode: string
    ) => {
      queueRef.current.push(
        async () => {
          const text =
            buildAnnouncementText(
              queueNumber,
              driverName,
              counterCode
            );

          try {
            const response =
              await fetch(
                `/api/tts?text=${encodeURIComponent(
                  text
                )}`
              );

            if (!response.ok) {
              throw new Error(
                "TTS route failed"
              );
            }

            const blob =
              await response.blob();

            const url =
              URL.createObjectURL(blob);

            try {
              await playRemote(url);
            } finally {
              URL.revokeObjectURL(url);
            }
          } catch {
            await playLocalClips(
              buildAnnouncementClips(
                queueNumber,
                counterCode
              )
            );
          }

          await new Promise(
            (resolve) =>
              setTimeout(resolve, 700)
          );

          try {
            const response =
              await fetch(
                `/api/tts?text=${encodeURIComponent(
                  text
                )}`
              );

            if (!response.ok) {
              throw new Error(
                "TTS route failed"
              );
            }

            const blob =
              await response.blob();

            const url =
              URL.createObjectURL(blob);

            try {
              await playRemote(url);
            } finally {
              URL.revokeObjectURL(url);
            }
          } catch {
            await playLocalClips(
              buildAnnouncementClips(
                queueNumber,
                counterCode
              )
            );
          }
        }
      );

      processQueue();
    },
    [
      playRemote,
      playLocalClips,
      processQueue,
    ]
  );

  return {
    enqueue,
    unlock,
    unlocked,
  };
}

function useClock() {
  const [now, setNow] =
    useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    const id = setInterval(
      () => setNow(new Date()),
      1000
    );

    return () =>
      clearInterval(id);
  }, []);

  return now;
}

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
  ] = useState<CounterStatusRow[]>(
    []
  );

  const [
    agentQueue,
    setAgentQueue,
  ] = useState<AgentQueueRow[]>(
    []
  );

  const [
    activeCalls,
    setActiveCalls,
  ] = useState<ActiveCall[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(
    null
  );

  const lastAnnouncedAt =
    useRef<
      Map<string, string>
    >(new Map());

  const {
    enqueue: enqueueAudio,
    unlock: unlockAudio,
    unlocked,
  } = useAnnouncer();

  const clock = useClock();

  /*
   * ============================================================
   * LOAD COUNTERS
   *
   * DB RPC hiện tại:
   * tv_counter_status
   *
   * KHÔNG phải:
   * tv_counters_status
   * ============================================================
   */

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

        setErrorMessage(
          error.message
        );

        return [];
      }

      const result =
        (data as CounterStatusRow[]) ??
        [];

      /*
       * Hiện DB chưa có display_order.
       * Tạm thời sort theo counter_code.
       *
       * Sau này thêm display_order:
       * sort theo display_order trước.
       */

      result.sort((a, b) =>
        a.counter_code.localeCompare(
          b.counter_code,
          undefined,
          {
            numeric: true,
            sensitivity: "base",
          }
        )
      );

      setCounters(result);

      return result;
    }, [branchCode]);

  /*
   * ============================================================
   * LOAD AGENT QUEUE
   * ============================================================
   */

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

        /*
         * Không xoá counters nếu
         * queue RPC lỗi.
         */
        setAgentQueue([]);

        return [];
      }

      const result =
        (data as AgentQueueRow[]) ??
        [];

      setAgentQueue(result);

      return result;
    }, [branchCode]);

  /*
   * ============================================================
   * LOAD ACTIVE CALL
   *
   * Vì tv_counter_status hiện tại chỉ trả:
   * counter_code
   * counter_name
   * counter_status
   *
   * nên ticket đang gọi phải lấy riêng từ queue_tickets.
   * ============================================================
   */

  const loadActiveCalls =
    useCallback(async () => {
      /*
       * Lấy các ticket đang CALLED.
       *
       * Dùng RPC/view hiện có trước.
       * Nếu RPC queue list đã chứa ticket đang gọi
       * thì dùng dữ liệu đó.
       */

      const {
        data,
        error,
      } = await supabase
        .from("queue_tickets")
        .select(
          `
            ticket_code,
            queue_number,
            counter_id,
            called_at,
            status
          `
        )
        .eq(
          "status",
          "CALLED"
        )
        .not(
          "counter_id",
          "is",
          null
        );

      if (error) {
        console.warn(
          "Không lấy được active calls:",
          error.message
        );

        setActiveCalls([]);

        return [];
      }

      /*
       * Cần map counter_id -> counter_code.
       */
      const rows =
        data ?? [];

      if (
        rows.length === 0
      ) {
        setActiveCalls([]);

        return [];
      }

      const counterIds =
        rows
          .map(
            (row) =>
              row.counter_id
          )
          .filter(
            (
              id
            ): id is string =>
              Boolean(id)
          );

      const {
        data: counterRows,
      } = await supabase
        .from("counters")
        .select(
          "id, counter_code"
        )
        .in(
          "id",
          counterIds
        );

      const counterMap =
        new Map(
          (counterRows ??
            []
          ).map(
            (counter) => [
              counter.id,
              counter.counter_code,
            ]
          )
        );

      const result =
        rows
          .map((row) => {
            const counterCode =
              row.counter_id
                ? counterMap.get(
                    row.counter_id
                  )
                : null;

            if (
              !counterCode ||
              !row.queue_number ||
              !row.called_at
            ) {
              return null;
            }

            return {
              counter_code:
                counterCode,
              queue_number:
                row.queue_number,
              called_at:
                row.called_at,
            };
          })
          .filter(
            (
              row
            ): row is ActiveCall =>
              Boolean(row)
          );

      setActiveCalls(result);

      return result;
    }, []);

  /*
   * ============================================================
   * LOAD ALL
   * ============================================================
   */

  const load =
    useCallback(async () => {
      setErrorMessage(null);

      const [
        counterList,
        queueList,
        calls,
      ] = await Promise.all([
        loadCounters(),
        loadAgentQueue(),
        loadActiveCalls(),
      ]);

      setLoading(false);

      /*
       * ========================================================
       * ANNOUNCEMENT
       * ========================================================
       */

      const sortedCalls =
        [...calls].sort(
          (a, b) =>
            new Date(
              a.called_at
            ).getTime() -
            new Date(
              b.called_at
            ).getTime()
        );

      for (
        const call of sortedCalls
      ) {
        const last =
          lastAnnouncedAt.current.get(
            call.counter_code
          );

        /*
         * Đã đọc call này rồi.
         */
        if (
          last ===
          call.called_at
        ) {
          continue;
        }

        const driver =
          queueList.find(
            (q) =>
              q.queue_number
                .trim()
                .toUpperCase() ===
              call.queue_number
                .trim()
                .toUpperCase()
          );

        /*
         * Chưa có tên tài xế thì
         * chưa đánh dấu đã đọc.
         */
        if (
          !driver?.driver_name?.trim()
        ) {
          continue;
        }

        /*
         * Kiểm tra counter có thực sự
         * tồn tại trên TV.
         */
        const counterExists =
          counterList.some(
            (c) =>
              c.counter_code ===
              call.counter_code
          );

        if (!counterExists) {
          continue;
        }

        enqueueAudio(
          call.queue_number,
          driver.driver_name.trim(),
          call.counter_code
        );

        lastAnnouncedAt.current.set(
          call.counter_code,
          call.called_at
        );
      }
    }, [
      loadCounters,
      loadAgentQueue,
      loadActiveCalls,
      enqueueAudio,
    ]);

  /*
   * ============================================================
   * INITIAL + REALTIME
   * ============================================================
   */

  useEffect(() => {
    load();

    const channel =
      supabase
        .channel(
          `tv-${branchCode}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "queue_tickets",
          },
          () => {
            load();
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
            load();
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
            load();
          }
        )
        .subscribe();

    const interval =
      setInterval(
        load,
        15000
      );

    return () => {
      supabase.removeChannel(
        channel
      );

      clearInterval(
        interval
      );
    };
  }, [
    branchCode,
    load,
  ]);

  /*
   * ============================================================
   * CURRENT DISPLAY STATE
   * ============================================================
   */

  const waitingByAgent =
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
      waitingByAgent.get(
        queue.agent_id
      ) ?? [];

    current.push(queue);

    waitingByAgent.set(
      queue.agent_id,
      current
    );
  }

  const unassigned =
    agentQueue.filter(
      (q) => !q.agent_id
    );

  const totalWaiting =
    agentQueue.length;

  function getActiveCall(
    counterCode: string
  ) {
    return activeCalls.find(
      (call) =>
        call.counter_code ===
        counterCode
    );
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <div className="flex min-h-screen w-screen flex-col overflow-hidden bg-paper">
      {!unlocked && (
        <button
          type="button"
          onClick={unlockAudio}
          className="w-full bg-warn px-4 py-2 text-center font-body font-semibold text-white hover:bg-warn/90"
          style={{
            fontSize: "1vw",
          }}
        >
          🔊 Bấm vào đây 1 lần để
          bật âm thanh thông báo cho
          màn hình này (chỉ cần làm 1
          lần mỗi khi mở trang)
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
          Không tải được dữ liệu quầy:
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
                  const call =
                    getActiveCall(
                      counter.counter_code
                    );

                  const busy =
                    counter.counter_status ===
                      "BUSY" &&
                    Boolean(call);

                  /*
                   * Queue đang chờ tại agent
                   * của quầy.
                   *
                   * Nếu RPC counter chưa trả
                   * agent_id thì phần này không
                   * thể xác định agent của quầy.
                   */
                  const myAgentQueue =
                    agentQueue.filter(
                      (q) =>
                        q.agent_id &&
                        q.agent_id ===
                          (
                            call as
                              unknown as {
                                agent_id?: string;
                              }
                          )?.agent_id
                    );

                  return (
                    <div
                      key={
                        counter.counter_code
                      }
                      className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm"
                    >
                      {/* Counter header */}

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
                          {counter.counter_name}
                        </p>

                        <p
                          className="font-body text-white/70"
                          style={{
                            fontSize:
                              "0.7vw",
                          }}
                        >
                          {counter.counter_code}
                        </p>
                      </div>

                      {/* Current call */}

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
                            ? call?.queue_number
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

                      {/* Waiting */}

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
                          Đang chờ
                        </p>

                        {myAgentQueue.length >
                        0 ? (
                          <div className="space-y-1.5">
                            {myAgentQueue.map(
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
                    Chưa phân bổ
                    Agent
                    {" "}
                    ({unassigned.length})
                  </p>
                </div>

                <div
                  className="flex flex-wrap"
                  style={{
                    padding: "1vw",
                    gap: "0.4vw 2vw",
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
