"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AgentOption, Branch, Counter } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton, ToggleSwitch } from "@/components/agent/ui";

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<(Branch & { status: string })[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [agents, setAgents] = useState<(AgentOption & { branch_id: string | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBranchCode, setNewBranchCode] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newCounterCode, setNewCounterCode] = useState<Record<string, string>>({});
  const [newCounterName, setNewCounterName] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: br }, { data: co }, { data: ag }] = await Promise.all([
      supabase.from("branches").select("*").order("branch_code"),
      supabase.from("counters").select("*").order("counter_code"),
      supabase.from("profiles").select("id, full_name, email, role, branch_id").eq("role", "agent"),
    ]);
    setBranches(br ?? []);
    setCounters(co ?? []);
    setAgents(ag ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addBranch(e: FormEvent) {
    e.preventDefault();
    if (!newBranchCode.trim() || !newBranchName.trim()) return;
    const { error } = await supabase
      .from("branches")
      .insert({ branch_code: newBranchCode.trim().toUpperCase(), branch_name: newBranchName.trim() });
    if (error) setErrorMessage(error.message);
    else {
      setNewBranchCode("");
      setNewBranchName("");
      load();
    }
  }

  async function toggleBranch(id: string, status: string) {
    await supabase
      .from("branches")
      .update({ status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
      .eq("id", id);
    load();
  }

  async function addCounter(branchId: string) {
    const code = newCounterCode[branchId]?.trim();
    const name = newCounterName[branchId]?.trim();
    if (!code || !name) return;
    const { error } = await supabase
      .from("counters")
      .insert({ branch_id: branchId, counter_code: code, counter_name: name, status: "CLOSED" });
    if (error) setErrorMessage(error.message);
    else {
      setNewCounterCode((p) => ({ ...p, [branchId]: "" }));
      setNewCounterName((p) => ({ ...p, [branchId]: "" }));
      load();
    }
  }

  async function setCounterAgent(counterId: string, agentId: string) {
    const { error } = await supabase
      .from("counters")
      .update({ default_agent_id: agentId || null })
      .eq("id", counterId);
    if (error) setErrorMessage(error.message);
    else load();
  }

  async function deleteCounter(id: string, name: string) {
    if (!confirm(`Xoá quầy "${name}"? Không thể hoàn tác.`)) return;
    const { error } = await supabase.from("counters").delete().eq("id", id);
    if (error) setErrorMessage(error.message);
    else load();
  }

  if (loading) return <p className="font-body text-ink/50">Đang tải...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-brand-900">Văn phòng & Quầy</h1>
      <p className="font-body text-sm text-ink/60">
        Mỗi quầy có thể gán 1 Agent &quot;chủ&quot; — khi Agent đó bấm &quot;Gọi
        tiếp theo&quot;, hệ thống sẽ ưu tiên dùng đúng quầy này nếu đang trống,
        và màn hình TV sẽ hiển thị hàng chờ riêng của Agent đó dưới quầy này.
      </p>
      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">{errorMessage}</p>
      )}

      <Panel title="Thêm văn phòng mới">
        <form onSubmit={addBranch} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Mã VP</label>
            <input
              value={newBranchCode}
              onChange={(e) => setNewBranchCode(e.target.value)}
              placeholder="vd: DN01"
              className="w-28 rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Tên VP</label>
            <input
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="vd: Green SM - VP Đà Nẵng"
              className="w-72 rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <PrimaryButton type="submit" className="px-4 py-2 text-sm">
            Thêm
          </PrimaryButton>
        </form>
      </Panel>

      <div className="space-y-4">
        {branches.map((b) => (
          <Panel key={b.id}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-display text-lg font-semibold text-brand-900">{b.branch_name}</p>
                <p className="font-body text-xs text-ink/50">{b.branch_code}</p>
              </div>
              <ToggleSwitch
                checked={b.status === "ACTIVE"}
                onChange={() => toggleBranch(b.id, b.status)}
              />
            </div>
            <div className="space-y-2 pl-2">
              {counters
                .filter((c) => c.branch_id === b.id)
                .map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-1 font-body text-sm">
                    <span className="w-32">
                      {c.counter_name} <span className="text-xs text-ink/40">(mã: {c.counter_code})</span>
                    </span>
                    <span className="w-20 text-xs text-ink/40">{c.status}</span>
                    <select
                      value={c.default_agent_id ?? ""}
                      onChange={(e) => setCounterAgent(c.id, e.target.value)}
                      className="flex-1 rounded-lg border-2 border-line px-2 py-1 text-xs"
                    >
                      <option value="">— Chưa gán Agent —</option>
                      {agents
                        .filter((a) => a.branch_id === b.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.full_name}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => deleteCounter(c.id, c.counter_name)}
                      className="font-body text-xs text-danger underline"
                    >
                      Xoá
                    </button>
                  </div>
                ))}
              {counters.filter((c) => c.branch_id === b.id).length === 0 && (
                <p className="font-body text-xs text-ink/40">Chưa có quầy nào.</p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <input
                value={newCounterCode[b.id] ?? ""}
                onChange={(e) => setNewCounterCode((p) => ({ ...p, [b.id]: e.target.value }))}
                placeholder="Mã quầy (vd: 04)"
                className="w-28 rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
              />
              <input
                value={newCounterName[b.id] ?? ""}
                onChange={(e) => setNewCounterName((p) => ({ ...p, [b.id]: e.target.value }))}
                placeholder="Tên quầy (vd: Quầy 04)"
                className="w-40 rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
              />
              <SecondaryButton onClick={() => addCounter(b.id)} className="px-3 py-1.5 text-xs">
                + Thêm quầy
              </SecondaryButton>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
