import type { ReactNode } from "react";
import { cx } from "../../lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-neutral-400 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl">
          {icon}
        </span>
      ) : null}
      <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-neutral-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
