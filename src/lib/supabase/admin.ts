import { createClient } from "@supabase/supabase-js";

// CHỈ dùng trong API routes (server-side). KHÔNG BAO GIỜ import file này vào
// component có "use client" — service role key sẽ bypass toàn bộ RLS.
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Thiếu SUPABASE_SERVICE_ROLE_KEY trong Environment Variables (server-side, không có tiền tố NEXT_PUBLIC_)."
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
