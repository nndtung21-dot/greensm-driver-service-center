"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Branch, ServiceCategory, ServiceSubcategory, SlaRule } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton } from "@/components/agent/ui";

export default function AdminSlaPage() {
  const [rules, setRules] = useState<SlaRule[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: r }, { data: b }, { data: c }, { data: s }] = await Promise.all([
      supabase.from("sla_rules").select("*"),
      supabase.from("branches").select("id, branch_code, branch_name"),
      supabase.from("service_categories").select("id, name, code, display_order"),
      supabase.from("service_subcategories").select("id, category_id, name, code, display_order"),
    ]);
    setRules(r ?? []);
    setBranches(b ?? []);
    setCategories(c ?? []);
    setSubcategories(s ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function nameOf(list: { id: string; name?: string; branch_name?: string }[], id: string | null) {
    if (!id) return "Tất cả";
    const item = list.find((x) => x.id === id);
    return item?.name ?? item?.branch_name ?? "—";
  }

  async function addRule(e: FormEvent) {
    e.preventDefault();
    const mins = parseInt(minutes, 10);
    if (!mins || mins <= 0) return;
    const { error } = await supabase.from("sla_rules").insert({
      branch_id: branchId || null,
      category_id: categoryId || null,
      subcategory_id: subcategoryId || null,
      sla_minutes: mins,
    });
    if (error) setErrorMessage(error.message);
    else {
      setBranchId("");
      setCategoryId("");
      setSubcategoryId("");
      setMinutes("30");
      load();
    }
  }

  async function toggleRule(id: string, status: string) {
    await supabase
      .from("sla_rules")
      .update({ status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
      .eq("id", id);
    load();
  }

  if (loading) return <p className="font-body text-ink/50">Đang tải...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-brand-900">Cấu hình SLA</h1>
      <p className="font-body text-sm text-ink/60">
        Để trống VP/Category/Subcategory nghĩa là áp dụng cho tất cả. Rule càng
        cụ thể (điền càng nhiều trường) sẽ được ưu tiên áp dụng trước.
      </p>
      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">{errorMessage}</p>
      )}

      <Panel title="Thêm rule mới">
        <form onSubmit={addRule} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">VP (tuỳ chọn)</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            >
              <option value="">Tất cả</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Category (tuỳ chọn)</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            >
              <option value="">Tất cả</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Subcategory (tuỳ chọn)</label>
            <select
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            >
              <option value="">Tất cả</option>
              {subcategories
                .filter((s) => !categoryId || s.category_id === categoryId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Số phút SLA</label>
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-24 rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <PrimaryButton type="submit" className="px-4 py-2 text-sm">
            Thêm
          </PrimaryButton>
        </form>
      </Panel>

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <table className="w-full text-left font-body text-sm">
          <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">VP</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Subcategory</th>
              <th className="px-4 py-3">Phút</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{nameOf(branches, r.branch_id)}</td>
                <td className="px-4 py-3">{nameOf(categories, r.category_id)}</td>
                <td className="px-4 py-3">{nameOf(subcategories, r.subcategory_id)}</td>
                <td className="px-4 py-3 font-semibold">{r.sla_minutes}</td>
                <td className="px-4 py-3">{r.status}</td>
                <td className="px-4 py-3">
                  <SecondaryButton
                    onClick={() => toggleRule(r.id, r.status)}
                    className="px-3 py-1 text-xs"
                  >
                    {r.status === "ACTIVE" ? "Tắt" : "Bật lại"}
                  </SecondaryButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
