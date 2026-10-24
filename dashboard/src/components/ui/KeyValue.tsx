import type { ReactNode } from "react";
import { cx } from "../../lib/utils";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
  wide?: boolean;
}

export function KeyValue({
  items,
  columns = 2,
  className,
}: {
  items: KeyValueItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const grid =
    columns === 3
      ? "sm:grid-cols-3"
      : columns === 2
        ? "sm:grid-cols-2"
        : "";
  return (
    <dl className={cx("grid grid-cols-1 gap-x-6 gap-y-3", grid, className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className={cx("min-w-0", item.wide && "sm:col-span-2")}
        >
          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
            {item.label}
          </dt>
          <dd
            className={cx(
              "mt-0.5 break-words text-sm text-neutral-200",
              item.mono && "mono text-[13px]",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
