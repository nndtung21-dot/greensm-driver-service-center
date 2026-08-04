"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  AgentCategoryAssignment,
  AgentWithBranch,
  ServiceCategory,
} from "@/lib/types";

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<AgentWithBranch[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [assignments, setAssignments] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const key = (agentId: string, categoryId: string) => `${agentId}:${categoryId}`;

  const load = useCallback(async () => {
    const [{ data: agentRows }, { data: categoryRows }, { data: assignmentRows }, { data: branchRows }] =
      await Promise.all([
        supabase.from("profiles").select("id, full_name, email, branch_id").eq("role", "agent"),
        supabase
          .from("service_categories")
          .select("id, name, code, display_order")
          .eq("status", "ACTIVE")
          .order("display_order"),
        supabase.from("agent_category_assignments").select("agent_id, category_id"),
        supabase.from("branches").select("id, branch_name"),
      ]);

    const branchMap = new Map((branchRows ?? []).map((b: { id: string; branch_name: string }) => [b.id, b.branch_name]));
    const agentsWithBranch = ((agentRows as AgentWithBranch[]) ?? []).map((a) => ({
      ...a,
      branch_name: a.branch_id ? branchMap.get(a.branch_id) : undefined,
    }));

    setAgents(agentsWithBranch);
    setCategories((categoryRows as ServiceCategory[]) ?? []);
    setAssignments(
      new Set(
        ((assignmentRows as AgentCategoryAssignment[]) ?? []).map((a) =>
          key(a.agent_id, a.category_id)
        )
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(agentId: string, categoryId: string) {
    const k = key(agentId, categoryId);
    setSavingKey(k);
    setErrorMessage(null);
    const isAssigned = assignments.has(k);

    if (isAssigned) {
      const { error } = await supabase
        .from("agent_category_assignments")
        .delete()
        .eq("agent_id", agentId)
        .eq("category_id", categoryId);
      if (error) {
        setErrorMessage(error.message);
      } else {
        setAssignments((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }
    } else {
      const { error } = await supabase
        .from("agent_category_assignments")
        .insert({ agent_id: agentId, category_id: categoryId });
      if (error) {
        setErrorMessage(error.message);
      } else {
        setAssignments((prev) => new Set(prev).add(k));
      }
    }
    setSavingKey(null);
  }

  if (loading) {
    return <p className="font-body text-ink/50">Đang tải...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900">
          Agent ↔ Chủ đề phụ trách
        </h1>
        <p className="mt-1 font-body text-sm text-ink/60">
          Tích chọn để đánh dấu Agent đó phụ trách chủ đề tương ứng. Đây là thông
          tin tham khảo/tổ chức — hiện chưa dùng để giới hạn &quot;Gọi tiếp
          theo&quot; (mọi Agent vẫn gọi được mọi ticket trong VP của mình).
        </p>
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-line bg-white">
        <table className="w-full text-left font-body text-sm">
          <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="sticky left-0 bg-paper/60 px-4 py-3">Agent</th>
              <th className="px-4 py-3">VP</th>
              {categories.map((c) => (
                <th key={c.id} className="px-3 py-3 text-center">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={2 + categories.length} className="px-4 py-6 text-center text-ink/40">
                  Chưa có Agent nào.
                </td>
              </tr>
            )}
            {agents.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="sticky left-0 bg-white px-4 py-3">
                  <p className="font-medium text-ink">{a.full_name}</p>
                  <p className="text-xs text-ink/50">{a.email}</p>
                </td>
                <td className="px-4 py-3 text-ink/70">{a.branch_name ?? "—"}</td>
                {categories.map((c) => {
                  const k = key(a.id, c.id);
                  const checked = assignments.has(k);
                  return (
                    <td key={c.id} className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingKey === k}
                        onChange={() => toggle(a.id, c.id)}
                        className="h-5 w-5 accent-brand-700 disabled:opacity-40"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
