import type { ReactNode } from "react";
import { cx } from "../../lib/utils";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex gap-1 overflow-x-auto border-b border-white/10 pb-px",
        className,
      )}
      role="tablist"
    >
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-semibold transition",
              selected
                ? "border-neutral-300 text-neutral-200"
                : "border-transparent text-neutral-500 hover:border-white/20 hover:text-neutral-300",
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cx(
                  "rounded-full px-1.5 py-0.5 text-[10px]",
                  selected
                    ? "bg-neutral-500/15 text-neutral-200"
                    : "bg-white/[0.06] text-neutral-400",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
