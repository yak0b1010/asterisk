import { X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/* ── Neo-Brutalist Button ── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
};
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...p
}: BtnProps) {
  const base = "nb-btn font-sans";
  const variants = {
    primary: "nb-btn.primary",
    secondary: "nb-btn.secondary",
    danger: "nb-btn.danger",
  }[variant];
  const sizes = { sm: "h-10 px-3 text-[13px]", md: "h-12 px-5 text-[15px]" }[size];

  return (
    <button {...p} className={cx(base, variants, sizes, className)} />
  );
}

/* ── Neo-Brutalist Field ── */
type FieldProps = ComponentProps<"input"> & { label: string; error?: string };
export function Field({ label, error, id, className, ...p }: FieldProps) {
  const fid = id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={fid} className="nb-input-label">{label}</label>
      <input
        id={fid}
        {...p}
        className="nb-input"
      />
      {error && <p className="nb-error">{error}</p>}
    </div>
  );
}

/* ── Badge ── */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?:
    | "ok"
    | "bad"
    | "warn"
    | "neutral"
    | "status-running"
    | "status-degraded"
    | "status-stopped"
    | "dept-admin"
    | "dept-finance"
    | "dept-it"
    | "dept-support"
    | "dept-management";
  children: ReactNode;
}) {
  return (
    <span className={cx("nb-badge", `nb-badge.${tone}`)}>{children}</span>
  );
}

/* ── StatCard ── */
export function StatCard({
  label,
  value,
  hint,
  cardClass,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  cardClass?: string;
}) {
  return (
    <div className={`nb-card p-5 ${cardClass || ""}`}>
      <p className="nb-panel-title mb-2">{label}</p>
      <p className="text-3xl font-black tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-2">{hint}</p>}
    </div>
  );
}

/* ── PageHeader ── */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-black tracking-tight">{title}</h1>
        {description && <p className="mt-2 text-sm text-ink-2">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/* ── Modal ── */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Dialog - stops all click propagation */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nb-card w-full max-w-md shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b-4 border-black">
          <h2 className="text-2xl font-black">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-5 top-5 rounded-none p-1 hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── DataTable ── */
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string | number;
  empty?: string;
}) {
  return (
    <div className="nb-card shadow-none">
      <table className="nb-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={cx(c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-ink-2"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={rowKey(r)}
                className="hover:bg-[#ffe6d9] transition-colors"
              >
                {columns.map((c) => (
                  <td key={c.header} className={cx(c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Neo-Brutalist Dropdown ── */
interface DropdownItem {
  label: string;
  value: string;
  onClick?: () => void;
  icon?: ReactNode;
  danger?: boolean;
}

interface DropdownProps {
  triggerLabel: string;
  items: DropdownItem[];
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
}

export function Dropdown({
  triggerLabel,
  items,
  value,
  onChange,
  size = "md",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(triggerLabel);

  const toggle = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  const btnSize = size === "sm" ? "h-10 px-3 text-[13px]" : "h-12 px-5 text-[15px]";

  const handleSelect = (item: DropdownItem) => {
    if (item.onClick) {
      item.onClick();
      close();
      return;
    }
    if (onChange) {
      onChange(item.value);
      setSelectedLabel(item.label);
    }
    close();
  };

  return (
    <div className="relative inline-block">
      <Button variant="secondary" size={size} className={btnSize} onClick={toggle}>
        {selectedLabel}
        <span className="ml-2 text-xs">▾</span>
      </Button>

      {open && (
        <div className="absolute right-0 mt-3 w-48 nb-card shadow-none z-50">
          {items.map((item, i) => {
            const isSelected = value !== undefined && item.value === value;
            return (
              <button
                key={i}
                onClick={() => handleSelect(item)}
                className={`w-full text-left px-4 py-3 border-b-4 border-black font-bold text-sm transition-colors ${
                  isSelected
                    ? "bg-[#ffe6d9] text-brand"
                    : "bg-white text-ink hover:bg-[#ffe6d9]"
                }`}
              >
                {item.icon && <span className="mr-2">{item.icon}</span>}
                {item.label}
                {isSelected && <span className="ml-auto text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
