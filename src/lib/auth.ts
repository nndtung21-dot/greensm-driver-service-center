import { supabase } from "@/lib/supabase/client";
import { Profile } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, branch_id, department_id, status")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !data) return null;
  // Tài khoản bị Admin tắt (INACTIVE) không được coi là đã đăng nhập ở bất kỳ
  // khu vực nào (Agent/Supervisor/Admin), dù session Supabase Auth vẫn còn hạn.
  if (data.status === "INACTIVE") {
    await supabase.auth.signOut();
    return null;
  }
  return data as Profile;
}

export async function signOut() {
  await supabase.auth.signOut();
}
