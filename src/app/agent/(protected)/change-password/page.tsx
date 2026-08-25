"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Panel, PrimaryButton } from "@/components/agent/ui";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!currentPassword) {
      setErrorMessage("Nhập mật khẩu hiện tại trước đã.");
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage("Mật khẩu mới phải từ 8 ký tự trở lên.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("Mật khẩu mới nhập lại không khớp.");
      return;
    }

    setBusy(true);

    // Xác nhận đúng mật khẩu hiện tại trước khi đổi, tránh trường hợp ai đó
    // ngồi vào máy đang đăng nhập sẵn của người khác rồi tự đổi mật khẩu.
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (!email) {
      setErrorMessage("Không xác định được tài khoản đang đăng nhập.");
      setBusy(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (signInError) {
      setErrorMessage("Mật khẩu hiện tại không đúng.");
      setBusy(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    setBusy(false);

    if (updateError) {
      setErrorMessage(updateError.message);
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccessMessage("Đổi mật khẩu thành công.");
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-6 font-display text-2xl font-bold text-brand-900">
        Đổi mật khẩu
      </h1>

      <Panel>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMessage && (
            <p className="rounded-lg bg-red-50 px-4 py-2 font-body text-sm text-danger">
              {errorMessage}
            </p>
          )}
          {successMessage && (
            <p className="rounded-lg bg-brand-100 px-4 py-2 font-body text-sm text-brand-900">
              {successMessage}
            </p>
          )}

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Mật khẩu hiện tại
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border-2 border-line px-4 py-2.5 font-body text-sm focus:border-brand-700"
            />
          </div>

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Mật khẩu mới
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự"
              className="w-full rounded-lg border-2 border-line px-4 py-2.5 font-body text-sm focus:border-brand-700"
            />
          </div>

          <div>
            <label className="mb-1 block font-body text-sm text-ink/70">
              Nhập lại mật khẩu mới
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border-2 border-line px-4 py-2.5 font-body text-sm focus:border-brand-700"
            />
          </div>

          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? "Đang lưu..." : "Đổi mật khẩu"}
          </PrimaryButton>
        </form>
      </Panel>
    </div>
  );
}
