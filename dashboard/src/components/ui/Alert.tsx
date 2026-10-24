import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { cx } from "../../lib/utils";

type AlertTone = "info" | "warning" | "danger" | "success";

const STYLES: Record<
  AlertTone,
  { box: string; icon: string; title: string; Icon: typeof Info }
> = {
  info: {
    box: "border-white/10 bg-white/[0.03]",
    icon: "text-neutral-400",
    title: "text-neutral-100",
    Icon: Info,
  },
  warning: {
    box: "border-white/20 bg-white/[0.05]",
    icon: "text-neutral-300",
    title: "text-white",
    Icon: AlertTriangle,
  },
  danger: {
    box: "border-white/25 bg-white/[0.07]",
    icon: "text-white",
    title: "text-white",
    Icon: ShieldAlert,
  },
  success: {
    box: "border-white/15 bg-white/[0.04]",
    icon: "text-neutral-200",
    title: "text-neutral-50",
    Icon: CheckCircle2,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const style = STYLES[tone];
  const Icon = style.Icon;
  return (
    <div
      className={cx(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] backdrop-blur-xl sm:flex-row sm:items-start",
        style.box,
        className,
      )}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon className={cx("mt-0.5 h-4.5 w-4.5 shrink-0", style.icon)} />
      <div className="min-w-0 flex-1">
        <p className={cx("text-sm font-semibold", style.title)}>{title}</p>
        {children ? (
          <div className="mt-0.5 text-xs leading-relaxed text-neutral-300/90">
            {children}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
