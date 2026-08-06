import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/adminAuth";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const { email, password, full_name, role, branch_id, department_id } = body ?? {};

  if (!email || !password || !full_name || !role) {
    return NextResponse.json(
      { error: "Thiếu email, mật khẩu, họ tên hoặc vai trò." },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Mật khẩu phải từ 6 ký tự trở lên." }, { status: 400 });
  }
  if (!["agent", "supervisor", "admin"].includes(role)) {
    return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Không tạo được tài khoản." },
      { status: 400 }
    );
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name,
    email,
    role,
    branch_id: branch_id || null,
    department_id: department_id || null,
  });

  if (profileError) {
    // dọn lại nếu tạo profile thất bại, tránh mồ côi tài khoản Auth
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
