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

  let json: Record<string, unknown> | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const rawError = json && typeof json.error === "string" ? json.error.trim() : "";
    const message = rawError || `Lỗi máy chủ (HTTP ${res.status}).`;
    throw new Error(message);
  }
  return json;
}

export default function AdminUsersPage() {
  const [profiles, setProfiles] = useState<AdminProfileRow[]>([]);
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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

  // bulk create
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    {
      email: string;
      full_name: string;
      role: string;
      branch_code: string;
      status: "ok" | "error";
      password?: string;
      message?: string;
    }[]
  >([]);

  const load = useCallback(async () => {
    const [{ data: p }, { data: pu }, { data: b }, { data: sessionData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, branch_id, department_id, status"),
      supabase.rpc("admin_list_pending_users"),
      supabase.from("branches").select("id, branch_code, branch_name"),
      supabase.auth.getSession(),
    ]);
    setProfiles((p as AdminProfileRow[]) ?? []);
    setPending((pu as PendingUser[]) ?? []);
    setBranches(b ?? []);
    setCurrentUserId(sessionData.session?.user.id ?? null);
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

  function generateTempPassword() {
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  }

  const VALID_ROLES: UserRole[] = ["agent", "supervisor", "admin"];

  async function handleBulkCreate() {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setErrorMessage(
        "Dán ít nhất 1 dòng: email,họ tên,vai trò,mã VP"
      );
      return;
    }

    setBulkBusy(true);
    setErrorMessage(null);
    const results: typeof bulkResults = [];

    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const [email, full_name, roleRaw, branchCode] = parts;
      const role = (roleRaw || "agent").toLowerCase() as UserRole;

      if (!email || !full_name) {
        results.push({
          email: email || "(thiếu email)",
          full_name: full_name || "",
          role: roleRaw || "",
          branch_code: branchCode || "",
          status: "error",
          message: "Thiếu email hoặc họ tên.",
        });
        continue;
      }

      if (!VALID_ROLES.includes(role)) {
        results.push({
          email,
          full_name,
          role: roleRaw,
          branch_code: branchCode || "",
          status: "error",
          message: `Vai trò "${roleRaw}" không hợp lệ (agent/supervisor/admin).`,
        });
        continue;
      }

      const branch = branchCode
        ? branches.find(
            (b) =>
              b.branch_code.toLowerCase() ===
              branchCode.toLowerCase()
          )
        : undefined;

      if (branchCode && !branch) {
        results.push({
          email,
          full_name,
          role,
          branch_code: branchCode,
          status: "error",
          message: `Không tìm thấy VP có mã "${branchCode}".`,
        });
        continue;
      }

      const password = generateTempPassword();

      try {
        await callAdminApi("/api/admin/create-user", {
          email,
          password,
          full_name,
          role,
          branch_id: branch?.id ?? null,
        });
        results.push({
          email,
          full_name,
          role,
          branch_code: branch?.branch_code ?? "",
          status: "ok",
          password,
        });
      } catch (err) {
        console.error("Bulk create failed for", email, err);
        results.push({
          email,
          full_name,
          role,
          branch_code: branchCode || "",
          status: "error",
          message:
            err instanceof Error && err.message
              ? err.message
              : "Có lỗi xảy ra (không rõ chi tiết).",
        });
      }
    }

    setBulkResults(results);
    setBulkBusy(false);
    load();
  }

  function copyBulkResults() {
    const header = "email\thọ tên\tvai trò\tVP\tmật khẩu tạm\n";
    const rows = bulkResults
      .map((r) =>
        [
          r.email,
          r.full_name,
          r.role,
          r.branch_code,
          r.status === "ok" ? r.password : `LỖI: ${r.message}`,
        ].join("\t")
      )
      .join("\n");
    navigator.clipboard.writeText(header + rows);
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

      <Panel title="Tạo hàng loạt">
        <p className="mb-3 font-body text-xs text-ink/50">
          Mỗi dòng 1 người, cách nhau bằng dấu phẩy:{" "}
          <code className="rounded bg-paper px-1">
            email,họ tên,vai trò,mã VP
          </code>
          . Vai trò: agent/supervisor/admin. Mã VP để trống nếu chưa gán.
          Mật khẩu tạm được tự sinh, hiện ở bảng kết quả bên dưới sau khi
          tạo xong — copy gửi lại cho từng người.
        </p>

        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={
            "agent1@greensm.vn,Nguyễn Văn A,agent,HCM01\nsup1@greensm.vn,Trần Thị B,supervisor,HCM01"
          }
          rows={5}
          className="w-full rounded-lg border-2 border-line px-3 py-2 font-body text-sm focus:border-brand-700"
        />

        <div className="mt-3">
          <PrimaryButton
            onClick={handleBulkCreate}
            disabled={bulkBusy}
            className="px-4 py-2 text-sm"
          >
            {bulkBusy ? "Đang tạo..." : "+ Tạo hàng loạt"}
          </PrimaryButton>
        </div>

        {bulkResults.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-body text-sm font-semibold text-ink">
                Kết quả (
                {bulkResults.filter((r) => r.status === "ok").length}/
                {bulkResults.length} thành công)
              </p>
              <SecondaryButton
                onClick={copyBulkResults}
                className="px-3 py-1 text-xs"
              >
                Copy toàn bộ
              </SecondaryButton>
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left font-body text-sm">
                <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
                  <tr>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Họ tên</th>
                    <th className="px-3 py-2">Vai trò</th>
                    <th className="px-3 py-2">VP</th>
                    <th className="px-3 py-2">Mật khẩu tạm / Lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkResults.map((r, i) => (
                    <tr
                      key={i}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-3 py-2">{r.email}</td>
                      <td className="px-3 py-2">{r.full_name}</td>
                      <td className="px-3 py-2">{r.role}</td>
                      <td className="px-3 py-2">{r.branch_code || "—"}</td>
                      <td className="px-3 py-2">
                        {r.status === "ok" ? (
                          <code className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-900">
                            {r.password}
                          </code>
                        ) : (
                          <span className="text-danger">
                            {r.message}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
              {profiles.map((p) => {
                const isSelf = p.id === currentUserId;
                return (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">
                    {p.full_name}
                    {isSelf && <span className="ml-1 text-xs text-ink/40">(bạn)</span>}
                  </td>
                  <td className="py-2 pr-3 text-ink/60">{p.email}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={p.role}
                      disabled={isSelf}
                      title={isSelf ? "Không thể tự đổi vai trò của chính mình." : undefined}
                      onChange={(e) => updateProfile(p.id, { role: e.target.value as UserRole })}
                      className="rounded-lg border-2 border-line px-2 py-1 text-xs disabled:opacity-40"
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
                      onChange={() => {
                        if (isSelf) return;
                        updateProfile(p.id, {
                          status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        });
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => handleDeleteUser(p.id, p.full_name)}
                      disabled={busy || isSelf}
                      title={isSelf ? "Không thể tự xoá chính mình." : undefined}
                      className="font-body text-xs text-danger underline disabled:opacity-40"
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
