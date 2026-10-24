import type { ReactNode } from "react";
import { cx } from "../../lib/utils";
import type { Tone } from "../../lib/format";

const TONES: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.06] text-neutral-300",
  success: "border-white/15 bg-white/[0.07] text-neutral-200",
  warning: "border-white/20 bg-white/[0.08] text-neutral-100",
  danger: "border-white/25 bg-white/[0.10] text-white",
  info: "border-white/10 bg-white/[0.05] text-neutral-300",
  accent: "border-white/20 bg-white/[0.08] text-neutral-100",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-neutral-500",
  success: "bg-neutral-200",
  warning: "bg-neutral-300",
  danger: "bg-white",
  info: "bg-neutral-400",
  accent: "bg-neutral-300",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5",
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span className={cx("h-1.5 w-1.5 rounded-full", DOTS[tone])} />
      ) : null}
      {children}
    </span>
  );
}

export function LiveDot({ active = true }: { active?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {active ? (
        <span className="animate-pulse-dot absolute inline-flex h-2 w-2 rounded-full bg-neutral-400" />
      ) : (
        <span className="inline-flex h-2 w-2 rounded-full bg-neutral-500" />
      )}
    </span>
  );
}
