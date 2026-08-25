import { createClient } from "@supabase/supabase-js";

// CHỈ dùng trong API routes (server-side). KHÔNG BAO GIỜ import file này vào
// component có "use client" — service role key sẽ bypass toàn bộ RLS.

// Đọc thẳng claim "role" bên trong JWT (chỉ decode base64, KHÔNG verify chữ ký
// — không cần thiết ở đây vì ta chỉ đang tự kiểm tra biến môi trường của
// chính mình, không xác thực người dùng). Giúp phát hiện ngay trường hợp dán
// nhầm anon key thay vì service_role key — 2 key nhìn gần giống hệt nhau
// (đều bắt đầu bằng "eyJ...") nên rất dễ nhầm khi copy-paste.
function decodeJwtRole(token: string): string | null {
  try {
    const payloadB64 = token.split(".")[1];
    const json = Buffer.from(payloadB64, "base64").toString("utf-8");
    const payload = JSON.parse(json);
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Thiếu SUPABASE_SERVICE_ROLE_KEY trong Environment Variables (server-side, không có tiền tố NEXT_PUBLIC_)."
    );
  }
  const role = decodeJwtRole(serviceKey);
  if (role !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY hiện tại có role="${role ?? "không đọc được"}", nhưng cần đúng "service_role". Rất có thể bạn đã dán nhầm anon key. Lấy lại đúng key tại Supabase Dashboard → Settings → API → mục "service_role" (KHÁC với mục "anon public"), rồi cập nhật lại trên Vercel và redeploy.`
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
