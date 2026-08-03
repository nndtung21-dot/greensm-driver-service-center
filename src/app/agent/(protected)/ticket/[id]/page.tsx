"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import { AgentOption, CaseDetail, CaseHistoryEntry, Department, Profile } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton, StatusBadge } from "@/components/agent/ui";

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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [colleagues, setColleagues] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [resolution, setResolution] = useState("");
  const [internalNote, setInternalNote] = useState("");

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferDept, setTransferDept] = useState("");
  const [transferAgent, setTransferAgent] = useState("");
  const [transferReason, setTransferReason] = useState("");

  const [showPending, setShowPending] = useState(false);
  const [pendingReason, setPendingReason] = useState("");
  const [pendingNextStep, setPendingNextStep] = useState("");
  const [pendingExpected, setPendingExpected] = useState("");

  const load = useCallback(async () => {
    const [{ data: caseData }, { data: historyData }] = await Promise.all([
      supabase.from("v_case_detail").select("*").eq("case_id", params.id).maybeSingle(),
      supabase
        .from("case_history")
        .select("id, action, old_status, new_status, note, created_at, performed_by")
        .eq("case_id", params.id)
        .order("created_at", { ascending: true }),
    ]);
    setDetail((caseData as CaseDetail) ?? null);
    setHistory((historyData as CaseHistoryEntry[]) ?? []);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    getCurrentProfile().then(setProfile);
    load();
    supabase
      .from("departments")
      .select("id, name")
      .then(({ data }) => setDepartments((data as Department[]) ?? []));
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("role", "agent")
      .then(({ data }) => setColleagues((data as AgentOption[]) ?? []));
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`case-${params.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_cases", filter: `id=eq.${params.id}` },
        load
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [params.id, load]);

  async function runRpc(name: string, args: Record<string, unknown>, after?: () => void) {
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

  const handleStartProcessing = () => runRpc("start_processing", { p_case_id: params.id });
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
  const handleClose = () => runRpc("close_case", { p_case_id: params.id });
  const handleResume = () => runRpc("resume_case", { p_case_id: params.id });

  const handleTransfer = () => {
    if (!transferDept || !transferReason.trim()) {
      setErrorMessage("Vui lòng chọn bộ phận và nhập lý do chuyển.");
      return;
    }
    runRpc(
      "transfer_case",
      {
        p_case_id: params.id,
        p_to_department_id: transferDept,
        p_to_agent_id: transferAgent || null,
        p_reason: transferReason.trim(),
      },
      () => setShowTransfer(false)
    );
  };

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
      () => setShowPending(false)
    );
  };

  if (loading) {
    return <p className="font-body text-ink/50">Đang tải...</p>;
  }
  if (!detail) {
    return <p className="font-body text-danger">Không tìm thấy ticket này.</p>;
  }

  const isMine = detail.assigned_agent_id === profile?.id;
  const canAct = isMine || profile?.role === "supervisor" || profile?.role === "admin";

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
          <p className="font-body text-sm text-ink/50">{detail.ticket_code}</p>
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
          <dl className="space-y-2 font-body text-sm">
            <Row label="Tên" value={detail.driver_name} />
            <Row label="SAP ID" value={detail.sap_id ?? "—"} />
            <Row label="Loại hợp đồng" value={detail.contract_type ?? "—"} />
            <Row label="Loại xe" value={detail.vehicle_type ?? "—"} />
          </dl>
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
            <Row label="Category" value={detail.category_name} />
            <Row label="Subcategory" value={detail.subcategory_name ?? "—"} />
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
              <li key={h.id} className="border-l-2 border-brand-100 pl-3">
                <p className="text-ink/50">{fmt(h.created_at)}</p>
                <p className="font-medium text-ink">
                  {HISTORY_LABELS[h.action] ?? h.action}
                  {h.new_status ? ` → ${h.new_status}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {(detail.status === "CALLED" || detail.status === "TRANSFERRED") && canAct && (
        <Panel>
          <PrimaryButton onClick={handleStartProcessing} disabled={busy}>
            BẮT ĐẦU XỬ LÝ
          </PrimaryButton>
        </Panel>
      )}

      {detail.status === "PENDING" && (
        <Panel title="Đang tạm hoãn (Pending)">
          <dl className="mb-4 space-y-2 font-body text-sm">
            <Row label="Lý do" value={detail.pending_reason ?? "—"} />
            <Row label="Bước tiếp theo" value={detail.pending_next_step ?? "—"} />
            <Row label="Ngày dự kiến" value={detail.pending_expected_at ?? "—"} />
          </dl>
          {canAct && (
            <PrimaryButton onClick={handleResume} disabled={busy}>
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
                  onChange={(e) => setResolution(e.target.value)}
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
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Ví dụ: Tài xế đã xác nhận hiểu."
                  className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <PrimaryButton onClick={handleResolve} disabled={busy}>
                  HOÀN TẤT XỬ LÝ
                </PrimaryButton>
                <SecondaryButton onClick={() => setShowPending((v) => !v)} disabled={busy}>
                  Đặt Pending
                </SecondaryButton>
                <SecondaryButton onClick={() => setShowTransfer((v) => !v)} disabled={busy}>
                  Chuyển ticket
                </SecondaryButton>
              </div>
            </div>
          </Panel>

          {showPending && (
            <Panel title="Đặt Pending (Section 22)">
              <div className="space-y-4">
                <Field label="Lý do Pending *">
                  <input
                    value={pendingReason}
                    onChange={(e) => setPendingReason(e.target.value)}
                    placeholder="Ví dụ: Đang chờ Finance xác nhận giao dịch."
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>
                <Field label="Bước tiếp theo *">
                  <input
                    value={pendingNextStep}
                    onChange={(e) => setPendingNextStep(e.target.value)}
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>
                <Field label="Ngày dự kiến xử lý (tuỳ chọn)">
                  <input
                    type="date"
                    value={pendingExpected}
                    onChange={(e) => setPendingExpected(e.target.value)}
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>
                <PrimaryButton onClick={handleSetPending} disabled={busy}>
                  XÁC NHẬN PENDING
                </PrimaryButton>
              </div>
            </Panel>
          )}

          {showTransfer && (
            <Panel title="Chuyển ticket (Section 23)">
              <div className="space-y-4">
                <Field label="Chuyển sang bộ phận *">
                  <select
                    value={transferDept}
                    onChange={(e) => setTransferDept(e.target.value)}
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  >
                    <option value="">-- Chọn bộ phận --</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Chuyển cho Agent (tuỳ chọn)">
                  <select
                    value={transferAgent}
                    onChange={(e) => setTransferAgent(e.target.value)}
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  >
                    <option value="">-- Để trống, chờ ai đó nhận --</option>
                    {colleagues.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name} ({a.email})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Lý do chuyển *">
                  <input
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                    placeholder="Ví dụ: Cần kiểm tra giao dịch thanh toán."
                    className="w-full rounded-lg border-2 border-line px-4 py-3 font-body text-sm focus:border-brand-700"
                  />
                </Field>
                <PrimaryButton onClick={handleTransfer} disabled={busy}>
                  XÁC NHẬN CHUYỂN
                </PrimaryButton>
              </div>
            </Panel>
          )}
        </>
      )}

      {detail.status === "RESOLVED" && (
        <Panel title="Kết quả xử lý">
          <p className="font-body text-sm text-ink/80">{detail.resolution}</p>
          {detail.internal_note && (
            <p className="mt-2 font-body text-sm text-ink/50">
              Ghi chú nội bộ: {detail.internal_note}
            </p>
          )}
          {canAct && (
            <div className="mt-4">
              <SecondaryButton onClick={handleClose} disabled={busy}>
                ĐÓNG TICKET
              </SecondaryButton>
            </div>
          )}
        </Panel>
      )}

      {detail.status === "CLOSED" && (
        <Panel title="Kết quả xử lý">
          <p className="font-body text-sm text-ink/80">{detail.resolution}</p>
          <p className="mt-2 font-body text-xs text-ink/40">
            Đã đóng lúc {fmt(detail.closed_at)}
          </p>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink/50">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block font-body text-sm text-ink/70">{label}</label>
      {children}
    </div>
  );
}
