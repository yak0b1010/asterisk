import { X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/* ── Button ─────────────────────────────────────────────── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };
export function Button({ variant = "primary", className, ...p }: BtnProps) {
  const styles = {
    primary: "bg-signal text-white hover:bg-signal-dark",
    secondary: "border border-line bg-white hover:bg-paper",
    danger: "bg-bad text-white hover:opacity-90",
  }[variant];
  return (
    <button
      {...p}
      className={cx("inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50", styles, className)}
    />
  );
}

/* ── Field ──────────────────────────────────────────────── */
type FieldProps = ComponentProps<"input"> & { label: string; error?: string };
export function Field({ label, error, id, className, ...p }: FieldProps) {
  const fid = id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={fid} {...p} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-ink/40" />
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

/* ── Badge ──────────────────────────────────────────────── */
export function Badge({ tone = "neutral", children }: { tone?: "ok" | "bad" | "warn" | "neutral"; children: ReactNode }) {
  const t = { ok: "bg-ok/10 text-ok", bad: "bg-bad/10 text-bad", warn: "bg-signal/10 text-signal-dark", neutral: "bg-ink/5 text-ink/70" }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

/* ── StatCard ───────────────────────────────────────────── */
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-sm text-ink/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink/50">{hint}</p>}
    </div>
  );
}

/* ── PageHeader ─────────────────────────────────────────── */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink/60">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────── */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-paper"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── DataTable ──────────────────────────────────────────── */
export interface Column<T> { header: string; cell: (row: T) => ReactNode; className?: string }
export function DataTable<T>({ columns, rows, rowKey, empty = "Nothing here yet." }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string | number; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-paper text-ink/70">
          <tr>{columns.map((c) => <th key={c.header} className={cx("px-4 py-2.5 font-medium", c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-ink/50">{empty}</td></tr>
          ) : rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line last:border-0">
              {columns.map((c) => <td key={c.header} className={cx("px-4 py-2.5", c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
