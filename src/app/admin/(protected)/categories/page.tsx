"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ServiceCategory, ServiceSubcategory } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton } from "@/components/agent/ui";

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<(ServiceCategory & { status: string })[]>([]);
  const [subcategories, setSubcategories] = useState<(ServiceSubcategory & { status: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCatName, setNewCatName] = useState("");
  const [newCatCode, setNewCatCode] = useState("");
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [newSubCode, setNewSubCode] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: cats }, { data: subs }] = await Promise.all([
      supabase.from("service_categories").select("*").order("display_order"),
      supabase.from("service_subcategories").select("*").order("display_order"),
    ]);
    setCategories(cats ?? []);
    setSubcategories(subs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCatName.trim() || !newCatCode.trim()) return;
    const { error } = await supabase.from("service_categories").insert({
      name: newCatName.trim(),
      code: newCatCode.trim().toUpperCase().replace(/\s+/g, "_"),
      display_order: categories.length + 1,
    });
    if (error) setErrorMessage(error.message);
    else {
      setNewCatName("");
      setNewCatCode("");
      load();
    }
  }

  async function toggleCategory(id: string, status: string) {
    await supabase
      .from("service_categories")
      .update({ status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
      .eq("id", id);
    load();
  }

  async function addSubcategory(categoryId: string) {
    const name = newSubName[categoryId]?.trim();
    const code = newSubCode[categoryId]?.trim();
    if (!name || !code) return;
    const countExisting = subcategories.filter((s) => s.category_id === categoryId).length;
    const { error } = await supabase.from("service_subcategories").insert({
      category_id: categoryId,
      name,
      code: code.toUpperCase().replace(/\s+/g, "_"),
      display_order: countExisting + 1,
    });
    if (error) setErrorMessage(error.message);
    else {
      setNewSubName((p) => ({ ...p, [categoryId]: "" }));
      setNewSubCode((p) => ({ ...p, [categoryId]: "" }));
      load();
    }
  }

  async function toggleSubcategory(id: string, status: string) {
    await supabase
      .from("service_subcategories")
      .update({ status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
      .eq("id", id);
    load();
  }

  if (loading) return <p className="font-body text-ink/50">Đang tải...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold text-brand-900">Danh mục dịch vụ</h1>
      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">{errorMessage}</p>
      )}

      <Panel title="Thêm danh mục mới">
        <form onSubmit={addCategory} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Tên</label>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="vd: Bảo hiểm"
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Mã (code)</label>
            <input
              value={newCatCode}
              onChange={(e) => setNewCatCode(e.target.value)}
              placeholder="vd: INSURANCE"
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <PrimaryButton type="submit" className="px-4 py-2 text-sm">
            Thêm
          </PrimaryButton>
        </form>
      </Panel>

      <div className="space-y-4">
        {categories.map((cat) => (
          <Panel key={cat.id}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-display text-lg font-semibold text-brand-900">{cat.name}</p>
                <p className="font-body text-xs text-ink/50">{cat.code}</p>
              </div>
              <SecondaryButton
                onClick={() => toggleCategory(cat.id, cat.status)}
                className="px-3 py-1.5 text-xs"
              >
                {cat.status === "ACTIVE" ? "Tắt" : "Bật lại"}
              </SecondaryButton>
            </div>
            <div className="space-y-1 pl-2">
              {subcategories
                .filter((s) => s.category_id === cat.id)
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-1">
                    <span className="font-body text-sm text-ink">
                      {s.name}{" "}
                      <span className="text-ink/40">
                        ({s.status === "ACTIVE" ? "đang bật" : "đã tắt"})
                      </span>
                    </span>
                    <button
                      onClick={() => toggleSubcategory(s.id, s.status)}
                      className="font-body text-xs text-brand-700 underline"
                    >
                      {s.status === "ACTIVE" ? "Tắt" : "Bật lại"}
                    </button>
                  </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <input
                value={newSubName[cat.id] ?? ""}
                onChange={(e) => setNewSubName((p) => ({ ...p, [cat.id]: e.target.value }))}
                placeholder="Tên danh mục con mới"
                className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
              />
              <input
                value={newSubCode[cat.id] ?? ""}
                onChange={(e) => setNewSubCode((p) => ({ ...p, [cat.id]: e.target.value }))}
                placeholder="Mã"
                className="w-28 rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
              />
              <SecondaryButton
                onClick={() => addSubcategory(cat.id)}
                className="px-3 py-1.5 text-xs"
              >
                + Thêm
              </SecondaryButton>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
