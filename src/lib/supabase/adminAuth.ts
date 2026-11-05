import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./admin";

export async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { error: "Thiếu token đăng nhập.", status: 401 as const };
  }

  const admin = getSupabaseAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return { error: "Token không hợp lệ hoặc đã hết hạn.", status: 401 as const };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role, status, branch_id, all_branches")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin" || profile.status !== "ACTIVE") {
    return { error: "Chỉ Admin được thực hiện thao tác này.", status: 403 as const };
  }

  return {
    callerId: userData.user.id,
    // super admin (all_branches) thao tác được ở mọi văn phòng; admin thường chỉ trong văn phòng của mình
    isSuperAdmin: profile.all_branches === true,
    branchId: (profile.branch_id as string | null) ?? null,
  };
}
