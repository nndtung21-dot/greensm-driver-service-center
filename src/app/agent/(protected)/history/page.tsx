"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/auth";
import { StatusBadge } from "@/components/agent/ui";
import { TicketStatus } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type HistoryRow = {
  case_id: string;
  ticket_code: string;
  queue_number: string;
  status: TicketStatus;
  category_name: string;
  driver_name: string;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  resolution: string | null;
};

const FILTER_STATUSES: TicketStatus[] = [
  "RESOLVED",
  "CLOSED",
  "PENDING",
  "NO_SHOW",
  "PROCESSING",
];

export default function AgentHistoryPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    getCurrentProfile().then(async (p) => {
      if (!p) return;
      const { data } = await supabase
        .from("v_case_detail")
        .select(
          "case_id, ticket_code, queue_number, status, category_name, driver_name, created_at, resolved_at, closed_at, resolution"
        )
        .eq("assigned_agent_id", p.id)
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data as HistoryRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;
  const locale = lang === "en" ? "en-US" : "vi-VN";

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-brand-900">{t("history.title")}</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border-2 border-line px-3 py-1.5 font-body text-sm"
        >
          <option value="">{t("history.filterAll")}</option>
          {FILTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`agentStatus.${s}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <table className="w-full text-left font-body text-sm">
          <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">{t("history.columns.number")}</th>
              <th className="px-4 py-3">{t("history.columns.driver")}</th>
              <th className="px-4 py-3">{t("history.columns.need")}</th>
              <th className="px-4 py-3">{t("history.columns.time")}</th>
              <th className="px-4 py-3">{t("history.columns.status")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink/40">
                  {t("history.loading")}
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink/40">
                  {t("history.empty")}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr
                key={r.case_id}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-paper/40"
                onClick={() => router.push(`/agent/ticket/${r.case_id}`)}
              >
                <td className="px-4 py-3 font-display font-bold text-brand-900">
                  {r.queue_number}
                </td>
                <td className="px-4 py-3">{r.driver_name}</td>
                <td className="px-4 py-3">{r.category_name}</td>
                <td className="px-4 py-3 text-ink/60">
                  {new Date(r.resolved_at ?? r.closed_at ?? r.created_at).toLocaleString(locale)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
