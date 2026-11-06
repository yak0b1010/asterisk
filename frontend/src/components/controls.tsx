import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button, Modal } from "./ui";

export function Select({ label, error, id, children, className, ...p }: ComponentProps<"select"> & { label: string; error?: string }) {
  const sid = id ?? `s-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={sid} className="mb-1 block text-sm font-medium">{label}</label>
      <select id={sid} {...p} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm">{children}</select>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-ink/60">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" className="px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></Button>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Button variant="secondary" className="px-2" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = "Delete", busy, error, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; busy?: boolean; error?: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="text-sm text-ink/80">{children}</div>
      {error && <p role="alert" className="mt-3 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-ok" : "bg-ink/25"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
