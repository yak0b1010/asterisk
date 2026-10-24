import { cx, clamp } from "../../lib/utils";
import type { Tone } from "../../lib/format";

function autoTone(value: number): Tone {
  if (value >= 90) return "danger";
  if (value >= 75) return "warning";
  return "success";
}

const BAR_TONES: Record<Tone, string> = {
  neutral: "bg-neutral-500",
  success: "bg-neutral-300",
  warning: "bg-neutral-400",
  danger: "bg-neutral-100",
  info: "bg-neutral-400",
  accent: "bg-neutral-200",
};

export function Meter({
  label,
  value,
  detail,
  tone,
  className,
}: {
  label: string;
  value: number;
  detail?: string;
  tone?: Tone;
  className?: string;
}) {
  const safe = clamp(value, 0, 100);
  const resolved = tone ?? autoTone(safe);
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-neutral-400">{label}</span>
        <span className="mono text-xs font-semibold text-neutral-200">
          {safe.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08] shadow-[inset_0_1px_2px_rgb(0_0_0/0.3)]">
        <div
          className={cx("h-full rounded-full transition-all duration-500", BAR_TONES[resolved])}
          style={{ width: `${safe}%` }}
        />
      </div>
      {detail ? <p className="mt-1.5 text-[11px] text-neutral-500">{detail}</p> : null}
    </div>
  );
}

const GAUGE_COLORS: Record<Tone, string> = {
  neutral: "#8a8a8a",
  success: "#d4d4d4",
  warning: "#bdbdbd",
  danger: "#f5f5f5",
  info: "#a3a3a3",
  accent: "#e5e5e5",
};

export function RadialGauge({
  value,
  label,
  detail,
  tone,
  size = 112,
}: {
  value: number;
  label: string;
  detail?: string;
  tone?: Tone;
  size?: number;
}) {
  const safe = clamp(value, 0, 100);
  const resolved = tone ?? autoTone(safe);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safe / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke="rgb(255 255 255 / 0.1)"
            strokeWidth="9"
          />
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke={GAUGE_COLORS[resolved]}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="mono text-lg font-semibold text-white">
            {safe.toFixed(0)}%
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-xs font-medium text-neutral-300">{label}</p>
      {detail ? <p className="text-[11px] text-neutral-500">{detail}</p> : null}
    </div>
  );
}
