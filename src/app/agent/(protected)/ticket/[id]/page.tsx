"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import {
  CaseDetail,
  CaseHistoryEntry,
  Counter,
  Profile,
} from "@/lib/types";
import {
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from "@/components/agent/ui";

const HISTORY_LABELS: Record<string, string> = {
  Created: "Tạo ticket",
  "Status Changed": "Đổi trạng thái",
};

function fmt(dt: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("vi-VN");
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [history, setHistory] = useState<CaseHistoryEntry[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [resolution, setResolution] = useState("");
  const [internalNote, setInternalNote] = useState("");

  const [showTransfer, setShowTransfer] = useState(false);
  const [targetCounterId, setTargetCounterId] = useState("");

  const [showPending, setShowPending] = useState(false);
  const [pendingReason, setPendingReason] = useState("");
  const [pendingNextStep, setPendingNextStep] = useState("");
  const [pendingExpected, setPendingExpected] = useState("");

  const load = useCallback(async () => {
    const [{ data: caseData }, { data: historyData }] = await Promise.all([
      supabase
        .from("v_case_detail")
        .select("*")
        .eq("case_id", params.id)
        .maybeSingle(),

      supabase
        .from("case_history")
        .select(
          "id, action, old_status, new_status, note, created_at, performed_by"
        )
        .eq("case_id", params.id)
        .order("created_at", { ascending: true }),
    ]);

    setDetail((caseData as CaseDetail) ?? null);
    setHistory((historyData as CaseHistoryEntry[]) ?? []);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    async function init() {
      const currentProfile = await getCurrentProfile();

      setProfile(currentProfile);

      if (currentProfile?.branch_id) {
        const { data, error } = await supabase
          .from("counters")
          .select(
            "id, counter_code, counter_name, status, branch_id, default_agent_id"
          )
          .eq("branch_id", currentProfile.branch_id)
          .in("status", ["AVAILABLE", "BUSY", "OPEN"])
          .order("counter_code", { ascending: true });

        if (!error) {
          setCounters((data as Counter[]) ?? []);
        }
      }
    }

    init();
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`case-${params.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_cases",
          filter: `id=eq.${params.id}`,
        },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [params.id, load]);

  async function runRpc(
    name: string,
    args: Record<string, unknown>,
    after?: () => void
  ) {
    setBusy(true);
    setErrorMessage(null);

    const { error } = await supabase.rpc(name, args);

    setBusy(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    after?.();
    load();
  }

  const handleStartProcessing = () =>
    runRpc("start_processing", {
      p_case_id: params.id,
    });

  const handleNoShow = () =>
    runRpc("mark_no_show", {
      p_case_id: params.id,
    });

  const handleResolve = () => {
    if (!resolution.trim()) {
      setErrorMessage("Vui lòng nhập kết quả xử lý.");
      return;
    }

    runRpc("resolve_case", {
      p_case_id: params.id,
      p_resolution: resolution.trim(),
      p_internal_note: internalNote.trim() || null,
    });
  };

  const handleClose = () =>
    runRpc("close_case", {
      p_case_id: params.id,
    });

  const handleResume = () =>
    runRpc("resume_case", {
      p_case_id: params.id,
    });

  const handleSetPending = () => {
    if (!pendingReason.trim() || !pendingNextStep.trim()) {
      setErrorMessage("Vui lòng nhập lý do và bước tiếp theo.");
      return;
    }

    runRpc(
      "set_case_pending",
      {
        p_case_id: params.id,
        p_reason: pendingReason.trim(),
        p_next_step: pendingNextStep.trim(),
        p_expected_date: pendingExpected || null,
      },
      () => {
        setShowPending(false);
        setPendingReason("");
        setPendingNextStep("");
        setPendingExpected("");
      }
    );
  };

  async function handleTransferToCounter() {
    if (!detail) return;

    if (!targetCounterId) {
      setErrorMessage("Vui lòng chọn quầy muốn chuyển.");
      return;
    }

    const targetCounter = counters.find(
      (counter) => counter.id === targetCounterId
    );

    if (!targetCounter) {
      setErrorMessage("Không tìm thấy quầy được chọn.");
      return;
    }

    if (!targetCounter.default_agent_id) {
      setErrorMessage("Quầy này chưa được gán Agent.");
      return;
    }

    const confirmed = confirm(
      `Chuyển ticket ${detail.queue_number} sang ${targetCounter.counter_name}?\n\n` +
        `Agent nhận: Agent của ${targetCounter.counter_name}\n` +
        `Trạng thái quầy: ${targetCounter.status === "BUSY" ? "Đang bận" : "Sẵn sàng"}\n\n` +
        `Ticket sẽ quay về hàng chờ của Agent quầy đích.`
    );

    if (!confirmed) return;

    setTransferring(true);
    setErrorMessage(null);

    const { error } = await supabase.rpc("transfer_ticket_to_counter", {
      p_ticket_id: detail.ticket_id,
      p_target_counter_id: targetCounterId,
    });

    setTransferring(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setShowTransfer(false);
    setTargetCounterId("");

    router.push("/agent/queue");
  }

  if (loading) {
    return <p className="font-body text-ink/50">Đang tải...</p>;
  }

  if (!detail) {
    return (
      <p className="font-body text-danger">
        Không tìm thấy ticket này.
      </p>
    );
  }

  const isMine = detail.assigned_agent_id === profile?.id;

  const canAct =
    isMine ||
    profile?.role === "supervisor" ||
    profile?.role === "admin";

  return (
    <div className="max-w-4xl space-y-6">
      <button
        onClick={() => router.push("/agent/queue")}
        className="font-body text-sm text-brand-700 underline underline-offset-2"
      >
        ← Quay lại Queue
      </button>

      <div className="flex items-center justify-between">
        <div>
          <p className="font-body text-sm text-ink/50">
            {detail.ticket_code}
          </p>

          <h1 className="font-display text-4xl font-bold text-brand-900">
            {detail.queue_number}
          </h1>
        </div>

        <StatusBadge status={detail.status} />
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Panel title="Thông tin tài xế">
          <p className="mb-3 font-body text-base font-semibold text-ink">
            {detail.sap_id ?? "—"} - {detail.driver_name} -{" "}
            {detail.driver_type ?? "—"}
          </p>

          <dl className="space-y-2 font-body text-sm">
            <Row
              label="Trạng thái"
              value={detail.work_status ?? "—"}
            />

            <Row
              label="Trạng thái Tài khoản"
              value={detail.account_status ?? "—"}
            />

            <Row
              label="Lý do khóa"
              value={detail.lock_reason ?? "—"}
            />
          </dl>

          <div className="mt-3 space-y-1.5 border-t border-line pt-3 font-body text-sm">
            <p>
              Link Green Portal -{" "}
              {detail.driver_code ? (
                <a
                  href={`https://greentaxi.xanhsm.com/app/driver/${detail.driver_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-brand-700 underline"
                >
                  {`https://greentaxi.xanhsm.com/app/driver/${detail.driver_code}`}
                </a>
              ) : (
                "—"
              )}
            </p>

            <p>
              Link Admin Portal -{" "}
              {detail.app_code ? (
                <a
                  href={`https://admin-customer.xanhsm.com/drivers/${detail.app_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-brand-700 underline"
                >
                  {`https://admin-customer.xanhsm.com/drivers/${detail.app_code}`}
                </a>
              ) : (
                "—"
              )}
            </p>
          </div>
        </Panel>

        <Panel title="Thông tin Visit">
          <dl className="space-y-2 font-body text-sm">
            <Row label="Visit ID" value={detail.visit_code} />
            <Row label="VP" value={detail.branch_name} />
            <Row label="Check-in" value={fmt(detail.checkin_at)} />
            <Row label="Số queue" value={detail.queue_number} />
          </dl>
        </Panel>

        <Panel title="Thông tin yêu cầu">
          <dl className="space-y-2 font-body text-sm">
            <Row
              label="Category"
              value={detail.category_name}
            />

            <Row
              label="Subcategory"
              value={detail.subcategory_name ?? "—"}
            />
          </dl>

          {detail.description && (
            <p className="mt-3 rounded-lg bg-paper px-3 py-2 font-body text-sm text-ink/80">
              {detail.description}
            </p>
          )}
        </Panel>

        <Panel title="Lịch sử">
          <ol className="space-y-3 font-body text-sm">
            {history.map((h) => (
              <li
                key={h.id}
                className="border-l-2 border-brand-100 pl-3"
              >
                <p className="text-ink/50">
                  {fmt(h.created_at)}
                </p>

                <p className="font-medium text-ink">
                  {HISTORY_LABELS[h.action] ?? h.action}
                  {h.new_status ? ` → ${h.new_status}` : ""}
                </p>

                {h.note && (
                  <p className="mt-1 text-ink/60">
                    {h.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {(detail.status === "CALLED" ||
        detail.status === "TRANSFERRED") &&
        canAct && (
          <Panel>
            <div className="flex flex-wrap gap-3">
              <PrimaryButton
                onClick={handleStartProcessing}
                disabled={busy}
              >
                BẮT ĐẦU XỬ LÝ
              </PrimaryButton>

              {detail.status === "CALLED" && (
                <SecondaryButton
                  onClick={handleNoShow}
                  disabled={busy}
                >
                  Tài xế không đến (NO_SHOW)
                </SecondaryButton>
              )}
            </div>
          </Panel>
        )}

      {detail.status === "PENDING" && (
        <Panel title="Đang tạm hoãn (Pending)">
          <dl className="mb-4 space-y-2 font-body text-sm">
            <Row
              label="Lý do"
              value={detail.pending_reason ?? "—"}
            />

            <Row
              label="Bước tiếp theo"
              value={detail.pending_next_step ?? "—"}
            />

            <Row
              label="Ngày dự kiến"
              value={detail.pending_expected_at ?? "—"}
            />
          </dl>

          {canAct && (
            <PrimaryButton
              onClick={handleResume}
              disabled={busy}
            >
              TIẾP TỤC XỬ LÝ
            </PrimaryButton>
          )}
        </Panel>
      )}

      {detail.status === "PROCESSING" && canAct && (
        <>
          <Panel title="Hoàn tất xử lý">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block font-body text-sm text-ink/70">
                  Kết quả xử lý
                </label>

                <textarea
                  rows={3}
                  value={resolution}
                  onChange={(e) =>
                    setResolution(e.target.value)
                  }
                  placeholder="Ví dụ: Đã kiểm tra trạng thái thanh toán và hướng dẫn tài xế."
                  className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                />
              </div>

              <div>
                <label className="mb-1 block font-body text-sm text-ink/70">
                  Ghi chú nội bộ
                </label>

                <textarea
                  rows={2}
                  value={internalNote}
                  onChange={(e) =>
                    setInternalNote(e.target.value)
                  }
                  placeholder="Ví dụ: Tài xế đã xác nhận hiểu."
                  className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <PrimaryButton
                  onClick={handleResolve}
                  disabled={busy}
                >
                  HOÀN TẤT XỬ LÝ
                </PrimaryButton>

                <SecondaryButton
                  onClick={() =>
                    setShowPending((v) => !v)
                  }
                  disabled={busy}
                >
                  Đặt Pending
                </SecondaryButton>

                <SecondaryButton
                  onClick={() =>
                    setShowTransfer((v) => !v)
                  }
                  disabled={busy || transferring}
                >
                  Chuyển ticket
                </SecondaryButton>
              </div>
            </div>
          </Panel>

          {showPending && (
            <Panel title="Đặt Pending">
              <div className="space-y-4">
                <Field label="Lý do Pending *">
                  <input
                    value={pendingReason}
                    onChange={(e) =>
                      setPendingReason(e.target.value)
                    }
                    placeholder="Ví dụ: Đang chờ Finance xác nhận giao dịch."
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>

                <Field label="Bước tiếp theo *">
                  <input
                    value={pendingNextStep}
                    onChange={(e) =>
                      setPendingNextStep(e.target.value)
                    }
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>

                <Field label="Ngày dự kiến xử lý (tuỳ chọn)">
                  <input
                    type="date"
                    value={pendingExpected}
                    onChange={(e) =>
                      setPendingExpected(e.target.value)
                    }
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>

                <PrimaryButton
                  onClick={handleSetPending}
                  disabled={busy}
                >
                  XÁC NHẬN PENDING
                </PrimaryButton>
              </div>
            </Panel>
          )}

          {showTransfer && (
            <Panel title="Chuyển ticket sang quầy khác">
              <div className="space-y-4">
                <div className="rounded-lg bg-orange-50 px-4 py-3 font-body text-sm text-orange-800">
                  <p className="font-semibold">
                    Tài xế chọn sai chủ đề?
                  </p>

                  <p className="mt-1">
                    Chọn quầy đúng. Ticket sẽ quay về hàng chờ
                    của Agent thuộc quầy đó.
                  </p>
                </div>

                <Field label="Chọn quầy nhận ticket *">
                  <select
                    value={targetCounterId}
                    onChange={(e) =>
                      setTargetCounterId(e.target.value)
                    }
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  >
                    <option value="">
                      -- Chọn quầy --
                    </option>

                    {counters.map((counter) => (
                      <option
                        key={counter.id}
                        value={counter.id}
                        disabled={!counter.default_agent_id}
                      >
                        {counter.counter_name} (
                        {counter.status === "BUSY"
                          ? "Đang bận"
                          : counter.status === "AVAILABLE"
                            ? "Sẵn sàng"
                            : counter.status}
                        )
                        {!counter.default_agent_id
                          ? " - Chưa gán Agent"
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                {targetCounterId && (
                  <div className="rounded-lg border border-line bg-paper px-4 py-3 font-body text-sm">
                    {(() => {
                      const counter = counters.find(
                        (c) => c.id === targetCounterId
                      );

                      if (!counter) return null;

                      return (
                        <>
                          <p>
                            <span className="text-ink/50">
                              Quầy:
                            </span>{" "}
                            <strong>
                              {counter.counter_name}
                            </strong>
                          </p>

                          <p className="mt-1">
                            <span className="text-ink/50">
                              Trạng thái:
                            </span>{" "}
                            <strong>
                              {counter.status === "BUSY"
                                ? "Đang bận"
                                : counter.status ===
                                    "AVAILABLE"
                                  ? "Sẵn sàng"
                                  : counter.status}
                            </strong>
                          </p>

                          <p className="mt-1 text-ink/60">
                            Ticket vẫn được nhận và chờ Agent
                            của quầy xử lý.
                          </p>
                        </>
                      );
                    })()}
                  </div>
                )}

                <div className="flex gap-3">
                  <PrimaryButton
                    onClick={handleTransferToCounter}
                    disabled={
                      transferring ||
                      busy ||
                      !targetCounterId
                    }
                  >
                    {transferring
                      ? "ĐANG CHUYỂN..."
                      : "XÁC NHẬN CHUYỂN QUẦY"}
                  </PrimaryButton>

                  <SecondaryButton
                    onClick={() => {
                      setShowTransfer(false);
                      setTargetCounterId("");
                    }}
                    disabled={transferring}
                  >
                    HỦY
                  </SecondaryButton>
                </div>
              </div>
            </Panel>
          )}
        </>
      )}

      {detail.status === "RESOLVED" && (
        <Panel title="Kết quả xử lý">
          <p className="font-body text-sm text-ink/80">
            {detail.resolution}
          </p>

          {detail.internal_note && (
            <p className="mt-2 font-body text-sm text-ink/50">
              Ghi chú nội bộ: {detail.internal_note}
            </p>
          )}

          {canAct && (
            <div className="mt-4">
              <SecondaryButton
                onClick={handleClose}
                disabled={busy}
              >
                ĐÓNG TICKET
              </SecondaryButton>
            </div>
          )}
        </Panel>
      )}

      {detail.status === "CLOSED" && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <div className="flex flex-col items-center gap-4 text-center">
            <div>
              <h3 className="text-lg font-semibold text-ink">
                Đánh giá dịch vụ
              </h3>

              <p className="mt-1 text-sm text-ink/60">
                Mời tài xế quét mã QR để đánh giá dịch vụ.
              </p>
            </div>

            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
                `${window.location.origin}/feedback/${encodeURIComponent(
                  detail.ticket_code
                )}`
              )}`}
              alt="QR đánh giá dịch vụ"
              className="h-64 w-64 rounded-xl border border-gray-200 bg-white p-2"
            />

            <p className="text-sm font-medium text-ink">
              Ticket: {detail.ticket_code}
            </p>
          </div>
        </div>
      )}

      {detail.status === "CLOSED" && (
        <Panel title="Kết quả xử lý">
          <p className="font-body text-sm text-ink/80">
            {detail.resolution}
          </p>

          <p className="mt-2 font-body text-xs text-ink/40">
            Đã đóng lúc {fmt(detail.closed_at)}
          </p>
        </Panel>
      )}

      {detail.status === "NO_SHOW" && (
        <Panel title="Tài xế không đến">
          <p className="font-body text-sm text-ink/70">
            Ticket đã được gọi nhưng tài xế không có mặt tại
            quầy.
          </p>
        </Panel>
      )}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink/50">{label}</dt>

      <dd className="text-right font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block font-body text-sm text-ink/70">
        {label}
      </label>

      {children}
    </div>
  );
}
