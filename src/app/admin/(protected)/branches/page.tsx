"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Branch, Counter } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton } from "@/components/agent/ui";

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<(Branch & { status: string })[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBranchCode, setNewBranchCode] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newCounterCode, setNewCounterCode] = useState<Record<string, string>>({});
  const [newCounterName, setNewCounterName] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: br }, { data: co }] = await Promise.all([
      supabase.from("branches").select("*").order("branch_code"),
      supabase.from("counters").select("*").order("counter_code"),
    ]);
    setBranches(br ?? []);
    setCounters(co ?? []);
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

  if (loading) return <p className="font-body text-ink/50">Đang tải...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-brand-900">Văn phòng & Quầy</h1>
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
              <SecondaryButton
                onClick={() => toggleBranch(b.id, b.status)}
                className="px-3 py-1.5 text-xs"
              >
                {b.status === "ACTIVE" ? "Tắt" : "Bật lại"}
              </SecondaryButton>
            </div>
            <div className="space-y-1 pl-2">
              {counters
                .filter((c) => c.branch_id === b.id)
                .map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-1 font-body text-sm">
                    <span>{c.counter_name}</span>
                    <span className="text-xs text-ink/40">{c.status}</span>
                  </div>
                ))}
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
