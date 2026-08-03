import { supabase } from "@/lib/supabase/client";
import { Profile } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, branch_id, department_id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as Profile;
}

export async function signOut() {
  await supabase.auth.signOut();
}
