
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import { AgentQueueRow, Profile } from "@/lib/types";
import {
  PrimaryButton,
  SecondaryButton,
  SlaBadge,
  StatCard,
  StatusBadge,
} from "@/components/agent/ui";

type QueueFilter = "ALL" | "MINE";

type StatusFilter =
  | "ALL"
  | "WAITING"
  | "PROCESSING"
  | "PENDING"
  | "RESOLVED"
  | "CLOSED";

type QueueRow = AgentQueueRow & {
  counter_id?: string | null;
  counter_name?: string | null;
};

type CounterStatus =
  | "AVAILABLE"
  | "BUSY"
  | "CLOSED";

type MyCounter = {
  id: string;
  counter_code: string;
  counter_name: string;
  status: CounterStatus;
  current_agent_id: string | null;
  default_agent_id: string | null;
};

function minutesSince(iso: string) {
  return Math.max(
    0,
    Math.round(
      (Date.now() - new Date(iso).getTime()) / 60000
    )
  );
}

/*
 * ============================================================
 * GET TODAY RANGE
 *
 * Dùng timezone local của browser.
 *
 * Ví dụ:
 * start = 00:00 hôm nay
 * end   = 00:00 ngày mai
 *
 * Supabase/Postgres sẽ nhận ISO có timezone offset.
 * ============================================================
 */

function getTodayRange() {
  const now = new Date();

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/*
 * ============================================================
 * COUNTER STATUS BADGE
 * ============================================================
 */

function CounterStatusBadge({
  status,
}: {
  status: CounterStatus;
}) {
  const config = {
    AVAILABLE: {
      label: "SẴN SÀNG",
      className:
        "bg-green-100 text-green-700",
    },
    BUSY: {
      label: "ĐANG BẬN",
      className:
        "bg-orange-100 text-orange-700",
    },
    CLOSED: {
      label: "ĐÃ ĐÓNG",
      className:
        "bg-gray-100 text-gray-600",
    },
  };

  const current = config[status];

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${current.className}`}
    >
      {current.label}
    </span>
  );
}

/*
 * ============================================================
 * STATUS FILTER BUTTON
 * ============================================================
 */

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 font-body text-sm font-medium transition ${
        active
          ? "bg-brand-900 text-white"
          : "border border-line bg-white text-ink/70 hover:bg-paper"
      }`}
    >
      {children}
    </button>
  );
}

export default function AgentQueuePage() {
  const router = useRouter();

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [rows, setRows] =
    useState<QueueRow[]>([]);

  const [myCounter, setMyCounter] =
    useState<MyCounter | null>(null);

  /*
   * Filter phạm vi:
   * ALL / MINE
   */
  const [queueFilter, setQueueFilter] =
    useState<QueueFilter>("ALL");

  /*
   * Filter trạng thái:
   * ALL / WAITING / PROCESSING / PENDING / RESOLVED / CLOSED
   */
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("ALL");

  /*
   * Filter chủ đề.
   *
   * null = tất cả chủ đề
   */
  const [categoryFilter, setCategoryFilter] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [calling, setCalling] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  /*
   * ============================================================
   * LOAD QUEUE
   *
   * CHỈ LOAD TICKET CỦA HÔM NAY
   *
   * created_at >= đầu ngày
   * created_at <  đầu ngày hôm sau
   * ============================================================
   */

  const loadQueue = useCallback(async () => {
    setLoading(true);

    const {
      start,
      end,
    } = getTodayRange();

    const { data, error } = await supabase
      .from("v_agent_queue")
      .select("*")
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", {
        ascending: true,
      });

    if (error) {
      setErrorMessage(error.message);
      setRows([]);
    } else {
      setRows(
        (data as QueueRow[]) ?? []
      );
    }

    setLoading(false);
  }, []);

  /*
   * ============================================================
   * LOAD MY COUNTER
   * ============================================================
   */

  const loadMyCounter = useCallback(
    async (
      currentProfile: Profile
    ) => {
      if (
        !currentProfile.branch_id
      ) {
        setMyCounter(null);
        return;
      }

      const { data, error } =
        await supabase
          .from("counters")
          .select(
            `
              id,
              counter_code,
              counter_name,
              status,
              current_agent_id,
              default_agent_id
            `
          )
          .eq(
            "branch_id",
            currentProfile.branch_id
          )
          .or(
            `current_agent_id.eq.${currentProfile.id},default_agent_id.eq.${currentProfile.id}`
          )
          .order(
            "counter_code",
            {
              ascending: true,
            }
          );

      if (error) {
        setErrorMessage(error.message);
        setMyCounter(null);
        return;
      }

      const counters =
        (data as MyCounter[]) ?? [];

      /*
       * Ưu tiên quầy Agent đang trực tiếp phụ trách.
       */

      const activeCounter =
        counters.find(
          (counter) =>
            counter.current_agent_id ===
            currentProfile.id
        ) ??
        counters.find(
          (counter) =>
            counter.default_agent_id ===
            currentProfile.id
        ) ??
        null;

      setMyCounter(
        activeCounter
      );
    },
    []
  );

  /*
   * ============================================================
   * INITIAL LOAD
   * ============================================================
   */

  useEffect(() => {
    let mounted = true;

    async function init() {
      const currentProfile =
        await getCurrentProfile();

      if (!mounted) {
        return;
      }

      setProfile(
        currentProfile
      );

      if (currentProfile) {
        await loadMyCounter(
          currentProfile
        );
      }

      await loadQueue();
    }

    init();

    return () => {
      mounted = false;
    };
  }, [
    loadQueue,
    loadMyCounter,
  ]);

  /*
   * ============================================================
   * REALTIME
   *
   * Khi ticket thay đổi -> reload queue hôm nay.
   * ============================================================
   */

  useEffect(() => {
    const channel = supabase
      .channel(
        "agent-queue-changes"
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_tickets",
        },
        () => {
          loadQueue();
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
          loadQueue();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "counters",
        },
        async () => {
          if (profile) {
            await loadMyCounter(
              profile
            );
          }

          await loadQueue();
        }
      )

      .subscribe();

    return () => {
      supabase.removeChannel(
        channel
      );
    };
  }, [
    loadQueue,
    loadMyCounter,
    profile,
  ]);

  /*
   * ============================================================
   * FILTER 1
   *
   * ALL:
   *   Tất cả ticket hôm nay.
   *
   * MINE:
   *   Ticket thuộc counter của Agent.
   * ============================================================
   */

  const scopedRows = useMemo(() => {
    return rows.filter((row) => {
      if (
        queueFilter === "ALL"
      ) {
        return true;
      }

      if (!myCounter) {
        return (
          row.assigned_agent_id ===
          profile?.id
        );
      }

      return (
        row.counter_id ===
          myCounter.id ||
        row.assigned_agent_id ===
          profile?.id
      );
    });
  }, [
    rows,
    queueFilter,
    myCounter,
    profile?.id,
  ]);

  /*
   * ============================================================
   * CATEGORY OPTIONS
   *
   * Lấy chủ đề từ queue hôm nay sau khi áp dụng
   * filter ALL / MINE.
   * ============================================================
   */

  const categoryOptions =
    useMemo(() => {
      const categories =
        scopedRows
          .map(
            (row) =>
              row.category_name
          )
          .filter(
            (
              category
            ): category is string =>
              Boolean(category)
          );

      return Array.from(
        new Set(categories)
      ).sort(
        (a, b) =>
          a.localeCompare(
            b,
            "vi"
          )
      );
    }, [scopedRows]);

  /*
   * ============================================================
   * FILTER 2
   *
   * Trạng thái + Chủ đề
   *
   * Hai filter hoạt động đồng thời.
   * ============================================================
   */

  const filteredRows =
    useMemo(() => {
      return scopedRows.filter(
        (row) => {
          const matchStatus =
            statusFilter ===
              "ALL" ||
            row.status ===
              statusFilter;

          const matchCategory =
            !categoryFilter ||
            row.category_name ===
              categoryFilter;

          return (
            matchStatus &&
            matchCategory
          );
        }
      );
    }, [
      scopedRows,
      statusFilter,
      categoryFilter,
    ]);

  /*
   * ============================================================
   * STATS
   *
   * Stats dựa trên phạm vi ALL / MINE,
   * không bị ảnh hưởng bởi filter bên dưới bảng.
   * ============================================================
   */

  const waiting =
    scopedRows.filter(
      (row) =>
        row.status === "WAITING"
    );

  const processing =
    scopedRows.filter(
      (row) =>
        row.status ===
        "PROCESSING"
    );

  const pending =
    scopedRows.filter(
      (row) =>
        row.status === "PENDING"
    );

  const overSla =
    scopedRows.filter(
      (row) =>
        row.sla_due_at &&
        new Date(
          row.sla_due_at
        ).getTime() <
          Date.now() &&
        !row.resolved_at &&
        !row.closed_at &&
        row.status !==
          "PENDING"
    );

  const completedToday =
    scopedRows.filter(
      (row) =>
        (
          row.status ===
            "RESOLVED" ||
          row.status ===
            "CLOSED"
        ) &&
        row.resolved_at &&
        new Date(
          row.resolved_at
        ).toDateString() ===
          new Date().toDateString()
    );

  /*
   * ============================================================
   * CALL NEXT
   *
   * KHÔNG phụ thuộc filter.
   *
   * Luôn gọi theo counter của Agent.
   * ============================================================
   */

  async function handleCallNext() {
    if (!profile) {
      setErrorMessage(
        "Không xác định được Agent hiện tại."
      );
      return;
    }

    if (!myCounter) {
      setErrorMessage(
        "Bạn hiện chưa được gán vào quầy nào."
      );
      return;
    }

    if (
      myCounter.status ===
      "CLOSED"
    ) {
      setErrorMessage(
        "Quầy hiện đang đóng."
      );
      return;
    }

    if (
      myCounter.status ===
      "BUSY"
    ) {
      setErrorMessage(
        "Quầy đang có ticket được xử lý."
      );
      return;
    }

    setCalling(true);
    setErrorMessage(null);

    const {
      data,
      error,
    } = await supabase.rpc(
      "call_next_ticket",
      {
        p_counter_id:
          myCounter.id,
      }
    );

    setCalling(false);

    if (error) {
      setErrorMessage(
        error.message
      );
      return;
    }

    if (!data) {
      setErrorMessage(
        "Không có ticket WAITING để gọi."
      );
      return;
    }

    const result =
      Array.isArray(data)
        ? data[0]
        : data;

    if (
      !result?.case_id
    ) {
      setErrorMessage(
        "Không tìm thấy ticket để gọi."
      );
      return;
    }

    router.push(
      `/agent/ticket/${result.case_id}`
    );
  }

  /*
   * ============================================================
   * CALL SPECIFIC
   * ============================================================
   */

  async function handleCallSpecific(
    ticketId: string,
    caseId: string
  ) {
    if (!profile) {
      setErrorMessage(
        "Không xác định được Agent hiện tại."
      );
      return;
    }

    setErrorMessage(null);

    const { error } =
      await supabase.rpc(
        "call_specific_ticket",
        {
          p_ticket_id:
            ticketId,
        }
      );

    if (error) {
      setErrorMessage(
        error.message
      );
      return;
    }

    router.push(
      `/agent/ticket/${caseId}`
    );
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <div className="space-y-6">

      {/* ======================================================
          HEADER
          ====================================================== */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        <div>
          <h1 className="font-display text-2xl font-bold text-brand-900">
            Queue của tôi
          </h1>

          {myCounter && (
            <p className="mt-1 font-body text-sm text-ink/50">
              {myCounter.counter_name}
            </p>
          )}
        </div>

        <PrimaryButton
          onClick={
            handleCallNext
          }
          disabled={
            calling ||
            !myCounter ||
            myCounter.status ===
              "BUSY" ||
            myCounter.status ===
              "CLOSED"
          }
        >
          {calling
            ? "Đang gọi..."
            : "GỌI TIẾP THEO"}
        </PrimaryButton>

      </div>

      {/* ======================================================
          ERROR
          ====================================================== */}

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {/* ======================================================
          QUEUE SCOPE FILTER
          ====================================================== */}

      <div className="flex flex-wrap items-center gap-2">

        <FilterButton
          active={
            queueFilter ===
            "ALL"
          }
          onClick={() => {
            setQueueFilter(
              "ALL"
            );
            setCategoryFilter(
              null
            );
          }}
        >
          Tất cả
        </FilterButton>

        <FilterButton
          active={
            queueFilter ===
            "MINE"
          }
          onClick={() => {
            setQueueFilter(
              "MINE"
            );
            setCategoryFilter(
              null
            );
          }}
        >
          Của tôi
        </FilterButton>

      </div>

      {/* ======================================================
          MY COUNTER
          ====================================================== */}

      {!myCounter && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 font-body text-sm text-orange-800">
          Bạn hiện chưa được gán vào
          quầy nào.
        </div>
      )}

      {myCounter && (
        <div className="rounded-lg border border-line bg-white px-4 py-3">

          <div className="flex flex-wrap items-center justify-between gap-3">

            <div>
              <p className="font-body text-sm font-semibold text-ink">
                {myCounter.counter_code}
                {" - "}
                {myCounter.counter_name}
              </p>

              <p className="mt-1 font-body text-xs text-ink/50">
                {myCounter.current_agent_id
                  ? "Agent đang trực tiếp phụ trách quầy"
                  : "Đang dùng Agent mặc định của quầy"}
              </p>
            </div>

            <CounterStatusBadge
              status={
                myCounter.status
              }
            />

          </div>

        </div>
      )}

      {/* ======================================================
          STATS
          ====================================================== */}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">

        <StatCard
          label="Waiting"
          value={
            waiting.length
          }
        />

        <StatCard
          label="Processing"
          value={
            processing.length
          }
        />

        <StatCard
          label="Pending"
          value={
            pending.length
          }
          tone="warn"
        />

        <StatCard
          label="Over SLA"
          value={
            overSla.length
          }
          tone="danger"
        />

        <StatCard
          label="Completed Today"
          value={
            completedToday.length
          }
        />

      </div>

      {/* ======================================================
          QUEUE TABLE
          ====================================================== */}

      <div className="overflow-hidden rounded-card border border-line bg-white">

        <div className="overflow-x-auto">

          <table className="w-full text-left font-body text-sm">

            <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">

              <tr>

                <th className="px-4 py-3">
                  Số
                </th>

                <th className="px-4 py-3">
                  Tài xế
                </th>

                <th className="px-4 py-3">
                  SAP ID
                </th>

                <th className="px-4 py-3">
                  Nhu cầu
                </th>

                <th className="px-4 py-3">
                  Thời gian chờ
                </th>

                <th className="px-4 py-3">
                  SLA
                </th>

                <th className="px-4 py-3">
                  Trạng thái
                </th>

                <th className="px-4 py-3">
                  Quầy
                </th>

                <th className="px-4 py-3"></th>

              </tr>

            </thead>

            <tbody>

              {loading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-6 text-center text-ink/40"
                  >
                    Đang tải...
                  </td>
                </tr>
              )}

              {!loading &&
                filteredRows.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-ink/40"
                    >
                      {statusFilter !==
                          "ALL" ||
                        categoryFilter
                        ? "Không có ticket phù hợp với bộ lọc."
                        : queueFilter ===
                            "MINE"
                        ? "Quầy của bạn hiện không có ticket nào hôm nay."
                        : "Không có ticket nào hôm nay."}
                    </td>
                  </tr>
                )}

              {filteredRows.map(
                (row) => (
                  <tr
                    key={
                      row.ticket_id
                    }
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-paper/40"
                    onClick={() =>
                      router.push(
                        `/agent/ticket/${row.case_id}`
                      )
                    }
                  >

                    <td className="px-4 py-3 font-display font-bold text-brand-900">
                      {
                        row.queue_number
                      }
                    </td>

                    <td className="px-4 py-3">
                      {
                        row.driver_name
                      }
                    </td>

                    <td className="px-4 py-3 text-ink/60">
                      {
                        row.sap_id ??
                        "—"
                      }
                    </td>

                    <td className="px-4 py-3">
                      {
                        row.category_name
                      }
                    </td>

                    <td className="px-4 py-3 text-ink/60">
                      {
                        minutesSince(
                          row.created_at
                        )
                      }{" "}
                      phút
                    </td>

                    <td className="px-4 py-3">
                      <SlaBadge
                        slaDueAt={
                          row.sla_due_at
                        }
                      />
                    </td>

                    <td className="px-4 py-3">
                      <StatusBadge
                        status={
                          row.status
                        }
                      />
                    </td>

                    <td className="px-4 py-3 text-ink/60">
                      {
                        row.counter_name ??
                        "—"
                      }
                    </td>

                    <td className="px-4 py-3 text-right">

                      {row.status ===
                        "WAITING" && (
                        <SecondaryButton
                          onClick={(
                            event
                          ) => {
                            event.stopPropagation();

                            handleCallSpecific(
                              row.ticket_id,
                              row.case_id
                            );
                          }}
                        >
                          Gọi
                        </SecondaryButton>
                      )}

                    </td>

                  </tr>
                )
              )}

            </tbody>

          </table>

        </div>

      </div>

      {/* ======================================================
          FILTERS - BELOW TABLE
          ====================================================== */}

      <div className="space-y-4 rounded-card border border-line bg-white p-4">

        {/* STATUS */}

        <div>

          <p className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-ink/50">
            Trạng thái
          </p>

          <div className="flex flex-wrap gap-2">

            <FilterButton
              active={
                statusFilter ===
                "ALL"
              }
              onClick={() =>
                setStatusFilter(
                  "ALL"
                )
              }
            >
              Tất cả
            </FilterButton>

            <FilterButton
              active={
                statusFilter ===
                "WAITING"
              }
              onClick={() =>
                setStatusFilter(
                  "WAITING"
                )
              }
            >
              Waiting
            </FilterButton>

            <FilterButton
              active={
                statusFilter ===
                "PROCESSING"
              }
              onClick={() =>
                setStatusFilter(
                  "PROCESSING"
                )
              }
            >
              Processing
            </FilterButton>

            <FilterButton
              active={
                statusFilter ===
                "PENDING"
              }
              onClick={() =>
                setStatusFilter(
                  "PENDING"
                )
              }
            >
              Pending
            </FilterButton>

            <FilterButton
              active={
                statusFilter ===
                "RESOLVED"
              }
              onClick={() =>
                setStatusFilter(
                  "RESOLVED"
                )
              }
            >
              Resolved
            </FilterButton>

            <FilterButton
              active={
                statusFilter ===
                "CLOSED"
              }
              onClick={() =>
                setStatusFilter(
                  "CLOSED"
                )
              }
            >
              Closed
            </FilterButton>

          </div>

        </div>

        {/* CATEGORY */}

        <div>

          <p className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-ink/50">
            Chủ đề
          </p>

          <div className="flex flex-wrap gap-2">

            <FilterButton
              active={
                categoryFilter ===
                null
              }
              onClick={() =>
                setCategoryFilter(
                  null
                )
              }
            >
              Tất cả chủ đề
            </FilterButton>

            {categoryOptions.map(
              (category) => (
                <FilterButton
                  key={
                    category
                  }
                  active={
                    categoryFilter ===
                    category
                  }
                  onClick={() =>
                    setCategoryFilter(
                      category
                    )
                  }
                >
                  {category}
                </FilterButton>
              )
            )}

          </div>

          {categoryOptions.length ===
            0 && (
            <p className="mt-2 font-body text-xs text-ink/40">
              Chưa có chủ đề nào trong queue hôm nay.
            </p>
          )}

        </div>

      </div>

    </div>
  );
}

