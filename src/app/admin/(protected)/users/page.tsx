"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AdminProfileRow, Branch, Department, PendingUser, UserRole } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton } from "@/components/agent/ui";

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<AdminProfileRow[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // form state for onboarding a pending user
  const [onboardName, setOnboardName] = useState<Record<string, string>>({});
  const [onboardRole, setOnboardRole] = useState<Record<string, UserRole>>({});
  const [onboardBranch, setOnboardBranch] = useState<Record<string, string>>({});
  const [onboardDept, setOnboardDept] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [{ data: p }, { data: pu }, { data: b }, { data: d }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, branch_id, department_id, status"),
      supabase.rpc("admin_list_pending_users"),
      supabase.from("branches").select("id, branch_code, branch_name"),
      supabase.from("departments").select("id, name"),
    ]);
    setProfiles((p as AdminProfileRow[]) ?? []);
    setPending((pu as PendingUser[]) ?? []);
    setBranches(b ?? []);
    setDepartments(d ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateProfile(id: string, patch: Partial<AdminProfileRow>) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) setErrorMessage(error.message);
    else load();
  }

  async function onboard(userId: string, email: string) {
    const full_name = onboardName[userId]?.trim();
    const role = onboardRole[userId] ?? "agent";
    if (!full_name) {
      setErrorMessage("Vui lòng nhập họ tên trước khi thêm.");
      return;
    }
    const { error } = await supabase.from("profiles").insert({
      id: userId,
      full_name,
      email,
      role,
      branch_id: onboardBranch[userId] || null,
      department_id: onboardDept[userId] || null,
    });
    if (error) setErrorMessage(error.message);
    else load();
  }

  if (loading) return <p className="font-body text-ink/50">Đang tải...</p>;

  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="font-display text-2xl font-bold text-brand-900">Người dùng</h1>
      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">{errorMessage}</p>
      )}

      {pending.length > 0 && (
        <Panel title="Tài khoản mới tạo, chưa gán vai trò">
          <p className="mb-3 font-body text-xs text-ink/50">
            Đây là các tài khoản bạn vừa tạo bên Supabase Dashboard (Authentication →
            Users) nhưng chưa gán vai trò/VP. Điền thông tin rồi bấm Thêm.
          </p>
          <div className="space-y-4">
            {pending.map((u) => (
              <div key={u.id} className="flex flex-wrap items-end gap-2 border-b border-line pb-3">
                <span className="w-56 font-body text-sm text-ink">{u.email}</span>
                <input
                  placeholder="Họ tên"
                  value={onboardName[u.id] ?? ""}
                  onChange={(e) => setOnboardName((p) => ({ ...p, [u.id]: e.target.value }))}
                  className="w-40 rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
                />
                <select
                  value={onboardRole[u.id] ?? "agent"}
                  onChange={(e) =>
                    setOnboardRole((p) => ({ ...p, [u.id]: e.target.value as UserRole }))
                  }
                  className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
                >
                  <option value="agent">Agent</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
                <select
                  value={onboardBranch[u.id] ?? ""}
                  onChange={(e) => setOnboardBranch((p) => ({ ...p, [u.id]: e.target.value }))}
                  className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
                >
                  <option value="">VP...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.branch_name}
                    </option>
                  ))}
                </select>
                <select
                  value={onboardDept[u.id] ?? ""}
                  onChange={(e) => setOnboardDept((p) => ({ ...p, [u.id]: e.target.value }))}
                  className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
                >
                  <option value="">Bộ phận...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <SecondaryButton
                  onClick={() => onboard(u.id, u.email)}
                  className="px-3 py-1.5 text-xs"
                >
                  + Thêm
                </SecondaryButton>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Toàn bộ nhân viên">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink/50">
              <tr>
                <th className="py-2 pr-3">Tên</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Vai trò</th>
                <th className="py-2 pr-3">VP</th>
                <th className="py-2 pr-3">Bộ phận</th>
                <th className="py-2 pr-3">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">{p.full_name}</td>
                  <td className="py-2 pr-3 text-ink/60">{p.email}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={p.role}
                      onChange={(e) => updateProfile(p.id, { role: e.target.value as UserRole })}
                      className="rounded-lg border-2 border-line px-2 py-1 text-xs"
                    >
                      <option value="agent">Agent</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={p.branch_id ?? ""}
                      onChange={(e) => updateProfile(p.id, { branch_id: e.target.value || null })}
                      className="rounded-lg border-2 border-line px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.branch_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={p.department_id ?? ""}
                      onChange={(e) =>
                        updateProfile(p.id, { department_id: e.target.value || null })
                      }
                      className="rounded-lg border-2 border-line px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() =>
                        updateProfile(p.id, {
                          status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        })
                      }
                      className="font-body text-xs text-brand-700 underline"
                    >
                      {p.status}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="font-body text-xs text-ink/40">
        Muốn xoá hẳn 1 tài khoản: vào Supabase Dashboard → Authentication → Users
        → xoá ở đó (không xoá qua trang này) để tránh mồ côi dữ liệu đăng nhập.
      </p>
    </div>
  );
}
