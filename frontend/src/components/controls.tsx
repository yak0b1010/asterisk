import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button, Modal } from "./ui";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Select({ label, error, id, children, className, ...p }: ComponentProps<"select"> & { label: string; error?: string }) {
  const sid = id ?? `s-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={sid} className="nb-input-label">{label}</label>
      <select id={sid} {...p} className="nb-input cursor-pointer">{children}</select>
      {error && <p className="nb-error">{error}</p>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-8 flex items-center justify-between text-sm font-black text-ink">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" className="px-3" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></Button>
        <span className="px-3 tabular-nums">{page} / {pages}</span>
        <Button variant="secondary" size="sm" className="px-3" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = "Delete", busy, error, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; busy?: boolean; error?: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="text-sm font-semibold text-ink">{children}</div>
      {error && <p role="alert" className="mt-4 nb-card p-3 bg-[#fee2e2] border-4 border-red-600 shadow-[6px_6px_0_#b91c1c] text-xs font-bold text-red-800">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-3 text-sm font-bold text-ink cursor-pointer disabled:opacity-50">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={() => onChange(!checked)}
        disabled={disabled}
        className="w-12 h-6 rounded-none border-4 border-black bg-white shadow-[4px_4px_0_#000] after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:bg-brand after:border-4 after:border-black after:shadow-[2px_2px_0_#000] after:transition-all peer-checked:translate-x-[36px] peer-checked:bg-green-500 peer-checked:shadow-[4px_4px_0_#16a34a] peer-checked:after:border-green-500"
        sr-only
      />
      <span>{label}</span>
    </label>
  );
}
