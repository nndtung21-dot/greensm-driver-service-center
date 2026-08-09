import { ReactNode } from "react";
import { TicketStatus } from "@/lib/types";

export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "warn" | "danger";
}) {
  const toneClass =
    tone === "warn"
      ? "text-warn"
      : tone === "danger"
      ? "text-danger"
      : "text-brand-900";
  return (
    <div className="rounded-card border border-line bg-white px-5 py-4">
      <p className="font-body text-xs font-semibold uppercase tracking-wide text-ink/50">
        {label}
      </p>
      <p className={`mt-1 font-display text-3xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  WAITING: "Đang chờ",
  CALLED: "Đã gọi",
  PROCESSING: "Đang xử lý",
  PENDING: "Tạm hoãn",
  TRANSFERRED: "Đã chuyển",
  RESOLVED: "Đã giải quyết",
  CLOSED: "Đã đóng",
  CANCELLED: "Đã huỷ",
  NO_SHOW: "Vắng mặt",
};

const STATUS_CLASSES: Record<TicketStatus, string> = {
  WAITING: "bg-amber-50 text-warn border-amber-200",
  CALLED: "bg-brand-100 text-brand-700 border-brand-100",
  PROCESSING: "bg-brand-100 text-brand-900 border-brand-100",
  PENDING: "bg-amber-50 text-warn border-amber-200",
  TRANSFERRED: "bg-line/40 text-ink/70 border-line",
  RESOLVED: "bg-green-50 text-brand-700 border-green-200",
  CLOSED: "bg-line/40 text-ink/50 border-line",
  CANCELLED: "bg-red-50 text-danger border-red-200",
  NO_SHOW: "bg-red-50 text-danger border-red-200",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-3 py-1 font-body text-xs font-semibold ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function SlaBadge({ slaDueAt }: { slaDueAt: string | null }) {
  if (!slaDueAt) {
    return <span className="font-body text-xs text-ink/40">—</span>;
  }
  const due = new Date(slaDueAt).getTime();
  const now = Date.now();
  const diffMin = Math.round((due - now) / 60000);

  if (diffMin < 0) {
    return (
      <span className="font-body text-xs font-semibold text-danger">
        Quá hạn {Math.abs(diffMin)}p
      </span>
    );
  }
  if (diffMin <= 10) {
    return (
      <span className="font-body text-xs font-semibold text-warn">
        Còn {diffMin}p
      </span>
    );
  }
  return <span className="font-body text-xs text-ink/60">Còn {diffMin}p</span>;
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-lg bg-brand-700 px-5 py-2.5 font-body text-sm font-semibold text-white transition-colors hover:bg-brand-900 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-lg border-2 border-line bg-white px-5 py-2.5 font-body text-sm font-semibold text-brand-900 transition-colors hover:border-accent-500 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-brand-700" : "bg-line"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white p-6">
      {title && (
        <h2 className="mb-4 font-display text-lg font-semibold text-brand-900">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
