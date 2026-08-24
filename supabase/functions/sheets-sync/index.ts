// supabase/functions/sheets-sync/index.ts
//
// Phase 8 (Section 31): đẩy 5 dataset báo cáo sang Google Sheets.
// Supabase vẫn là Single Source of Truth — hàm này chỉ ĐỌC (không bao giờ ghi
// ngược lại Supabase từ Sheets), và nếu Sheets lỗi thì hệ thống chính (queue,
// ticket, Agent Portal...) không bị ảnh hưởng vì đây là job tách biệt, chạy
// theo lịch, không nằm trên đường xử lý realtime.
//
// Env vars cần thiết (set qua `supabase secrets set`):
//   GOOGLE_SERVICE_ACCOUNT_JSON  - nội dung file JSON của service account
//   GOOGLE_SHEET_ID              - ID của Google Sheet đích (trong URL)
// SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY được Supabase tự inject sẵn.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const REPORTS: { view: string; sheetTab: string }[] = [
  { view: "v_report_visit_log", sheetTab: "Visit Log" },
  { view: "v_report_case_log", sheetTab: "Case Log" },
  { view: "v_report_agent_performance", sheetTab: "Agent Performance" },
  { view: "v_report_daily_summary", sheetTab: "Daily Summary" },
  { view: "v_report_feedback", sheetTab: "Feedback" },
];

function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(): Promise<string> {
  const saJson = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!);
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: saJson.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const pem = saJson.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google auth failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

async function writeSheet(
  accessToken: string,
  sheetId: string,
  tab: string,
  rows: Record<string, unknown>[]
) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const values = [headers, ...rows.map((r) => headers.map((h) => String(r[h] ?? "")))];

  const range = `${tab}!A1`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}` +
    `?valueInputOption=RAW`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  if (!res.ok) {
    throw new Error(`Sheets write failed for tab "${tab}": ${res.status} ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  try {
    // Bảo vệ thêm 1 lớp phòng khi function này lỡ được deploy với
    // --no-verify-jwt (chạy theo lịch/cron thường cần tắt verify_jwt mặc định
    // của Supabase). Nếu đặt secret CRON_SHARED_SECRET, mọi request phải kèm
    // header "x-cron-secret" khớp giá trị đó, tránh ai biết URL cũng gọi được.
    const expectedSecret = Deno.env.get("CRON_SHARED_SECRET");
    if (expectedSecret && req.headers.get("x-cron-secret") !== expectedSecret) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const sheetId = Deno.env.get("GOOGLE_SHEET_ID")!;
    const accessToken = await getGoogleAccessToken();

    const results: Record<string, number | string> = {};
    for (const r of REPORTS) {
      const { data, error } = await supabase.from(r.view).select("*").limit(5000);
      if (error) {
        results[r.sheetTab] = `error: ${error.message}`;
        continue;
      }
      await writeSheet(accessToken, sheetId, r.sheetTab, data ?? []);
      results[r.sheetTab] = data?.length ?? 0;
    }

    return new Response(JSON.stringify({ ok: true, synced: results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
