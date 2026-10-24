import type { ReactNode } from "react";
import { cx } from "../../lib/utils";
import type { Tone } from "../../lib/format";

const TONES: Record<Tone, { icon: string; value: string }> = {
  neutral: { icon: "border-white/10 bg-white/[0.06] text-neutral-300", value: "text-white" },
  success: { icon: "border-neutral-500/25 bg-neutral-500/10 text-neutral-300", value: "text-white" },
  warning: { icon: "border-neutral-500/25 bg-neutral-500/10 text-neutral-300", value: "text-white" },
  danger: { icon: "border-neutral-500/25 bg-neutral-500/10 text-neutral-300", value: "text-white" },
  info: { icon: "border-neutral-500/25 bg-neutral-500/10 text-neutral-300", value: "text-white" },
  accent: { icon: "border-neutral-500/25 bg-neutral-500/10 text-neutral-300", value: "text-white" },
};

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "accent",
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  tone?: Tone;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "panel group relative overflow-hidden p-4 transition-colors hover:border-white/20",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            {label}
          </p>
          <p className={cx("mt-1.5 text-2xl font-semibold tracking-tight", TONES[tone].value)}>
            {value}
          </p>
          {sub ? (
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">{sub}</p>
          ) : null}
        </div>
        <span
          className={cx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            TONES[tone].icon,
          )}
        >
          {icon}
        </span>
      </div>
      {footer ? (
        <div className="mt-3 border-t border-white/10 pt-2.5 text-[11px] text-neutral-500">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
