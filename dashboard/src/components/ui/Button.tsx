import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "border border-neutral-300/30 bg-gradient-to-b from-neutral-400 to-neutral-500 text-neutral-950 shadow-[0_10px_30px_-12px_rgb(255_255_255/0.15),inset_0_1px_0_rgb(255_255_255/0.35)] hover:from-neutral-300 hover:to-neutral-400 active:from-neutral-400 active:to-neutral-500",
  secondary:
    "border border-white/12 bg-white/[0.06] text-neutral-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl hover:border-white/20 hover:bg-white/[0.1]",
  ghost:
    "text-neutral-300 hover:bg-white/[0.07] hover:text-white",
  danger:
    "border border-white/20 bg-neutral-800/80 text-white shadow-[0_10px_30px_-12px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_255_255/0.12)] hover:border-white/30 hover:bg-neutral-700/80",
  outline:
    "border border-neutral-400/40 bg-neutral-500/10 text-neutral-200 backdrop-blur-xl hover:border-neutral-300/60 hover:bg-neutral-500/15",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-xs",
  md: "h-9.5 gap-2 rounded-lg px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-xl px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-white/[0.07] hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
