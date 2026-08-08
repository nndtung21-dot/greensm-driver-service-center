"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AdminProfileRow, Branch, PendingUser, UserRole } from "@/lib/types";
import { Panel, PrimaryButton, SecondaryButton, ToggleSwitch } from "@/components/agent/ui";

async function callAdminApi(path: string, body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Có lỗi xảy ra.");
  return json;
}

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<AdminProfileRow[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form state for onboarding a pending user
  const [onboardName, setOnboardName] = useState<Record<string, string>>({});
  const [onboardRole, setOnboardRole] = useState<Record<string, UserRole>>({});
  const [onboardBranch, setOnboardBranch] = useState<Record<string, string>>({});

  // form state for creating a brand new account
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("agent");
  const [newBranch, setNewBranch] = useState("");

  const load = useCallback(async () => {
    const [{ data: p }, { data: pu }, { data: b }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, branch_id, department_id, status"),
      supabase.rpc("admin_list_pending_users"),
      supabase.from("branches").select("id, branch_code, branch_name"),
    ]);
    setProfiles((p as AdminProfileRow[]) ?? []);
    setPending((pu as PendingUser[]) ?? []);
    setBranches(b ?? []);
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
    });
    if (error) setErrorMessage(error.message);
    else load();
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword || !newName.trim()) {
      setErrorMessage("Vui lòng nhập đủ Email, Mật khẩu, Họ tên.");
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      await callAdminApi("/api/admin/create-user", {
        email: newEmail.trim(),
        password: newPassword,
        full_name: newName.trim(),
        role: newRole,
        branch_id: newBranch || null,
      });
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewRole("agent");
      setNewBranch("");
      load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteUser(id: string, name: string) {
    if (!confirm(`Xoá vĩnh viễn tài khoản "${name}"? Không thể hoàn tác.`)) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      await callAdminApi("/api/admin/delete-user", { user_id: id });
      load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="font-body text-ink/50">Đang tải...</p>;

  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="font-display text-2xl font-bold text-brand-900">Người dùng</h1>
      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">{errorMessage}</p>
      )}

      <Panel title="Tạo tài khoản mới">
        <form onSubmit={handleCreateUser} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-48 rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Mật khẩu</label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
              className="w-40 rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Họ tên</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-40 rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">Vai trò</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            >
              <option value="agent">Agent</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-body text-xs text-ink/60">VP</label>
            <select
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              className="rounded-lg border-2 border-line px-3 py-2 font-body text-sm"
            >
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.branch_name}
                </option>
              ))}
            </select>
          </div>
          <PrimaryButton type="submit" disabled={busy} className="px-4 py-2 text-sm">
            {busy ? "Đang tạo..." : "+ Tạo tài khoản"}
          </PrimaryButton>
        </form>
      </Panel>

      {pending.length > 0 && (
        <Panel title="Tài khoản tạo qua Supabase Dashboard, chưa gán vai trò">
          <p className="mb-3 font-body text-xs text-ink/50">
            Nếu bạn tự tạo tài khoản bên Supabase Dashboard (thay vì dùng form phía
            trên), gán vai trò cho tài khoản đó ở đây.
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
                <th className="py-2 pr-3">Hoạt động</th>
                <th className="py-2 pr-3"></th>
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
                    <ToggleSwitch
                      checked={p.status === "ACTIVE"}
                      onChange={() =>
                        updateProfile(p.id, {
                          status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        })
                      }
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => handleDeleteUser(p.id, p.full_name)}
                      disabled={busy}
                      className="font-body text-xs text-danger underline disabled:opacity-40"
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
