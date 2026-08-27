"use client";

import { useCallback, useEffect, useState } from "react";
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

type QueueRow = AgentQueueRow & {
  counter_id?: string | null;
  counter_name?: string | null;
};

type MyCounter = {
  id: string;
  counter_code: string;
  counter_name: string;
  status: "AVAILABLE" | "BUSY" | "CLOSED";
  current_agent_id: string | null;
};

function minutesSince(iso: string) {
  return Math.max(
    0,
    Math.round(
      (Date.now() - new Date(iso).getTime()) / 60000
    )
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

  const [queueFilter, setQueueFilter] =
    useState<QueueFilter>("ALL");

  const [loading, setLoading] =
    useState(true);

  const [calling, setCalling] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  /*
   * ============================================================
   * LOAD QUEUE
   * ============================================================
   */

  const loadQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from("v_agent_queue")
      .select("*")
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
   *
   * Quầy của Agent được xác định bằng:
   *
   * counters.current_agent_id = profile.id
   *
   * và cùng branch với Agent.
   * ============================================================
   */

  const loadMyCounter = useCallback(
    async (currentProfile: Profile) => {
      if (!currentProfile.branch_id) {
        setMyCounter(null);
        return;
      }

      const { data, error } = await supabase
        .from("counters")
        .select(
          `
            id,
            counter_code,
            counter_name,
            status,
            current_agent_id
          `
        )
        .eq(
          "branch_id",
          currentProfile.branch_id
        )
        .eq(
          "current_agent_id",
          currentProfile.id
        )
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message);
        setMyCounter(null);
        return;
      }

      setMyCounter(
        (data as MyCounter) ?? null
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

      setProfile(currentProfile);

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
   * ============================================================
   */

  useEffect(() => {
    const channel = supabase
      .channel("agent-queue-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_tickets",
        },
        loadQueue
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_cases",
        },
        loadQueue
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
      supabase.removeChannel(channel);
    };
  }, [
    loadQueue,
    loadMyCounter,
    profile,
  ]);

  /*
   * ============================================================
   * FILTER
   *
   * ALL:
   *   Hiển thị toàn bộ ticket mà v_agent_queue trả về.
   *
   * MINE:
   *   Chỉ ticket thuộc counter của Agent hiện tại.
   * ============================================================
   */

  const filteredRows = rows.filter(
    (row) => {
      if (queueFilter === "ALL") {
        return true;
      }

      if (!myCounter) {
        return false;
      }

      return (
        row.counter_id ===
        myCounter.id
      );
    }
  );

  /*
   * ============================================================
   * STATS
   *
   * Stats chạy theo filter đang chọn.
   * ============================================================
   */

  const waiting = filteredRows.filter(
    (row) =>
      row.status === "WAITING"
  );

  const processing = filteredRows.filter(
    (row) =>
      row.status === "PROCESSING"
  );

  const pending = filteredRows.filter(
    (row) =>
      row.status === "PENDING"
  );

  const overSla = filteredRows.filter(
    (row) =>
      row.sla_due_at &&
      new Date(
        row.sla_due_at
      ).getTime() < Date.now() &&
      !row.resolved_at &&
      !row.closed_at &&
      row.status !== "PENDING"
  );

  const completedToday =
    filteredRows.filter(
      (row) =>
        (
          row.status === "RESOLVED" ||
          row.status === "CLOSED"
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
   * QUAN TRỌNG:
   *
   * Không phụ thuộc filter ALL / MINE.
   *
   * Luôn gọi ticket WAITING của
   * counter mà Agent hiện tại đang phụ trách.
   *
   * Backend RPC:
   *
   * call_next_ticket(
   *   p_counter_id = myCounter.id
   * )
   *
   * và backend phải lấy:
   *
   * WAITING
   * ORDER BY created_at ASC
   * LIMIT 1
   * ============================================================
   */

  async function handleCallNext() {
    if (!myCounter) {
      setErrorMessage(
        "Bạn hiện chưa được gán vào quầy nào."
      );
      return;
    }

    setCalling(true);
    setErrorMessage(null);

    const { data, error } =
      await supabase.rpc(
        "call_next_ticket",
        {
          p_counter_id:
            myCounter.id,
        }
      );

    setCalling(false);

    if (error || !data) {
      setErrorMessage(
        error?.message ??
          "Không thể gọi số tiếp theo."
      );
      return;
    }

    /*
     * RPC có thể trả về object hoặc array
     * tùy function definition.
     */

    const result = Array.isArray(data)
      ? data[0]
      : data;

    if (!result?.case_id) {
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
            !myCounter
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
          FILTER
          ====================================================== */}

      <div className="flex flex-wrap items-center gap-2">

        <button
          type="button"
          onClick={() =>
            setQueueFilter("ALL")
          }
          className={`rounded-lg px-4 py-2 font-body text-sm font-medium transition ${
            queueFilter === "ALL"
              ? "bg-brand-900 text-white"
              : "border border-line bg-white text-ink/70 hover:bg-paper"
          }`}
        >
          Tất cả
        </button>

        <button
          type="button"
          onClick={() =>
            setQueueFilter("MINE")
          }
          className={`rounded-lg px-4 py-2 font-body text-sm font-medium transition ${
            queueFilter === "MINE"
              ? "bg-brand-900 text-white"
              : "border border-line bg-white text-ink/70 hover:bg-paper"
          }`}
        >
          Của tôi
        </button>

      </div>

      {/* ======================================================
          MY COUNTER INFO
          ====================================================== */}

      {queueFilter === "MINE" &&
        !myCounter && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 font-body text-sm text-orange-800">
            Bạn hiện chưa được gán vào
            quầy nào.
          </div>
        )}

      {/* ======================================================
          STATS
          ====================================================== */}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">

        <StatCard
          label="Waiting"
          value={waiting.length}
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

              <th className="px-4 py-3"></th>

            </tr>
          </thead>

          <tbody>

            {loading && (
              <tr>
                <td
                  colSpan={8}
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
                    colSpan={8}
                    className="px-4 py-6 text-center text-ink/40"
                  >
                    {queueFilter ===
                    "MINE"
                      ? "Quầy của bạn hiện không có ticket nào."
                      : "Không có ticket nào."}
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
  );
}
