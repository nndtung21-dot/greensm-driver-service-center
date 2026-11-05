import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/adminAuth";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user_id } = (await req.json()) ?? {};
    if (!user_id) {
      return NextResponse.json({ error: "Thiếu user_id." }, { status: 400 });
    }
    if (user_id === auth.callerId) {
      return NextResponse.json({ error: "Không thể tự xoá chính mình." }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Phân quyền theo văn phòng: admin thường chỉ xoá người cùng văn phòng, không xoá super admin.
    if (!auth.isSuperAdmin) {
      const { data: target } = await admin
        .from("profiles")
        .select("branch_id, all_branches")
        .eq("id", user_id)
        .maybeSingle();
      if (!target || target.all_branches === true || !auth.branchId || target.branch_id !== auth.branchId) {
        return NextResponse.json(
          { error: "Bạn chỉ được xoá tài khoản thuộc văn phòng của mình." },
          { status: 403 }
        );
      }
    }

    // profiles.id có ON DELETE CASCADE tới auth.users nên xoá auth user sẽ tự
    // xoá luôn dòng profile tương ứng.
    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi máy chủ không xác định." },
      { status: 500 }
    );
  }
}
