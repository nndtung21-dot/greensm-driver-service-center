import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local"
  );
}

// Kiosk/driver-facing client — anon key only. RLS + the SECURITY DEFINER
// RPCs in the migration are what keep this safe to ship to the browser.
// The service role key must NEVER be used here or in any client bundle.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
